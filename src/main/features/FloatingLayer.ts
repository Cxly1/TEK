import { WebContentsView, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { IPC, type LayerContent, type LayerEvent } from '@shared/ipc'

/**
 * Capa flotante: el menu ☰, Descargas e Historial.
 *
 * La pagina de cada pestana es una WebContentsView NATIVA, y las vistas nativas
 * se dibujan SIEMPRE por encima de la interfaz de React del shell. Por eso, para
 * que un panel se viera, TEK ocultaba la pagina y todo quedaba en negro. Aqui
 * los paneles viven en su propia WebContentsView, TRANSPARENTE y apilada encima
 * de todo: la pagina sigue viva detras (el video corre, la cancion avanza) y el
 * panel flota delante, como en cualquier navegador. Es la tecnica de los
 * dialogos de Wexond (vistas transparentes que se reutilizan); la alternativa de
 * Min (una foto de la pagina detras) congela el video mientras esta abierto.
 *
 * Cubre la ventana ENTERA: un clic fuera del panel lo cierra sin llegar a la
 * pagina (igual que en Brave o Chrome) y el teclado es del panel mientras esta
 * abierto. La vista se crea una vez, se precarga al arrancar (abrir es
 * instantaneo) y despues solo se enseña y se esconde.
 *
 * Menu y Descargas se comportan como menus nativos (se cierran si la ventana
 * cambia de tamaño o pierde el foco). Historial es un panel de trabajo: aguanta
 * el Alt+Tab y se recoloca si la ventana cambia.
 */
export class FloatingLayer {
  private readonly win: BrowserWindow
  /** Carga la UI (index.html?surface=layer) — dev/prod lo decide index.ts. */
  private readonly load: (view: WebContentsView) => void
  private view: WebContentsView | null = null
  /** Lo que se esta pintando; null = capa cerrada. */
  private content: LayerContent | null = null
  /**
   * La UI de la capa ya monto (lo dice ella misma al pedir `current`). Hasta
   * entonces la capa NO se enseña: transparente y sin panel dentro, se comeria
   * los clics de la ventana entera sin que se viera nada.
   */
  private ready = false
  /** La capa esta a la vista (y con el teclado). */
  private shown = false
  /** Freno si la capa no llega a montar: se da por cerrada. */
  private readyTimer: NodeJS.Timeout | null = null
  /** Lo que pasa en la capa, para el shell: elegido (menu), o cerrada sin mas. */
  onEvent: ((e: LayerEvent) => void) | null = null
  /** Tras esconder la capa: devolver el teclado a la pagina o al shell. */
  onHidden: (() => void) | null = null

  constructor(win: BrowserWindow, load: (view: WebContentsView) => void) {
    this.win = win
    this.load = load
    // Menu y Descargas, como un menu nativo: si la ventana cambia de tamaño, se
    // minimiza o pierde el foco (Alt+Tab, clic en otra app), se cierran. El
    // Historial aguanta y solo se recoloca. La capa sigue el tamaño de la
    // ventana SIEMPRE, tambien oculta (ver prepare).
    const changed = (): void => {
      this.fit()
      if (!this.sticky) this.close(true)
    }
    win.on('resize', changed)
    win.on('enter-full-screen', changed)
    win.on('leave-full-screen', changed)
    win.on('minimize', () => this.close(true))
    win.on('blur', () => {
      if (!this.sticky) this.close(true)
    })
  }

  get isOpen(): boolean {
    return this.content !== null
  }

  /** ¿Lo abierto sobrevive a Alt+Tab y a redimensionar? (paneles de trabajo). */
  private get sticky(): boolean {
    return this.content?.kind === 'history'
  }

  /** Crea y carga la capa, oculta. Idempotente. */
  prepare(): void {
    if (this.view || this.win.isDestroyed()) return
    const view = new WebContentsView({
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        // Pasa casi todo el tiempo oculta: estrangulada, el primer frame al
        // abrir llegaria tarde.
        backgroundThrottling: false
      }
    })
    // Transparente: solo se ve el panel; el resto deja ver la pagina.
    view.setBackgroundColor('#00000000')
    view.setVisible(false)
    // Solo pinta paneles: ni ventanas nuevas ni navegar a ningun sitio.
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // Mientras (re)carga no hay UI montada: no se enseña hasta que avise (current).
    view.webContents.on('did-start-loading', () => {
      if (this.view === view) this.ready = false
    })
    this.win.contentView.addChildView(view)
    // Si su proceso muere, se cierra (si estaba abierta) y la siguiente apertura
    // la recrea de cero.
    view.webContents.on('render-process-gone', () => {
      if (this.view !== view) return
      const wasOpen = this.content !== null
      this.content = null
      this.destroyView()
      if (wasOpen) {
        this.onEvent?.({ type: 'closed' })
        this.onHidden?.()
      }
    })
    this.view = view
    // Nace YA con el tamaño de la ventana. Si naciera en 0×0 y creciera al
    // abrir, el panel podia pintarse antes de que la pagina se enterara del
    // tamaño nuevo y calcular su sitio con un ancho de 0: el menu salia pegado
    // al borde de la ventana en vez de bajo el ☰ (visto en la sonda).
    this.fit()
    this.load(view)
  }

  /** Abre (o sustituye: del menu a Descargas, por ejemplo) lo que se pinta. */
  open(content: LayerContent): void {
    this.prepare()
    const view = this.view
    if (!view || view.webContents.isDestroyed()) return
    this.content = content
    this.fit()
    if (this.ready) {
      this.show()
      return
    }
    // Clic nada mas arrancar: se enseña en cuanto la capa monte (ver current).
    // Si no llega a montar, se da por cerrada y el shell vuelve a su sitio.
    this.clearReadyTimer()
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null
      if (!this.ready) this.close(true)
    }, 3000)
  }

  /** Repinta lo abierto (no abre nada cerrado ni cambia de panel). */
  update(content: LayerContent): void {
    const view = this.view
    if (!this.content || this.content.kind !== content.kind || !view || view.webContents.isDestroyed()) return
    this.content = content
    view.webContents.send(IPC.layerShow, content)
  }

  /**
   * La capa lo pide al montar: es su forma de decir "ya estoy". Si habia algo
   * esperando, se enseña ahora.
   */
  current(): LayerContent | null {
    this.ready = true
    if (this.content && !this.shown) this.show()
    return this.content
  }

  /** Se eligio un item del menu: un interruptor lo deja abierto; lo demas lo cierra. */
  pick(id: string, keepOpen: boolean): void {
    if (!this.content) return
    if (!keepOpen) this.hide()
    this.onEvent?.({ type: 'pick', id })
  }

  /**
   * Cierra la capa. `notify` = avisar al shell; cuando el cierre lo pidio el
   * propio shell no hace falta (y el eco rompia el doble montaje de StrictMode:
   * abrir-cerrar-abrir acababa en un "cerrado" tardio).
   */
  close(notify: boolean): void {
    if (!this.content) return
    this.hide()
    if (notify) this.onEvent?.({ type: 'closed' })
  }

  /**
   * Re-sube la capa al tope. Las child views se apilan por orden de insercion:
   * cuando el ViewManager re-eleva el mini-player (o anade una pestana), la capa
   * tiene que volver a quedar encima. Devuelve si esta a la vista (y por tanto
   * es la dueña del teclado).
   */
  raise(): boolean {
    const view = this.view
    if (!view || !this.shown || this.win.isDestroyed()) return false
    const cv = this.win.contentView
    const kids = cv.children
    if (kids[kids.length - 1] !== view) {
      try {
        cv.removeChildView(view)
        cv.addChildView(view)
      } catch {
        /* la ventana se esta cerrando */
      }
      // Sacarla y volverla a meter le quita el foco: el teclado sigue siendo suyo.
      if (!view.webContents.isDestroyed()) view.webContents.focus()
    }
    return true
  }

  /**
   * Empuje en vivo para el panel abierto (p. ej. el estado de las descargas).
   * Los eventos que el main manda al shell NO le llegan a la capa: es otro
   * webContents, y lo que un panel suyo escuche hay que mandarselo aqui.
   */
  send(channel: string, payload: unknown): void {
    const view = this.view
    if (!view || !this.shown || view.webContents.isDestroyed()) return
    view.webContents.send(channel, payload)
  }

  /** ¿Este webContents es la capa? (solo ella puede elegir o descartar). */
  owns(wc: Electron.WebContents): boolean {
    return !!this.view && !this.view.webContents.isDestroyed() && this.view.webContents === wc
  }

  dispose(): void {
    this.content = null
    this.destroyView()
  }

  /** La capa ocupa siempre la ventana entera. */
  private fit(): void {
    const view = this.view
    if (!view || this.win.isDestroyed()) return
    const [w, h] = this.win.getContentSize()
    view.setBounds({ x: 0, y: 0, width: w, height: h })
  }

  private show(): void {
    const view = this.view
    if (!view || !this.content || view.webContents.isDestroyed()) return
    this.clearReadyTimer()
    this.shown = true
    this.raise()
    view.webContents.send(IPC.layerShow, this.content)
    view.setVisible(true)
    view.webContents.focus()
  }

  private hide(): void {
    this.content = null
    this.clearReadyTimer()
    const view = this.view
    if (!view || view.webContents.isDestroyed()) return
    const wasShown = this.shown
    this.shown = false
    view.setVisible(false)
    // Se vacia al esconderla: al volver a enseñarla no asoma un frame del panel viejo.
    view.webContents.send(IPC.layerShow, null)
    if (wasShown) this.onHidden?.()
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer)
    this.readyTimer = null
  }

  private destroyView(): void {
    const view = this.view
    this.view = null
    this.ready = false
    this.shown = false
    this.clearReadyTimer()
    if (!view) return
    try {
      if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view)
    } catch {
      /* ya removida */
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }
}
