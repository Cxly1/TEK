import { WebContentsView, BrowserWindow, screen, type View } from 'electron'
import { join } from 'node:path'
import { IPC, TOPBAR_HEIGHT, type PipMode, type PipState } from '@shared/ipc'
import { JsonStore } from './dev/jsonStore'

/** Lo que la barra del mini necesita mostrar (titulo + host + favicon del sitio). */
export interface PipMeta {
  tabId: string
  title: string
  host: string
  favicon: string | null
}

/** Preferencias persistidas del mini: tamano del video y posicion del flotante. */
interface PipPrefs {
  /** Version del formato (migraciones: v1 descarta tamanos inflados por el bug DPI). */
  v: number
  w: number
  h: number
  /** Posicion en pantalla de la ventana flotante (null = aun sin recordar). */
  floatX: number | null
  floatY: number | null
}

/** Medidas del mini, en el lenguaje minimalista de TEK. */
const BAR = 34 // alto de la barra de control
const DEF_W = 384 // ancho del video por defecto
const DEF_H = 216 // alto del video por defecto (16:9)
const MARGIN = 16 // separacion del borde en modo acoplado
const MIN_W = 240 // ancho minimo al redimensionar (flotante)
/** Color de la barra mientras React monta (evita el flash blanco de la vista nativa). */
const BAR_BG = '#16181b'

/**
 * Mini-player (Picture-in-Picture) de TEK. Toma PRESTADA la WebContentsView de
 * una pestana (la misma instancia: el video no se corta y Netflix conserva su
 * DRM/login) y la muestra pequena con una barra de control propia, mientras el
 * usuario navega en otra pestana.
 *
 * DOS capas nativas que viajan juntas: el CONTENIDO (la vista de la pestana) y
 * el CHROME (una WebContentsView propia con los botones — vista nativa porque un
 * overlay de React nunca se veria sobre una vista nativa). Dos modos: acoplado
 * (dentro de la ventana de TEK, anclado a una esquina) y flotante (una
 * BrowserWindow sin marco, always-on-top, que flota sobre todo el escritorio).
 */
export class MiniPlayer {
  private readonly win: BrowserWindow
  /** Carga la UI de la barra (index.html?surface=pip) — dev/prod lo decide index.ts. */
  private readonly loadChrome: (view: WebContentsView) => void
  /** La OS cerro la ventana flotante (Alt+F4): el navegador debe salir del PiP. */
  onWantExit: (() => void) | null = null

  private view: WebContentsView | null = null
  private chrome: WebContentsView | null = null
  private meta: PipMeta | null = null
  private mode: PipMode = 'docked'
  private minimized = false
  private floatWin: BrowserWindow | null = null
  /** Tamano del video (se preserva al redimensionar en flotante y volver a acoplar). */
  private w = DEF_W
  private h = DEF_H
  /** Esquina del mini en modo acoplado (px relativos al area de contenido). */
  private dockX = 0
  private dockY = 0
  /**
   * Geometria CONGELADA de la ventana flotante mientras se arrastra (posicion
   * acumulada en JS + tamano fijo). No-null = hay un arrastre en curso.
   */
  private drag: { x: number; y: number; w: number; h: number } | null = null
  private dragTimer: NodeJS.Timeout | null = null
  /** Tamano del video y posicion del flotante, recordados entre sesiones. */
  private readonly prefs = new JsonStore<PipPrefs>('tek-pip.json', {
    v: 0,
    w: DEF_W,
    h: DEF_H,
    floatX: null,
    floatY: null
  })

  constructor(win: BrowserWindow, loadChrome: (view: WebContentsView) => void) {
    this.win = win
    this.loadChrome = loadChrome
    // Migracion v1: versiones previas inflaban el tamano guardado al arrastrar el
    // flotante (bug de redondeo DPI); esos w/h no son fiables — se descartan una vez.
    if ((this.prefs.data.v ?? 0) < 1) {
      this.prefs.data.w = DEF_W
      this.prefs.data.h = DEF_H
      this.prefs.data.v = 1
      this.prefs.save()
    }
    // Recupera el ultimo tamano usado.
    this.w = this.prefs.data.w
    this.h = this.prefs.data.h
    // Si la ventana principal cambia de tamano, el mini acoplado se reubica para
    // no quedar fuera de pantalla.
    this.win.on('resize', () => {
      if (this.view && this.mode === 'docked') this.layout()
    })
  }

  /** ¿Hay un video en el mini ahora mismo? */
  get active(): boolean {
    return !!this.view
  }

  /** Id de la pestana que esta en el mini (o null). */
  get tabId(): string | null {
    return this.meta?.tabId ?? null
  }

  // --- Tomar / soltar la vista -----------------------------------------------

  /**
   * Toma la vista de una pestana y la muestra en el mini (nace acoplado). La
   * vista ya es hija de win.contentView (era una pestana): solo creamos la barra
   * y la elevamos por encima de la pestana activa.
   */
  take(view: WebContentsView, meta: PipMeta): void {
    this.view = view
    this.meta = meta
    this.mode = 'docked'
    this.minimized = false
    // Mientras el video vive en el mini, NO lo estrangule Chromium: la vista deja
    // de ser la pestana activa, y con el throttling por defecto el compositor
    // congela/ennegrece el <video>. Se restaura al soltarla (release).
    this.setThrottling(view, false)
    const [winW, winH] = this.win.getContentSize()
    this.dockX = winW - this.w - MARGIN
    this.dockY = winH - (BAR + this.h) - MARGIN
    this.ensureChrome()
    this.layout()
    this.raise()
    this.pokeRepaint()
    this.emit()
  }

  /**
   * Devuelve la vista de contenido (para reintegrarla a su pestana) y limpia el
   * mini: destruye la barra y la ventana flotante. La vista de contenido NO se
   * destruye — queda como hija de win.contentView.
   */
  release(): WebContentsView | null {
    const view = this.view
    if (!view) return null
    // Vuelve a ser una pestana normal: restaura el throttling por defecto (una
    // pestana de fondo SI debe estrangularse, por bateria).
    this.setThrottling(view, true)
    // Quitar la barra de su contenedor actual y cerrarla.
    if (this.chrome) {
      try {
        this.container().removeChildView(this.chrome)
      } catch {
        /* contenedor ya destruido */
      }
      if (!this.chrome.webContents.isDestroyed()) this.chrome.webContents.close()
      this.chrome = null
    }
    // Si estaba flotante, rescatar el contenido a la ventana principal ANTES de
    // destruir la flotante (si no, su webContents moriria con la ventana).
    if (this.mode === 'floating' && this.floatWin && !this.floatWin.isDestroyed()) {
      try {
        this.floatWin.contentView.removeChildView(view)
      } catch {
        /* ya removida */
      }
      this.win.contentView.addChildView(view)
    }
    this.destroyFloat()
    this.view = null
    this.meta = null
    this.mode = 'docked'
    this.minimized = false
    this.emit()
    return view
  }

  // --- Controles de la barra -------------------------------------------------

  /** Acoplado (dentro de TEK) <-> flotante (ventana del SO). */
  toggleFloat(): void {
    if (!this.view || !this.chrome) return
    if (this.mode === 'floating') this.dock()
    else this.float()
  }

  /** Colapsa a pildora (oculta el video, el audio sigue) y restaura. */
  toggleMinimize(): void {
    if (!this.view) return
    this.minimized = !this.minimized
    if (this.mode === 'floating' && this.floatWin && !this.floatWin.isDestroyed()) {
      // this.w (la verdad interna), NO getContentSize(): re-leer del SO arrastra
      // los +-1px del redondeo DPI de Windows y el tamano deriva con cada toggle.
      this.floatWin.setResizable(!this.minimized)
      this.floatWin.setContentSize(this.w, this.minimized ? BAR : BAR + this.h)
    }
    this.layout()
    this.emit()
  }

  setMuted(muted: boolean): void {
    const wc = this.view?.webContents
    if (wc && !wc.isDestroyed()) {
      wc.setAudioMuted(muted)
      this.emit()
    }
  }

  /**
   * Arrastre del mini por un delta de pixeles. Acoplado: mueve su esquina dentro
   * de TEK. Flotante: mueve la ventana del SO (arrastre manual, no nativo, para
   * que el doble-clic de la barra siga funcionando).
   */
  moveBy(dx: number, dy: number): void {
    if (!this.view) return
    if (this.mode === 'docked') {
      this.dockX += dx
      this.dockY += dy
      this.layout()
    } else if (this.floatWin && !this.floatWin.isDestroyed()) {
      // GOTCHA DPI (Windows, escala != 100%): setPosition/setBounds RE-LEYENDO la
      // geometria actual convierte px<->DIP con redondeo en cada paso; a 60+
      // eventos de arrastre por segundo el error se acumula y la ventana crece
      // sola. La cura: congelar la geometria al primer delta, acumular la
      // posicion en JS y mandar SIEMPRE el mismo ancho/alto (conversion
      // determinista = tamano estable, sin leer nada del SO durante el arrastre).
      if (!this.drag) {
        const b = this.floatWin.getBounds()
        this.drag = { x: b.x, y: b.y, w: b.width, h: b.height }
      }
      this.drag.x += dx
      this.drag.y += dy
      this.floatWin.setBounds({
        x: Math.round(this.drag.x),
        y: Math.round(this.drag.y),
        width: this.drag.w,
        height: this.drag.h
      })
      // El fin normal del arrastre es pipSnap (pointerup de la barra); el timer
      // es el paracaidas por si ese pointerup nunca llega.
      if (this.dragTimer) clearTimeout(this.dragTimer)
      this.dragTimer = setTimeout(() => this.endDrag(), 250)
    }
  }

  /**
   * Al soltar el arrastre. Acoplado: esquinas magneticas (ancla el mini a la
   * esquina mas cercana del area de contenido). Flotante: cierra el arrastre —
   * restaura el tamano canonico por si Windows lo desvio 1-2px y re-acomoda las
   * capas (la posicion queda libre y se recuerda).
   */
  snapToCorner(): void {
    if (!this.view) return
    if (this.mode !== 'docked') {
      this.endDrag()
      return
    }
    const [winW, winH] = this.win.getContentSize()
    const totalH = this.minimized ? BAR : BAR + this.h
    const left = this.dockX + this.w / 2 < winW / 2
    const top = this.dockY + totalH / 2 < (TOPBAR_HEIGHT + winH) / 2
    this.dockX = left ? MARGIN : winW - this.w - MARGIN
    this.dockY = top ? TOPBAR_HEIGHT + MARGIN : winH - totalH - MARGIN
    this.layout()
  }

  /** Refresca titulo/favicon (la pagina del mini cambio de titulo, p.ej.). */
  updateMeta(patch: Partial<Omit<PipMeta, 'tabId'>>): void {
    if (!this.meta) return
    this.meta = { ...this.meta, ...patch }
    this.emit()
  }

  /** Estado actual (lo pide la barra al montar y se empuja en cada cambio). */
  getState(): PipState {
    const wc = this.view?.webContents
    return {
      active: !!this.view,
      tabId: this.meta?.tabId ?? null,
      mode: this.mode,
      minimized: this.minimized,
      muted: wc && !wc.isDestroyed() ? wc.isAudioMuted() : false,
      title: this.meta?.title ?? '',
      host: this.meta?.host ?? '',
      favicon: this.meta?.favicon ?? null
    }
  }

  /**
   * Re-eleva las dos capas del mini por encima de las pestanas. Lo llama el
   * ViewManager tras cada cambio de pestana/layout (las child views se apilan
   * por orden de insercion: re-anadirlas las manda al tope; el chrome de ultimo
   * para quedar sobre el contenido).
   */
  raise(): void {
    if (this.mode !== 'docked' || !this.view || !this.chrome) return
    const cv = this.win.contentView
    try {
      cv.removeChildView(this.view)
      cv.addChildView(this.view)
      cv.removeChildView(this.chrome)
      cv.addChildView(this.chrome)
    } catch {
      /* alguna vista ya no existe */
    }
  }

  /** Activa/desactiva el throttling de fondo de una vista, sin reventar si ya murio. */
  private setThrottling(view: WebContentsView, on: boolean): void {
    const wc = view.webContents
    if (!wc.isDestroyed()) wc.setBackgroundThrottling(on)
  }

  /**
   * Empujon de repintado: al mover la vista entre contenedores (tomarla, soltarla
   * a flotante o reacoplarla) Chromium puede perder el surface del compositor y
   * dejar el <video> en NEGRO hasta el siguiente cambio. Un micro-resize de 1px
   * y de vuelta en el siguiente tick obliga a recomponer. Barato e idempotente.
   */
  private pokeRepaint(): void {
    const view = this.view
    if (!view) return
    const b = view.getBounds()
    view.setBounds({ ...b, height: Math.max(0, b.height + 1) })
    setTimeout(() => {
      if (this.view === view) view.setBounds(b)
    }, 0)
  }

  dispose(): void {
    // Rescatar el contenido a la principal si estaba flotando (su webContents lo
    // gestiona y destruye el ViewManager, no nosotros).
    if (this.view && this.mode === 'floating' && this.floatWin && !this.floatWin.isDestroyed()) {
      try {
        this.floatWin.contentView.removeChildView(this.view)
        if (!this.win.isDestroyed()) this.win.contentView.addChildView(this.view)
      } catch {
        /* ventana destruyendose */
      }
    }
    if (this.chrome) {
      try {
        if (!this.win.isDestroyed()) this.win.contentView.removeChildView(this.chrome)
      } catch {
        /* ya removida */
      }
      if (!this.chrome.webContents.isDestroyed()) this.chrome.webContents.close()
      this.chrome = null
    }
    this.destroyFloat()
    if (this.dragTimer) clearTimeout(this.dragTimer)
    this.view = null
    this.meta = null
    this.prefs.dispose()
  }

  // --- Interno ---------------------------------------------------------------

  /** Contenedor donde viven ahora las dos capas (principal o flotante). */
  private container(): View {
    return this.mode === 'floating' && this.floatWin && !this.floatWin.isDestroyed()
      ? this.floatWin.contentView
      : this.win.contentView
  }

  private ensureChrome(): void {
    if (this.chrome) return
    const chrome = new WebContentsView({
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        sandbox: true,
        contextIsolation: true
      }
    })
    chrome.setBackgroundColor(BAR_BG)
    this.chrome = chrome
    this.win.contentView.addChildView(chrome)
    this.loadChrome(chrome)
  }

  /** Coloca las dos capas segun el modo y el estado (minimizado o no). */
  private layout(): void {
    if (!this.view || !this.chrome) return
    // Ambas capas SIEMPRE visibles; el minimizado se logra con alto 0 del video
    // (no ocultandolo), asi el audio nunca se corta al colapsar a pildora.
    this.chrome.setVisible(true)
    this.view.setVisible(true)
    if (this.mode === 'floating' && this.floatWin && !this.floatWin.isDestroyed()) {
      const [w, h] = this.floatWin.getContentSize()
      this.chrome.setBounds({ x: 0, y: 0, width: w, height: BAR })
      this.view.setBounds({ x: 0, y: BAR, width: w, height: this.minimized ? 0 : Math.max(0, h - BAR) })
      return
    }
    // Acoplado: anclado a una esquina del area de contenido, clampado adentro.
    const [winW, winH] = this.win.getContentSize()
    const totalH = this.minimized ? BAR : BAR + this.h
    const x = Math.max(4, Math.min(this.dockX, winW - this.w - 4))
    const y = Math.max(TOPBAR_HEIGHT + 4, Math.min(this.dockY, winH - totalH - 4))
    this.dockX = x
    this.dockY = y
    this.chrome.setBounds({ x, y, width: this.w, height: BAR })
    this.view.setBounds({ x, y: y + BAR, width: this.w, height: this.minimized ? 0 : this.h })
  }

  /**
   * Cierra un arrastre del flotante: restaura el tamano canonico (por si el
   * redondeo DPI de Windows lo desvio unos px durante el arrastre) y re-acomoda
   * las capas para que el video llene la ventana exacta. Idempotente.
   */
  private endDrag(): void {
    if (this.dragTimer) {
      clearTimeout(this.dragTimer)
      this.dragTimer = null
    }
    this.drag = null
    const fw = this.floatWin
    if (this.mode !== 'floating' || !fw || fw.isDestroyed()) return
    const totalH = this.minimized ? BAR : BAR + this.h
    const [cw, ch] = fw.getContentSize()
    if (cw !== this.w || ch !== totalH) fw.setContentSize(this.w, totalH)
    this.layout()
  }

  private float(): void {
    if (!this.view || !this.chrome) return
    const winBounds = this.win.getBounds()
    // Reaparece donde la dejaste la ultima vez (si hay posicion recordada)...
    let x = this.prefs.data.floatX ?? winBounds.x + this.dockX
    let y = this.prefs.data.floatY ?? winBounds.y + this.dockY
    // ...pero SIEMPRE dentro del monitor: sana posiciones de un monitor ya
    // desconectado y tamanos mas grandes que la pantalla (herencia del bug DPI).
    const wa = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea
    this.w = Math.max(MIN_W, Math.min(this.w, wa.width))
    if (!this.minimized) this.h = Math.min(this.h, wa.height - BAR)
    const totalH = this.minimized ? BAR : BAR + this.h
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - this.w))
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - totalH))
    const fw = new BrowserWindow({
      width: this.w,
      height: totalH,
      x: Math.round(x),
      y: Math.round(y),
      frame: false,
      resizable: !this.minimized,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      minWidth: MIN_W,
      minHeight: BAR,
      backgroundColor: BAR_BG,
      hasShadow: true
    })
    // 'screen-saver' = flota incluso sobre apps a pantalla completa.
    fw.setAlwaysOnTop(true, 'screen-saver')
    fw.on('resize', () => {
      // Un resize MIENTRAS arrastras es ruido del redondeo DPI de Windows, no el
      // usuario redimensionando: ignorarlo (endDrag repara el tamano al soltar).
      // Persistirlo aqui era lo que dejaba grabado el tamano inflado.
      if (this.drag) return
      if (!this.minimized) {
        const [cw, ch] = fw.getContentSize()
        this.w = cw
        this.h = Math.max(0, ch - BAR)
        this.prefs.data.w = this.w
        this.prefs.data.h = this.h
        this.prefs.save()
      }
      this.layout()
    })
    // Recuerda la posicion del flotante (al arrastrar o si lo mueve el SO).
    fw.on('move', () => {
      const b = fw.getBounds()
      this.prefs.data.floatX = b.x
      this.prefs.data.floatY = b.y
      this.prefs.save()
    })
    // Si la OS cierra la flotante (Alt+F4), rescatamos el contenido a la
    // principal antes de que muera con la ventana, y avisamos para salir del PiP.
    fw.on('close', () => {
      if (this.view && this.floatWin && !this.floatWin.isDestroyed()) {
        try {
          this.floatWin.contentView.removeChildView(this.view)
          this.win.contentView.addChildView(this.view)
        } catch {
          /* ya rescatada */
        }
        this.mode = 'docked'
      }
      this.onWantExit?.()
    })
    this.floatWin = fw
    // Mover las dos capas de la principal a la flotante (contenido, luego barra).
    try {
      this.win.contentView.removeChildView(this.chrome)
      this.win.contentView.removeChildView(this.view)
    } catch {
      /* ya removidas */
    }
    fw.contentView.addChildView(this.view)
    fw.contentView.addChildView(this.chrome)
    this.mode = 'floating'
    this.layout()
    this.pokeRepaint()
    this.emit()
  }

  private dock(): void {
    const fw = this.floatWin
    if (!this.view || !this.chrome) return
    if (fw && !fw.isDestroyed()) {
      try {
        fw.contentView.removeChildView(this.chrome)
        fw.contentView.removeChildView(this.view)
      } catch {
        /* ya removidas */
      }
    }
    this.win.contentView.addChildView(this.view)
    this.win.contentView.addChildView(this.chrome)
    this.mode = 'docked'
    this.destroyFloat()
    this.layout()
    this.raise()
    this.pokeRepaint()
    this.emit()
  }

  private destroyFloat(): void {
    // Un arrastre a medias muere con la ventana.
    if (this.dragTimer) {
      clearTimeout(this.dragTimer)
      this.dragTimer = null
    }
    this.drag = null
    const fw = this.floatWin
    this.floatWin = null
    if (fw && !fw.isDestroyed()) {
      // Quitamos TODOS los listeners (close ya lo manejamos a mano; move/resize no
      // deben dispararse sobre la ventana mientras se destruye).
      fw.removeAllListeners()
      fw.destroy()
    }
  }

  /** Empuja el estado a la barra del mini y al shell (para marcar la pestana). */
  private emit(): void {
    const s = this.getState()
    if (this.chrome && !this.chrome.webContents.isDestroyed()) {
      this.chrome.webContents.send(IPC.pipState, s)
    }
    if (!this.win.isDestroyed()) this.win.webContents.send(IPC.pipState, s)
  }
}
