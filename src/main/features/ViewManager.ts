import { WebContentsView, Menu, Notification, app, clipboard, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import {
  IPC,
  TOPBAR_HEIGHT,
  WV,
  hostKey,
  type FindOptions,
  type PipState,
  type SessionPeek,
  type TabMeta,
  type TabsState,
  type UiCommand
} from '@shared/ipc'
import { clearSession, loadSession, saveSession, type SavedSession } from './persist'
import { cleanUserAgent, needsCleanUA } from './Compat'
import { Brain, isMusicHost } from './brain/Brain'
import { MiniPlayer, type PipMeta } from './MiniPlayer'
import type { Adblock } from './adblock/Adblock'
import type { Favicons } from './Favicons'

interface Tab {
  id: string
  view: WebContentsView
  blank: boolean
  /** Clave de grupo = host del sitio. '' mientras es pestana en blanco. */
  group: string
  /** Fila de visita en el cerebro a la que se le acumula el dwell. */
  visitId: number | null
  /** ¿Suena ahora? Con histeresis: no se apaga en los silencios momentaneos. */
  audible: boolean
  /** Apagado diferido del indicador de audio (para que no parpadee). */
  audibleOffTimer: NodeJS.Timeout | null
}

/** Particion persistente compartida: cookies/login sobreviven a los reinicios. */
const PARTITION = 'persist:tek'

/** Niveles de zoom de pagina (factor), estilo navegador. 1 = 100%. */
const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/** Alto (px) de la barra "buscar en pagina"; la vista activa baja para dejarle sitio. */
const FINDBAR_HEIGHT = 46

/**
 * Tras callar, cuanto espera el indicador de audio de una pestana antes de
 * apagarse. Cubre los silencios momentaneos del contenido (entre dialogos en
 * Netflix, una pausa corta...) para que el iconito no parpadee. Imita a Chrome.
 */
const AUDIBLE_OFF_DELAY = 3000

let counter = 0
const nextId = (): string => `t${++counter}`

/**
 * Saca un tamano razonable del string `features` de `window.open`
 * (p. ej. "popup,width=500,height=600"), con topes sanos y un fallback
 * comodo para los popups de login (Google/GitHub) que no siempre piden medidas.
 */
function popupSize(features: string): { width: number; height: number } {
  const read = (re: RegExp, def: number): number => {
    const m = re.exec(features || '')
    const n = m ? parseInt(m[1], 10) : NaN
    return Number.isFinite(n) ? Math.min(Math.max(n, 320), 1400) : def
  }
  return { width: read(/width\s*=\s*(\d+)/i, 520), height: read(/height\s*=\s*(\d+)/i, 660) }
}

/**
 * CSS "solo reproductor" para YouTube: oculta el resto de la pagina (cabecera,
 * recomendaciones, comentarios) y hace que el player llene la ventanita del mini.
 * Asi el mini muestra el video, no la pagina entera encogida. Se inyecta al
 * entrar en PiP y se revierte al salir.
 */
const YT_PIP_CSS = `
  ytd-app #masthead-container,
  ytd-app #secondary,
  ytd-app #below,
  ytd-app #comments,
  ytd-watch-metadata,
  tp-yt-app-drawer#guide,
  ytd-popup-container,
  #chips-wrapper,
  ytd-merch-shelf-renderer,
  #related { display: none !important; }

  ytd-watch-flexy #full-bleed-container,
  ytd-watch-flexy #player,
  #player-container-outer,
  #player-container,
  #player-container-inner {
    position: fixed !important;
    top: 0 !important; left: 0 !important;
    width: 100vw !important; height: 100vh !important;
    max-width: 100vw !important; max-height: 100vh !important;
    min-width: 0 !important; min-height: 0 !important;
    margin: 0 !important; padding: 0 !important;
    z-index: 9999 !important;
  }
  #movie_player, .html5-video-player { width: 100% !important; height: 100% !important; }
  video.video-stream.html5-main-video {
    width: 100% !important; height: 100% !important;
    top: 0 !important; left: 0 !important;
    object-fit: contain !important;
  }
  html, body { overflow: hidden !important; margin: 0 !important; background: #000 !important; }
`

/** CSS de recorte "solo reproductor" para un host, o null si no aplica. */
function pipSiteCss(host: string): string | null {
  if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return YT_PIP_CSS
  return null
}

/**
 * Gestiona las pestanas, cada una con su WebContentsView. Solo la activa es
 * visible y ocupa el area bajo la TopBar. Patron clave (de Sanctum): la vista
 * activa se oculta cuando un overlay del renderer (palette) necesita el foco.
 *
 * Ademas: persiste la sesion en disco, agrupa por dominio, y comparte una
 * sesion persistente con un User-Agent limpio (sin token Electron) para que
 * sitios como Google permitan iniciar sesion.
 */
export class ViewManager {
  private readonly win: BrowserWindow
  private tabs: Tab[] = []
  private activeId: string | null = null
  /** El renderer pidio ocultar la vista (overlay abierto). */
  private overlayHidden = false
  /** Pestanas cerradas recientemente, para reabrir con Ctrl+Shift+T (cap 25). */
  private closedTabs: { url: string; group: string }[] = []
  /** La barra "buscar en pagina" esta abierta (la vista baja FINDBAR_HEIGHT). */
  private findOpen = false
  /** Franjas inferiores reservadas por origen (px): la vista se encoge por abajo
   *  para dejar ver un toast del renderer (la vista nativa lo taparia). Cada
   *  superficie (contrasenas, descargas...) reserva con su clave; vale el mayor.
   *  Mapa vacio = sin reserva. */
  private bottomInsets = new Map<string, number>()
  /** Sesion guardada pendiente de decidir (reanudar o descartar). */
  private pending: SavedSession | null
  private persistTimer: NodeJS.Timeout | null = null
  /** Cerebro de TEK: aprende de la navegacion. */
  readonly brain: Brain
  /** Adblock (3 capas). */
  readonly adblock: Adblock
  /** Cache de favicons por host (para los accesos directos). */
  readonly favicons: Favicons
  /** Mini-player (Picture-in-Picture): un video en pequeño mientras navegas. */
  private readonly mini: MiniPlayer
  /** CSS inyectado en la pagina del mini (recorte "solo reproductor"); para revertir. */
  private pipCss: { wc: Electron.WebContents; key: string } | null = null
  /** Visita a la que ahora mismo se le acumula tiempo de permanencia. */
  private timingId: number | null = null
  private timingSince = 0
  /** Emit throttled cuando el adblock va bloqueando (refresca el contador). */
  private countEmitTimer: NodeJS.Timeout | null = null
  /** Hooks de automatizacion (los cablea index.ts): navegacion y dom-ready. */
  onNavigate: ((tabId: string, url: string, host: string, wc: Electron.WebContents) => void) | null =
    null
  onDomReady: ((tabId: string, wc: Electron.WebContents) => void) | null = null
  /** ¿Abrir DevTools solas al navegar a este host? (ajuste localhost). */
  shouldAutoDevtools: ((host: string) => boolean) | null = null
  /** UA default de la app (las pestanas vuelven a ella al salir de un host quisquilloso). */
  private readonly defaultUA = app.userAgentFallback

  constructor(
    win: BrowserWindow,
    brain: Brain,
    adblock: Adblock,
    favicons: Favicons,
    loadPipChrome: (view: WebContentsView) => void
  ) {
    this.win = win
    this.brain = brain
    this.adblock = adblock
    this.favicons = favicons
    this.mini = new MiniPlayer(win, loadPipChrome)
    // Si la OS cierra la ventana flotante del mini, salimos del PiP limpiamente.
    this.mini.onWantExit = () => this.exitPip(false)
    this.win.on('resize', () => this.layout())
    // El dwell solo corre cuando la ventana tiene el foco.
    this.win.on('blur', () => this.accrue())
    this.win.on('focus', () => this.resumeTiming())
    // Cuando el adblock bloquea algo, refresca el contador sin saturar.
    this.adblock.onBlocked = () => this.scheduleCountEmit()

    // SIN manipulacion de User-Agent / Client Hints: dejamos el comportamiento
    // por defecto de Electron. Tocarlo solo empeoraba el login de Google.
    // Lo unico que conservamos es la particion persistente `persist:tek` (definida
    // en cada WebContentsView) para que la sesion/cookies sobrevivan a reinicios.

    const saved = loadSession()
    this.pending = saved && saved.tabs.length > 0 ? saved : null
  }

  private get active(): Tab | null {
    return this.tabs.find((t) => t.id === this.activeId) ?? null
  }

  private shouldShowActive(): boolean {
    const a = this.active
    return !!a && !a.blank && !this.overlayHidden
  }

  private layout(): void {
    const a = this.active
    if (!a) return
    const [w, h] = this.win.getContentSize()
    if (this.shouldShowActive()) {
      // Con la barra de busqueda abierta, la vista baja para dejar su franja
      // visible (no se puede flotar un overlay sobre la vista nativa).
      const top = TOPBAR_HEIGHT + (this.findOpen ? FINDBAR_HEIGHT : 0)
      // La franja inferior (toast de contrasena) se descuenta del alto: deja un
      // hueco abajo donde el renderer (y su toast) quedan visibles sobre la pagina.
      a.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top - this.bottomInset) })
    } else {
      a.view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
  }

  private applyVisibility(): void {
    const showActive = this.shouldShowActive()
    const pipId = this.mini.tabId
    for (const t of this.tabs) {
      // La pestana en el mini la gobierna el MiniPlayer: su vista NO entra en el
      // toggle normal (si no, la ocultariamos por no ser la activa).
      if (t.id === pipId) continue
      const isActive = t.id === this.activeId
      t.view.setVisible(isActive && showActive)
    }
    this.layout()
    // El mini siempre por encima de la pestana activa (re-eleva su z-order).
    if (this.mini.active) this.mini.raise()
    // El foco del teclado sigue a lo que se ve: a la pagina activa cuando esta a
    // la vista; al renderer (shell) cuando hay un overlay encima o es pestana en
    // blanco. Asi la paleta, los paneles y la nueva pestana reciben flechas/Enter
    // SIN un clic previo, y al cerrar la paleta la pagina recupera el teclado.
    // (Era la causa de "no responde hasta dar click".)
    if (showActive) {
      const wc = this.active?.view.webContents
      if (wc && !wc.isDestroyed()) wc.focus()
    } else if (!this.win.isDestroyed()) {
      this.win.webContents.focus()
    }
  }

  // --- Tiempo de permanencia (dwell) -----------------------------------------

  /** Cierra el cronometro actual: vuelca el tiempo acumulado al cerebro. */
  private accrue(): void {
    if (this.timingId !== null) {
      this.brain.addDwell(this.timingId, Date.now() - this.timingSince)
      this.timingId = null
    }
  }

  /** (Re)arranca el cronometro sobre la pestana activa si esta visible. */
  private resumeTiming(): void {
    this.accrue()
    const a = this.active
    if (a && a.visitId !== null && this.shouldShowActive()) {
      this.timingId = a.visitId
      this.timingSince = Date.now()
    }
  }

  /** Si la URL es una busqueda, aprende el texto para el ⌘K. */
  private learnQuery(url: string): void {
    try {
      const u = new URL(url)
      const q = u.searchParams.get('q') ?? u.searchParams.get('search_query')
      if (q) this.brain.recordQuery(q)
    } catch {
      /* no es una URL con busqueda */
    }
  }

  /**
   * Reordena las pestanas para que las del mismo grupo (host) queden contiguas,
   * conservando el orden de aparicion de cada grupo. Las pestanas en blanco no
   * se agrupan: se quedan donde estan (clave unica por id).
   */
  private regroup(): void {
    const firstSeen = new Map<string, number>()
    this.tabs.forEach((t, i) => {
      const key = t.group || `solo:${t.id}`
      if (!firstSeen.has(key)) firstSeen.set(key, i)
    })
    const rank = (t: Tab): number => firstSeen.get(t.group || `solo:${t.id}`) ?? 0
    this.tabs = this.tabs
      .map((t, i) => ({ t, i }))
      .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
      .map((x) => x.t)
  }

  /**
   * Avanza el zoom de pagina un nivel en la direccion dada. Lee el factor actual,
   * busca el nivel mas cercano en ZOOM_LEVELS y se mueve un paso, clampado a los
   * extremos. Fija el valor autoritativo, asi no hay desfases con Chromium.
   */
  private stepZoom(wc: Electron.WebContents, dir: 'in' | 'out'): void {
    if (wc.isDestroyed()) return
    const current = wc.getZoomFactor()
    // Indice del nivel mas proximo al factor actual.
    let nearest = 0
    for (let i = 1; i < ZOOM_LEVELS.length; i++) {
      if (Math.abs(ZOOM_LEVELS[i] - current) < Math.abs(ZOOM_LEVELS[nearest] - current)) {
        nearest = i
      }
    }
    const next = dir === 'in' ? nearest + 1 : nearest - 1
    const clamped = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, next))
    wc.setZoomFactor(ZOOM_LEVELS[clamped])
  }

  /**
   * Aplica la UA que toca para una URL: la limpia (sin tokens tek/Electron) en
   * los hosts quisquillosos tipo WhatsApp, la default en todo lo demas. Se llama
   * ANTES de cada carga para que tanto el header como navigator.userAgent ya
   * esten bien cuando la pagina ejecute su deteccion de navegador.
   */
  private applyUaFor(wc: Electron.WebContents, url: string): void {
    if (wc.isDestroyed()) return
    const want = needsCleanUA(hostKey(url)) ? cleanUserAgent() : this.defaultUA
    if (wc.getUserAgent() !== want) wc.setUserAgent(want)
  }

  private wire(tab: Tab): void {
    const wc = tab.view.webContents
    const push = (): void => this.emit()

    // UA por sitio: clic en enlace (will-navigate) y redirecciones/navegaciones
    // de cualquier origen (did-start-navigation) reevaluan la UA al vuelo.
    wc.on('will-navigate', (e, url) => {
      // Defensa en profundidad: una pagina solo navega (top-level) a esquemas web.
      // file://, blob:, data:, javascript:… se cancelan. Los esquemas externos
      // conocidos (mailto:/tel:/…) los abre la app del sistema, como un navegador.
      if (!/^https?:\/\//i.test(url) && url !== 'about:blank') {
        e.preventDefault()
        if (/^(mailto|tel|sms|webcal|magnet):/i.test(url)) void shell.openExternal(url)
        return
      }
      this.applyUaFor(wc, url)
    })
    wc.on('did-start-navigation', (_e, url, _inPlace, isMainFrame) => {
      if (isMainFrame) this.applyUaFor(wc, url)
    })
    // Un popup creado desde esta pestana (login OAuth) tambien queda blindado:
    // sus window.open pasan por el mismo control que los de una pestana.
    wc.on('did-create-window', (child) => this.hardenPopup(child))

    // Zoom visual nativo APAGADO (1..1): la LUPA la hace el preload con un
    // transform CSS (el pinch no llega como gesto nativo en esta maquina y el
    // CDP setPageScaleFactor probo ser no-op en desktop). Con esto no puede
    // haber doble mecanismo.
    wc.setVisualZoomLevelLimits(1, 1)
    // Ctrl+rueda que NO capturo el preload (p. ej. dentro de un iframe, donde
    // el preload no corre): Chromium lo reporta como zoom-changed sin aplicar
    // nada. Lo resolvemos como zoom de pagina por pasos.
    wc.on('zoom-changed', (_e, direction) => this.stepZoom(wc, direction))
    // Atajos de teclado con la PAGINA enfocada: sus teclas no llegan al renderer,
    // asi que los resolvemos aqui (zoom, recargar, find, paleta, pestanas...).
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown') this.handleShortcut(e, input, wc)
    })
    // Menu contextual NATIVO (clic derecho): se dibuja por ENCIMA de la vista
    // nativa; un menu de React quedaria detras de ella y seria invisible.
    wc.on('context-menu', (_e, params) => this.showPageMenu(wc, params))
    // Resultado de "buscar en pagina": lo reenviamos al renderer (solo si es la
    // pestana activa) para que la FindBar muestre coincidencia activa / total.
    wc.on('found-in-page', (_e, result) => {
      if (tab.id === this.activeId && !this.win.isDestroyed()) {
        this.win.webContents.send(IPC.foundInPage, {
          active: result.activeMatchOrdinal,
          total: result.matches
        })
      }
    })
    wc.on('did-start-loading', push)
    wc.on('did-stop-loading', push)
    wc.on('did-navigate', () => {
      tab.blank = false
      tab.group = hostKey(wc.getURL())
      // Nueva carga: el contador de bloqueos de esta pestana empieza de cero.
      this.adblock.resetCount(wc.id)
      // El cerebro registra cada carga real de pagina como una visita.
      tab.visitId = this.brain.recordVisit(tab.group, wc.getURL(), wc.getTitle())
      this.regroup()
      this.applyVisibility()
      // La pagina cambio: reinicia el cronometro de dwell sobre la nueva visita.
      this.resumeTiming()
      this.emit()
      // Automatizacion: disparadores de visita, grabacion de macros, etc.
      this.onNavigate?.(tab.id, wc.getURL(), tab.group, wc)
      // Modo dev: DevTools solas al caer en localhost (si el ajuste esta on).
      if (this.shouldAutoDevtools?.(tab.group) && !wc.isDevToolsOpened()) {
        wc.openDevTools({ mode: 'detach' })
      }
    })
    // El DOM ya existe: inyeccion de userscripts y aviso de credenciales.
    wc.on('dom-ready', () => {
      if (!tab.blank) this.onDomReady?.(tab.id, wc)
    })
    wc.on('did-navigate-in-page', push)
    wc.on('page-title-updated', (_e, title) => {
      if (tab.visitId !== null) this.brain.updateTitle(tab.visitId, title)
      if (tab.id === this.mini.tabId) this.mini.updateMeta({ title })
      push()
    })
    // La pagina declara su favicon: lo cacheamos (accesos directos + pestanas).
    wc.on('page-favicon-updated', (_e, favicons) => {
      const icon = favicons?.[0]
      if (tab.group && icon) {
        void this.favicons.capture(tab.group, icon).then(() => {
          if (tab.id === this.mini.tabId) this.mini.updateMeta({ favicon: this.favicons.get(tab.group) })
          this.emit()
        })
      }
    })
    // Cuando empieza a sonar audio en un sitio de musica, lo aprendemos.
    wc.on('media-started-playing', () => {
      if (isMusicHost(tab.group)) this.brain.recordMusic(tab.group, wc.getURL(), wc.getTitle())
    })
    // El estado de audio cambia: actualiza el indicador CON HISTERESIS, asi no
    // parpadea en los silencios momentaneos del contenido (entre dialogos, etc.).
    wc.on('audio-state-changed', () => this.updateAudible(tab))
    // La pagina se cierra sola (p. ej. Google hace window.close() al terminar el
    // login): retiramos la pestana en vez de dejar un webContents muerto que
    // reventaria metaOf/serialize.
    wc.on('destroyed', () => this.handleDestroyed(tab.id))
    wc.setWindowOpenHandler((details) => {
      const { url, disposition, features } = details
      // Un POPUP de verdad (window.open con features, o disposition 'new-window')
      // suele ser un flujo que DEPENDE de window.opener + postMessage para
      // devolver su resultado a la pagina que lo abrio: el login con Google de
      // Claude/GitHub, pasarelas de pago, etc. Si lo denegaramos y lo abrieramos
      // como pestana suelta, esa pestana NO tendria window.opener -> el
      // postMessage de vuelta se pierde y la pagina se queda en "hubo un error al
      // iniciar sesion". Por eso lo abrimos como ventana hija REAL (misma
      // particion: comparte cookies/sesion), que conserva el opener y se
      // autocierra con su window.close() al terminar el login.
      const wantsPopup = disposition === 'new-window' || (!!features && features.trim() !== '')
      if (wantsPopup) {
        const { width, height } = popupSize(features)
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: this.win,
            width,
            height,
            minimizable: false,
            fullscreenable: false,
            autoHideMenuBar: true,
            webPreferences: {
              partition: PARTITION,
              contextIsolation: true,
              sandbox: true,
              nodeIntegration: false
            }
          }
        }
      }
      // Links target=_blank / ctrl+click -> pestana de TEK (cae en su grupo).
      // Solo esquemas web: nada de file:// ni protocolos raros desde una pagina.
      if (/^https?:\/\//i.test(url)) this.create(url)
      return { action: 'deny' }
    })
  }

  /**
   * Blinda una ventana hija (popup OAuth): sus window.open quedan bajo el mismo
   * control que los de una pestana (popup real -> ventana hija endurecida;
   * target=_blank -> pestana de TEK; esquemas raros -> nada). Recursivo: los
   * nietos tambien quedan blindados. Sin esto, un popup podria abrir ventanas
   * sin restricciones.
   */
  private hardenPopup(win: Electron.BrowserWindow): void {
    const cwc = win.webContents
    // Mismo guard de esquemas que una pestana: un popup solo navega a la web.
    cwc.on('will-navigate', (e, url) => {
      if (!/^https?:\/\//i.test(url) && url !== 'about:blank') {
        e.preventDefault()
        if (/^(mailto|tel|sms|webcal|magnet):/i.test(url)) void shell.openExternal(url)
      }
    })
    cwc.setWindowOpenHandler(({ url, disposition, features }) => {
      const wantsPopup = disposition === 'new-window' || (!!features && features.trim() !== '')
      if (wantsPopup) {
        const { width, height } = popupSize(features)
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: this.win,
            width,
            height,
            minimizable: false,
            fullscreenable: false,
            autoHideMenuBar: true,
            webPreferences: {
              partition: PARTITION,
              contextIsolation: true,
              sandbox: true,
              nodeIntegration: false
            }
          }
        }
      }
      if (/^https?:\/\//i.test(url)) this.create(url)
      return { action: 'deny' }
    })
    cwc.on('did-create-window', (grandchild) => this.hardenPopup(grandchild))
  }

  /** Retira una pestana cuyo webContents fue destruido por la propia pagina. */
  private handleDestroyed(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return // ya la habia removido close()/dispose()
    // Si la pestana destruida estaba en el mini, soltarlo (su vista ya muere).
    if (this.mini.tabId === id) {
      void this.removePipSiteCss()
      this.mini.release()
    }
    if (id === this.activeId) this.accrue()
    const [tab] = this.tabs.splice(idx, 1)
    if (tab.audibleOffTimer) clearTimeout(tab.audibleOffTimer)
    try {
      if (!this.win.isDestroyed()) this.win.contentView.removeChildView(tab.view)
    } catch {
      /* la vista ya no existe */
    }
    if (this.activeId === id) {
      const neighbor = this.tabs[idx] ?? this.tabs[idx - 1] ?? null
      this.activeId = neighbor?.id ?? null
    }
    if (this.tabs.length === 0) {
      this.create() // nunca dejar el navegador sin pestanas
      return
    }
    this.applyVisibility()
    this.resumeTiming()
    this.emit()
  }

  /** ¿El webContents de la pestana sigue vivo y usable? */
  private liveWc(tab: Tab): Electron.WebContents | null {
    const wc = tab.view.webContents
    return wc && !wc.isDestroyed() ? wc : null
  }

  /**
   * Actualiza el indicador de audio con HISTERESIS: enciende al instante cuando
   * suena, pero al callar espera AUDIBLE_OFF_DELAY antes de apagarlo. Asi los
   * silencios momentaneos del contenido no hacen parpadear el iconito. Como
   * Chrome: el icono se queda mientras la pestana "esta sonando".
   */
  private updateAudible(tab: Tab): void {
    const wc = this.liveWc(tab)
    const sounding = !!wc && wc.isCurrentlyAudible()
    if (sounding) {
      if (tab.audibleOffTimer) {
        clearTimeout(tab.audibleOffTimer)
        tab.audibleOffTimer = null
      }
      if (!tab.audible) {
        tab.audible = true
        this.emit()
      }
    } else if (tab.audible && !tab.audibleOffTimer) {
      tab.audibleOffTimer = setTimeout(() => {
        tab.audibleOffTimer = null
        const live = this.liveWc(tab)
        if (live && live.isCurrentlyAudible()) return // volvio a sonar: sigue encendido
        tab.audible = false
        this.emit()
      }, AUDIBLE_OFF_DELAY)
    }
  }

  private metaOf(tab: Tab): TabMeta {
    const wc = this.liveWc(tab)
    if (!wc) {
      // webContents destruido a medio vuelo: meta minima hasta que se limpie.
      return {
        id: tab.id,
        title: 'Nueva pestaña',
        url: '',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        blank: true,
        group: '',
        audible: false,
        muted: false,
        blocked: 0,
        favicon: null,
        pip: tab.id === this.mini.tabId
      }
    }
    return {
      id: tab.id,
      title: tab.blank ? 'Nueva pestaña' : wc.getTitle() || wc.getURL(),
      url: tab.blank ? '' : wc.getURL(),
      loading: !tab.blank && wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      blank: tab.blank,
      group: tab.blank ? '' : tab.group,
      audible: !tab.blank && tab.audible,
      muted: wc.isAudioMuted(),
      blocked: tab.blank ? 0 : this.adblock.blockedFor(wc.id),
      favicon: tab.blank ? null : this.favicons.get(tab.group),
      pip: tab.id === this.mini.tabId
    }
  }

  private emit(): void {
    if (this.win.isDestroyed()) return
    const state: TabsState = {
      tabs: this.tabs.map((t) => this.metaOf(t)),
      activeId: this.activeId
    }
    this.win.webContents.send('tabs:state', state)
    this.schedulePersist()
  }

  /** Emit del contador de bloqueos, como mucho cada ~700ms (evita saturar). */
  private scheduleCountEmit(): void {
    if (this.countEmitTimer) return
    this.countEmitTimer = setTimeout(() => {
      this.countEmitTimer = null
      this.emit()
    }, 700)
  }

  // --- Persistencia ----------------------------------------------------------

  private serialize(): SavedSession {
    const tabs = this.tabs.map((t) => {
      const wc = this.liveWc(t)
      return {
        url: t.blank || !wc ? '' : wc.getURL(),
        blank: t.blank,
        group: t.group
      }
    })
    const activeIndex = Math.max(
      0,
      this.tabs.findIndex((t) => t.id === this.activeId)
    )
    return { tabs, activeIndex }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => saveSession(this.serialize()), 400)
  }

  // --- Construccion interna de pestanas --------------------------------------

  /** Crea la WebContentsView y la registra, sin tocar foco ni emitir estado. */
  private spawn(url?: string): Tab {
    // Solo esquemas web: una URL rara (file://, javascript:) abre en blanco.
    const safe = url && /^https?:\/\//i.test(url) ? url : undefined
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        // contextIsolation:false a proposito: el preload corre en el MAIN WORLD
        // para (a) capturar el pinch/Ctrl+rueda del zoom y (b) podar los anuncios
        // de video de YouTube en document-start (sobrescribir el fetch/JSON.parse
        // de la propia pagina). Mantenemos sandbox + sin nodeIntegration, y el
        // preload no expone nada a `window`, asi el riesgo queda acotado.
        contextIsolation: false,
        sandbox: true,
        nodeIntegration: false,
        // El visor PDF de Chromium cuenta como "plugin": sin esto los PDF se
        // descargan en vez de verse en la pestana.
        plugins: true,
        preload: join(import.meta.dirname, '../preload/webview.cjs')
      }
    })
    // Fondo OPACO (no transparente): mientras la pagina hace su primer paint, una
    // vista transparente dejaria ver el shell de detras (el lienzo "nueva pestana"
    // y la paleta a medio cerrar), que ademas pueden quedar congelados un instante
    // al perder el foco. Con un fondo solido se ve el color de la app y luego la
    // pagina — nunca el shell fantasma. (Era la causa de "la paleta no se quita
    // hasta dar clic afuera": no era la paleta, era la vista transparente encima.)
    view.setBackgroundColor('#060607')
    const tab: Tab = {
      id: nextId(),
      view,
      blank: !safe,
      group: safe ? hostKey(safe) : '',
      visitId: null,
      audible: false,
      audibleOffTimer: null
    }
    this.win.contentView.addChildView(view)
    this.tabs.push(tab)
    this.wire(tab)
    if (safe) {
      this.applyUaFor(view.webContents, safe)
      void view.webContents.loadURL(safe).catch(() => undefined)
    }
    return tab
  }

  // --- API publica -----------------------------------------------------------

  /** Crea una pestana. Si recibe url, navega; si no, queda como lienzo en blanco. */
  create(url?: string): void {
    this.createReturning(url)
  }

  /** Como create(), pero devuelve el id (lo usan el puente y las macros). */
  createReturning(url?: string): string {
    if (url) this.learnQuery(url)
    const tab = this.spawn(url)
    this.activeId = tab.id
    this.regroup()
    this.applyVisibility()
    this.resumeTiming()
    this.emit()
    return tab.id
  }

  /** webContents VIVO de una pestana por id (o null). */
  wcOfTab(id: string): Electron.WebContents | null {
    const tab = this.tabs.find((t) => t.id === id)
    return tab ? this.liveWc(tab) : null
  }

  /** Camino inverso: de que pestana es este webContents (por su id de Electron). */
  tabIdOfWcId(wcId: number): string | null {
    const tab = this.tabs.find((t) => this.liveWc(t)?.id === wcId)
    return tab?.id ?? null
  }

  /** webContents VIVO de la pestana activa con pagina (o null). */
  activeWc(): Electron.WebContents | null {
    const a = this.active
    if (!a || a.blank) return null
    return this.liveWc(a)
  }

  /** Vista plana de pestanas para el puente de agentes. */
  tabsForBridge(): { id: string; title: string; url: string; active: boolean }[] {
    return this.tabs.map((t) => {
      const wc = this.liveWc(t)
      return {
        id: t.id,
        title: t.blank || !wc ? 'Nueva pestaña' : wc.getTitle(),
        url: t.blank || !wc ? '' : wc.getURL(),
        active: t.id === this.activeId
      }
    })
  }

  /** Abre/cierra DevTools de la pestana activa (accion de receta). */
  openDevtoolsActive(): void {
    const wc = this.activeWc()
    if (wc && !wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' })
  }

  close(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    // Si la pestana esta en el mini, sacala primero (su vista vuelve a la pestana).
    if (this.mini.tabId === id) this.exitPip(false)
    if (id === this.activeId) this.accrue()
    const [tab] = this.tabs.splice(idx, 1)
    if (tab.audibleOffTimer) clearTimeout(tab.audibleOffTimer)
    // Antes de destruirla, recordamos su URL para Ctrl+Shift+T (solo paginas reales).
    const wc = !tab.view.webContents.isDestroyed() ? tab.view.webContents : null
    if (!tab.blank && wc) {
      const url = wc.getURL()
      if (url && url !== 'about:blank') {
        this.closedTabs.push({ url, group: tab.group })
        if (this.closedTabs.length > 25) this.closedTabs.shift()
      }
    }
    try {
      this.win.contentView.removeChildView(tab.view)
      if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close()
    } catch {
      /* la vista ya estaba destruida */
    }
    if (this.activeId === id) {
      const neighbor = this.tabs[idx] ?? this.tabs[idx - 1] ?? null
      this.activeId = neighbor?.id ?? null
    }
    this.applyVisibility()
    this.resumeTiming()
    this.emit()
  }

  activate(id: string): void {
    if (!this.tabs.some((t) => t.id === id)) return
    this.accrue()
    this.activeId = id
    this.applyVisibility()
    this.resumeTiming()
    this.emit()
  }

  /** Silencia o reactiva el audio de una pestana (aunque no este activa). */
  setMuted(id: string, muted: boolean): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    tab.view.webContents.setAudioMuted(muted)
    this.emit()
  }

  /** Convierte la pestana activa en lienzo "nueva pestana" (boton casita). */
  home(): void {
    const a = this.active
    if (!a) {
      this.create()
      return
    }
    a.blank = true
    a.group = ''
    this.regroup()
    this.applyVisibility()
    this.emit()
  }

  navigate(url: string): void {
    // La barra/paleta solo producen web o about:blank; cualquier otro esquema
    // (file://, javascript:) se ignora — defensa en profundidad.
    if (!/^https?:\/\//i.test(url) && url !== 'about:blank') return
    this.learnQuery(url)
    const a = this.active
    if (!a) {
      this.create(url)
      return
    }
    a.blank = false
    a.group = hostKey(url)
    this.applyUaFor(a.view.webContents, url)
    void a.view.webContents.loadURL(url).catch(() => undefined)
    this.regroup()
    this.applyVisibility()
    this.emit()
  }

  goBack(): void {
    const wc = this.active?.view.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  goForward(): void {
    const wc = this.active?.view.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(): void {
    this.active?.view.webContents.reload()
  }

  stop(): void {
    this.active?.view.webContents.stop()
  }

  /** Inset inferior efectivo: el mayor de los reservados (0 si ninguno). */
  private get bottomInset(): number {
    let max = 0
    for (const v of this.bottomInsets.values()) if (v > max) max = v
    return max
  }

  /**
   * Reserva una franja inferior (px) encogiendo la vista activa, para que un
   * toast del renderer (p. ej. "¿guardar contraseña?") sea visible sobre la
   * pagina nativa. Cada `source` reserva por separado y vale el MAYOR, asi dos
   * toasts a la vez no se pisan la reserva. px<=0 libera la franja de ese source.
   * Solo recalcula el layout si el inset efectivo cambia.
   */
  setBottomInset(source: string, px: number): void {
    const next = Math.max(0, Math.round(px) || 0)
    const before = this.bottomInset
    if (next <= 0) this.bottomInsets.delete(source)
    else this.bottomInsets.set(source, next)
    if (this.bottomInset !== before) this.layout()
  }

  /** El renderer abre/cierra un overlay: ocultamos o restauramos la vista activa. */
  setOverlayVisible(visible: boolean): void {
    this.overlayHidden = !visible
    this.applyVisibility()
    // Con un overlay encima (palette) la pagina no se esta "usando": pausa el dwell.
    if (visible) this.resumeTiming()
    else this.accrue()
  }

  // --- Mini-player (Picture-in-Picture) --------------------------------------

  /** Metadatos para la barra del mini (titulo/host/favicon del sitio). */
  private pipMetaOf(tab: Tab): PipMeta {
    const wc = this.liveWc(tab)
    return {
      tabId: tab.id,
      title: wc ? wc.getTitle() || wc.getURL() : 'Mini-player',
      host: tab.group,
      favicon: this.favicons.get(tab.group)
    }
  }

  /**
   * Manda una pestana al mini-player (sin id = la activa). Como su vista se va a
   * la esquina, dejamos OTRA pestana ocupando el area principal (o creamos una en
   * blanco si era la unica) para que el usuario pueda seguir navegando.
   */
  enterPip(tabId?: string): void {
    const tab = tabId ? this.tabs.find((t) => t.id === tabId) : this.active
    if (!tab || tab.blank || !this.liveWc(tab)) return
    // Un solo mini a la vez: si habia otro, su vista vuelve a su pestana.
    if (this.mini.active) this.exitPip(false)
    if (this.activeId === tab.id) {
      const other = this.tabs.find((t) => t.id !== tab.id)
      this.activeId = other ? other.id : this.spawn().id
    }
    this.mini.take(tab.view, this.pipMetaOf(tab))
    // En sitios como YouTube, recorta a "solo reproductor" para que la ventanita
    // no muestre la pagina entera encogida (Netflix ya es casi todo player).
    void this.applyPipSiteCss(tab)
    this.regroup()
    this.applyVisibility()
    this.resumeTiming()
    this.emit()
  }

  /** Atajo: manda la activa al mini, o si ya hay uno, lo cierra y vuelve a la pestana. */
  togglePip(): void {
    if (this.mini.active) this.exitPip(true)
    else this.enterPip()
  }

  /** Cierra el mini; la vista vuelve a su pestana. activate=true la abre full. */
  exitPip(activate: boolean): void {
    if (!this.mini.active) return
    const id = this.mini.tabId
    void this.removePipSiteCss()
    this.mini.release()
    if (activate && id) {
      this.activate(id)
    } else {
      this.applyVisibility()
      this.emit()
    }
  }

  togglePipFloat(): void {
    this.mini.toggleFloat()
  }

  togglePipMinimize(): void {
    this.mini.toggleMinimize()
  }

  setPipMuted(muted: boolean): void {
    this.mini.setMuted(muted)
  }

  pipMoveBy(dx: number, dy: number): void {
    this.mini.moveBy(dx, dy)
  }

  pipSnap(): void {
    this.mini.snapToCorner()
  }

  pipState(): PipState {
    return this.mini.getState()
  }

  /** Inyecta el recorte "solo reproductor" si el sitio lo tiene (p. ej. YouTube). */
  private async applyPipSiteCss(tab: Tab): Promise<void> {
    const wc = this.liveWc(tab)
    const css = pipSiteCss(tab.group)
    if (!wc || !css) return
    try {
      const key = await wc.insertCSS(css)
      this.pipCss = { wc, key }
      // YouTube calcula el tamano del <video> por JS al ULTIMO evento 'resize'.
      // Recortar a "solo player" con CSS no dispara resize, asi que el video se
      // queda al tamano que tenia la pagina entera encogida (diminuto/negro en la
      // ventanita). Forzamos un par de resize para que el reproductor recalcule y
      // LLENE el mini (el segundo, diferido, cubre la inicializacion asincrona).
      await wc
        .executeJavaScript(
          "window.dispatchEvent(new Event('resize')); setTimeout(() => window.dispatchEvent(new Event('resize')), 300)",
          true
        )
        .catch(() => undefined)
    } catch {
      /* la pagina no dejo inyectar CSS */
    }
  }

  /** Revierte el recorte "solo reproductor" (al salir del mini). */
  private async removePipSiteCss(): Promise<void> {
    const inj = this.pipCss
    this.pipCss = null
    if (!inj || inj.wc.isDestroyed()) return
    try {
      await inj.wc.removeInsertedCSS(inj.key)
    } catch {
      /* ya no estaba inyectado */
    }
  }

  // --- Pestanas: reabrir, duplicar, cerrar en lote ---------------------------

  /** Reabre la ultima pestana cerrada (Ctrl+Shift+T). Si no hay, no hace nada. */
  reopenClosed(): void {
    const last = this.closedTabs.pop()
    if (last) this.create(last.url)
  }

  /** Duplica una pestana: crea otra con su misma URL (o en blanco si lo estaba). */
  duplicate(id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    const wc = this.liveWc(tab)
    this.create(tab.blank || !wc ? undefined : wc.getURL())
  }

  /**
   * Mueve una pestana (arrastre en la barra): la inserta antes de `beforeId`,
   * o al final con null. Semantica "antes de X" en vez de indices para que un
   * cierre a mitad de arrastre no descoloque nada. regroup() mantiene los
   * grupos contiguos: mover una pestana agrupada delante de otro grupo arrastra
   * su grupo entero; soltarla dentro de otro grupo la reacomoda a su borde.
   */
  move(id: string, beforeId: string | null): void {
    if (id === beforeId) return
    const from = this.tabs.findIndex((t) => t.id === id)
    if (from === -1) return
    const [tab] = this.tabs.splice(from, 1)
    const at = beforeId ? this.tabs.findIndex((t) => t.id === beforeId) : -1
    if (at === -1) this.tabs.push(tab)
    else this.tabs.splice(at, 0, tab)
    this.regroup()
    this.emit()
  }

  /** Cierra todas las pestanas menos la indicada. */
  closeOthers(id: string): void {
    for (const tid of this.tabs.filter((t) => t.id !== id).map((t) => t.id)) this.close(tid)
  }

  /** Cierra las pestanas a la derecha de la indicada. */
  closeRight(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id)
    if (idx === -1) return
    for (const tid of this.tabs.slice(idx + 1).map((t) => t.id)) this.close(tid)
  }

  // --- Buscar en la pagina ---------------------------------------------------

  /** Busca `text` en la pagina activa. Texto vacio -> limpia la busqueda. */
  find(text: string, opts: FindOptions = {}): void {
    const wc = this.active?.view.webContents
    if (!wc || wc.isDestroyed()) return
    // findInPage lanza con cadena vacia: en ese caso limpiamos en su lugar.
    if (!text) {
      wc.stopFindInPage('clearSelection')
      return
    }
    wc.findInPage(text, {
      forward: opts.forward ?? true,
      findNext: opts.findNext ?? false,
      matchCase: opts.matchCase ?? false
    })
  }

  /** Detiene la busqueda y quita los resaltados de la pagina activa. */
  stopFind(): void {
    const wc = this.active?.view.webContents
    if (wc && !wc.isDestroyed()) wc.stopFindInPage('clearSelection')
  }

  /** Abre/cierra la barra de busqueda: baja/sube la vista para hacerle hueco. */
  setFindOpen(open: boolean): void {
    this.findOpen = open
    if (!open) this.stopFind()
    this.layout()
  }

  // --- Atajos de teclado (pagina enfocada) + menus contextuales --------------

  /** Pide al renderer una accion de UI (paleta/find/nueva pestana). */
  private sendUi(cmd: UiCommand): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(IPC.uiCommand, cmd)
  }

  /** Activa la pestana en la posicion `i` (clampada al rango valido). */
  private activateIndex(i: number): void {
    const tab = this.tabs[Math.max(0, Math.min(this.tabs.length - 1, i))]
    if (tab) this.activate(tab.id)
  }

  /** Cicla a la pestana siguiente/anterior (con vuelta circular). */
  private cycleTab(dir: 1 | -1): void {
    if (this.tabs.length < 2) return
    const i = this.tabs.findIndex((t) => t.id === this.activeId)
    const n = this.tabs.length
    this.activate(this.tabs[(i + dir + n) % n].id)
  }

  /**
   * Resuelve un atajo de teclado con la PAGINA enfocada. Para acciones que
   * necesitan UI del renderer (paleta/find/nueva pestana) delega via IPC.
   */
  private handleShortcut(e: Electron.Event, input: Electron.Input, wc: Electron.WebContents): void {
    const ctrl = input.control || input.meta
    const { shift, alt, key } = input
    const low = key.toLowerCase()

    // Zoom de pagina.
    if (ctrl && (key === '=' || key === '+')) {
      e.preventDefault()
      this.stepZoom(wc, 'in')
    } else if (ctrl && key === '-') {
      e.preventDefault()
      this.stepZoom(wc, 'out')
    } else if (ctrl && key === '0') {
      e.preventDefault()
      wc.setZoomFactor(1)
      wc.send(WV.lupaReset) // Ctrl+0 tambien quita la lupa (la aplica el preload)
    }
    // Recargar (Ctrl+R / F5; con Shift ignora la cache).
    else if ((ctrl && low === 'r') || key === 'F5') {
      e.preventDefault()
      if (shift) wc.reloadIgnoringCache()
      else wc.reload()
    }
    // Buscar en pagina (Ctrl+F).
    else if (ctrl && low === 'f') {
      e.preventDefault()
      this.sendUi('find')
    }
    // Paleta de comandos (Ctrl+K / Ctrl+L).
    else if (ctrl && (low === 'k' || low === 'l')) {
      e.preventDefault()
      this.sendUi('palette')
    }
    // Mini-player (Ctrl+Shift+P): manda la pestana al mini, o lo cierra si ya hay uno.
    else if (ctrl && shift && low === 'p') {
      e.preventDefault()
      this.togglePip()
    }
    // Nueva pestana (Ctrl+T) / reabrir cerrada (Ctrl+Shift+T).
    else if (ctrl && low === 't') {
      e.preventDefault()
      if (shift) this.reopenClosed()
      else this.sendUi('newtab')
    }
    // Cerrar pestana activa (Ctrl+W).
    else if (ctrl && low === 'w') {
      e.preventDefault()
      if (this.activeId) this.close(this.activeId)
    }
    // Ciclar pestanas (Ctrl+Tab / Ctrl+Shift+Tab).
    else if (ctrl && key === 'Tab') {
      e.preventDefault()
      this.cycleTab(shift ? -1 : 1)
    }
    // Ir a la pestana N (Ctrl+1..8) o la ultima (Ctrl+9).
    else if (ctrl && /^[1-9]$/.test(key)) {
      e.preventDefault()
      this.activateIndex(key === '9' ? this.tabs.length - 1 : Number(key) - 1)
    }
    // Navegacion atras/adelante (Alt+flechas).
    else if (alt && key === 'ArrowLeft') {
      e.preventDefault()
      this.goBack()
    } else if (alt && key === 'ArrowRight') {
      e.preventDefault()
      this.goForward()
    }
    // Pantalla completa (F11).
    else if (key === 'F11') {
      e.preventDefault()
      this.win.setFullScreen(!this.win.isFullScreen())
    }
    // DevTools (F12).
    else if (key === 'F12') {
      e.preventDefault()
      if (wc.isDevToolsOpened()) wc.closeDevTools()
      else wc.openDevTools({ mode: 'detach' })
    }
  }

  /** Menu contextual de la pagina (clic derecho), con items segun el `params`. */
  private showPageMenu(wc: Electron.WebContents, params: Electron.ContextMenuParams): void {
    const items: Electron.MenuItemConstructorOptions[] = []
    const { linkURL, srcURL, mediaType, selectionText, isEditable, editFlags, x, y } = params

    if (linkURL) {
      items.push(
        { label: 'Abrir enlace en pestaña nueva', click: () => this.create(linkURL) },
        { label: 'Copiar enlace', click: () => clipboard.writeText(linkURL) },
        { type: 'separator' }
      )
    }
    if (mediaType === 'image' && srcURL) {
      items.push(
        { label: 'Abrir imagen en pestaña nueva', click: () => this.create(srcURL) },
        { label: 'Guardar imagen', click: () => wc.downloadURL(srcURL) },
        { label: 'Copiar dirección de la imagen', click: () => clipboard.writeText(srcURL) },
        { type: 'separator' }
      )
    }
    if (selectionText && !isEditable) {
      const q = selectionText.trim()
      const short = q.length > 24 ? `${q.slice(0, 24)}…` : q
      items.push(
        { label: 'Copiar', click: () => wc.copy() },
        {
          label: `Buscar «${short}» en Google`,
          click: () => this.create(`https://www.google.com/search?q=${encodeURIComponent(q)}`)
        },
        { type: 'separator' }
      )
    }
    if (isEditable) {
      items.push(
        { label: 'Cortar', enabled: editFlags.canCut, click: () => wc.cut() },
        { label: 'Copiar', enabled: editFlags.canCopy, click: () => wc.copy() },
        { label: 'Pegar', enabled: editFlags.canPaste, click: () => wc.paste() },
        { label: 'Seleccionar todo', click: () => wc.selectAll() },
        { type: 'separator' }
      )
    }
    // Siempre: navegacion + utilidades.
    items.push(
      {
        label: 'Atrás',
        enabled: wc.navigationHistory.canGoBack(),
        click: () => wc.navigationHistory.goBack()
      },
      {
        label: 'Adelante',
        enabled: wc.navigationHistory.canGoForward(),
        click: () => wc.navigationHistory.goForward()
      },
      { label: 'Recargar', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Copiar dirección de la página', click: () => clipboard.writeText(wc.getURL()) },
      { label: 'Copiar como cURL', click: () => void this.copyAsCurl(wc) },
      { label: 'Captura de página completa', click: () => void this.captureFullPage(wc) },
      { label: 'Inspeccionar elemento', click: () => wc.inspectElement(x, y) }
    )
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  /** Copia un comando curl equivalente a la pagina actual (con sus cookies). */
  private async copyAsCurl(wc: Electron.WebContents): Promise<void> {
    if (wc.isDestroyed()) return
    const url = wc.getURL()
    // Escapado POSIX para comillas simples: 'a'\''b'.
    const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
    const parts = [`curl ${sq(url)}`, `-H ${sq(`User-Agent: ${wc.getUserAgent()}`)}`]
    try {
      const cookies = await wc.session.cookies.get({ url })
      if (cookies.length > 0) {
        parts.push(`-b ${sq(cookies.map((c) => `${c.name}=${c.value}`).join('; '))}`)
      }
    } catch {
      /* sin cookies disponibles: el curl va igual */
    }
    parts.push('--compressed')
    clipboard.writeText(parts.join(' \\\n  '))
  }

  /**
   * Captura la pagina ENTERA (no solo el viewport) via CDP
   * `captureBeyondViewport`; si el debugger no se deja, cae a capturePage.
   * Guarda el PNG en Descargas y avisa con notificacion nativa (clic = carpeta).
   */
  private async captureFullPage(wc: Electron.WebContents): Promise<void> {
    if (wc.isDestroyed()) return
    let png: Buffer | null = null
    const dbg = wc.debugger
    const wasAttached = dbg.isAttached()
    try {
      if (!wasAttached) dbg.attach('1.3')
      const { data } = (await dbg.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
      })) as { data: string }
      png = Buffer.from(data, 'base64')
    } catch {
      png = null
    } finally {
      try {
        if (!wasAttached && dbg.isAttached()) dbg.detach()
      } catch {
        /* ya despegado */
      }
    }
    if (!png) {
      try {
        png = (await wc.capturePage()).toPNG()
      } catch {
        return
      }
    }
    const host = hostKey(wc.getURL()) || 'pagina'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = join(app.getPath('downloads'), `tek-captura-${host}-${stamp}.png`)
    try {
      await writeFile(file, png)
    } catch {
      return
    }
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'Captura guardada', body: file })
      n.on('click', () => shell.showItemInFolder(file))
      n.show()
    }
  }

  /** Menu contextual de una pestana (clic derecho en su pestana de la TopBar). */
  showTabMenu(id: string): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab) return
    const wc = this.liveWc(tab)
    const muted = wc?.isAudioMuted() ?? false
    const idx = this.tabs.findIndex((t) => t.id === id)
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: 'Recargar', enabled: !tab.blank && !!wc, click: () => wc?.reload() },
      { label: 'Duplicar', click: () => this.duplicate(id) },
      {
        label: muted ? 'Reactivar audio' : 'Silenciar pestaña',
        click: () => this.setMuted(id, !muted)
      },
      {
        label: tab.id === this.mini.tabId ? 'Quitar del mini-player' : 'Ver en mini-player',
        enabled: !tab.blank && !!wc,
        click: () => (tab.id === this.mini.tabId ? this.exitPip(true) : this.enterPip(id))
      },
      { type: 'separator' },
      { label: 'Cerrar', click: () => this.close(id) },
      {
        label: 'Cerrar las demás',
        enabled: this.tabs.length > 1,
        click: () => this.closeOthers(id)
      },
      {
        label: 'Cerrar las de la derecha',
        enabled: idx >= 0 && idx < this.tabs.length - 1,
        click: () => this.closeRight(id)
      }
    ]
    Menu.buildFromTemplate(items).popup({ window: this.win })
  }

  // --- Sesion guardada -------------------------------------------------------

  /** Resumen de la sesion previa (o null si no hay nada que reanudar). */
  peek(): SessionPeek | null {
    return this.pending ? { count: this.pending.tabs.length } : null
  }

  /** Reanuda la sesion: recrea todas las pestanas y carga sus paginas. */
  restore(): void {
    const s = this.pending
    this.pending = null
    if (!s || s.tabs.length === 0) {
      this.create()
      return
    }
    const created = s.tabs.map((t) => this.spawn(t.blank ? undefined : t.url))
    const target = created[s.activeIndex] ?? created[created.length - 1]
    this.activeId = target?.id ?? null
    this.regroup()
    this.applyVisibility()
    this.emit()
  }

  /** Descarta la sesion guardada y arranca con una pestana en blanco. */
  discard(): void {
    this.pending = null
    clearSession()
    this.create()
  }

  dispose(): void {
    this.accrue()
    if (this.persistTimer) clearTimeout(this.persistTimer)
    if (this.countEmitTimer) clearTimeout(this.countEmitTimer)
    this.adblock.onBlocked = null
    // Cierra la barra del mini y la ventana flotante; rescata la vista de contenido
    // a la principal para que el bucle de abajo cierre su webContents con normalidad.
    this.mini.dispose()
    // 'closed' se dispara cuando la ventana YA esta destruida: tocar
    // this.win.contentView lanzaria "Object has been destroyed". Si la ventana
    // sigue viva (cierre programatico) si despegamos las vistas; en cualquier
    // caso cerramos cada webContents con guarda.
    const winAlive = !this.win.isDestroyed()
    for (const t of this.tabs) {
      if (t.audibleOffTimer) clearTimeout(t.audibleOffTimer)
      try {
        if (winAlive) this.win.contentView.removeChildView(t.view)
        if (!t.view.webContents.isDestroyed()) t.view.webContents.close()
      } catch {
        /* la vista ya estaba destruida con la ventana; nada que limpiar */
      }
    }
    this.tabs = []
    this.activeId = null
  }
}
