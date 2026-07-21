import { globalShortcut } from 'electron'
import { WV, hostKey, type MediaState, type NowPlaying } from '@shared/ipc'
import { JsonStore } from './dev/jsonStore'

/** Lo que el preload de una pagina reporta de su MediaSession (ya saneado aqui). */
interface WcMedia {
  title: string
  artist: string
  artwork: string | null
  playing: boolean
  canNext: boolean
  canPrev: boolean
  /**
   * ¿Es un reproductor DE VERDAD (metadata/handlers de MediaSession o un medio
   * de >=20s)? El sonidito de notificacion de WhatsApp reporta playing pero
   * real=false: JAMAS se adueña de los controles ni dispara el modo exclusivo.
   */
  real: boolean
  /** Ultima vez que este webContents estuvo sonando (decide quien es "el que suena"). */
  playingAt: number
  /** Cuando DEJO de sonar (0 = nunca o esta sonando). Base del caducado. */
  stoppedAt: number
}

/** Pausado mas de esto = los controles se retiran (nada de zombies de ayer). */
const OWNER_TTL = 30 * 60_000

/**
 * Sitios que SON un reproductor de musica: con varias pestanas sonando (o
 * pausadas), estos ganan los controles frente a un video cualquiera. A
 * proposito NO incluye youtube.com a secas (un video normal no es "tu musica");
 * music.youtube.com si.
 */
const MUSIC_SITES = [
  'music.youtube.com',
  'open.spotify.com',
  'spotify.com',
  'music.apple.com',
  'soundcloud.com',
  'bandcamp.com',
  'deezer.com',
  'tidal.com'
]

function isMusicSite(host: string): boolean {
  return MUSIC_SITES.some((m) => host === m || host.endsWith(`.${m}`))
}

/** Puentes minimos hacia el ViewManager (se conectan al crear la ventana). */
export interface MediaDeps {
  /** webContents de una pestana por id (o null si ya no existe). */
  wcOfTab(tabId: string): Electron.WebContents | null
  /** id de pestana para un webContents.id (o null si no es una pestana). */
  tabIdOfWcId(wcId: number): string | null
  /** Pestanas que estan sonando ahora mismo (id + webContents vivo). */
  audibleTabs(): { id: string; wc: Electron.WebContents | null }[]
  /** webContents de la pestana activa (destino de las teclas si nada suena). */
  activeWc(): Electron.WebContents | null
}

type MediaAction = 'playpause' | 'pause' | 'next' | 'prev'

/**
 * Musica de TEK: quien suena, con que metadatos, y como controlarlo.
 *
 *  - "Ahora suena": junta los reportes de MediaSession de cada pestana (via el
 *    preload) y elige la dueña — la que suena ahora o la ultima que sono. El
 *    shell pinta el chip con titulo/artista/caratula y botones.
 *  - Teclas multimedia GLOBALES (play/pausa, siguiente, anterior): van a la
 *    pestaña dueña aunque TEK este de fondo. Requiere apagar
 *    HardwareMediaKeyHandling (ver index.ts): con el activo, Chromium se traga
 *    las teclas antes de que globalShortcut las vea.
 *  - "Una sola pestana sonando a la vez" (opcional, persistido): cuando una
 *    pestana empieza a sonar, TEK pausa las demas. Pausa de verdad (pause()),
 *    no mute: silenciar dejando el video correr te hace perder el contenido.
 */
export class Media {
  private readonly store = new JsonStore<{ exclusive: boolean }>('tek-media.json', {
    exclusive: false
  })
  private readonly byWc = new Map<number, WcMedia>()
  private deps: MediaDeps | null = null
  /** Rechequeos pendientes del modo exclusivo (el flag `real` llega ~150ms tarde). */
  private readonly retries = new Map<string, NodeJS.Timeout>()
  /** Push del estado al shell (lo inyecta index.ts). */
  onState: ((s: MediaState) => void) | null = null

  attach(deps: MediaDeps | null): void {
    this.deps = deps
    this.byWc.clear()
    for (const t of this.retries.values()) clearTimeout(t)
    this.retries.clear()
  }

  /** Teclas multimedia del sistema -> pestana que suena. */
  registerKeys(): void {
    const bind = (accel: string, action: MediaAction): void => {
      try {
        globalShortcut.register(accel, () => this.control(action))
      } catch {
        /* otra app se quedo la tecla: TEK sigue sin ella */
      }
    }
    bind('MediaPlayPause', 'playpause')
    bind('MediaNextTrack', 'next')
    bind('MediaPreviousTrack', 'prev')
    bind('MediaStop', 'pause')
  }

  /** Reporte del preload de una pagina (wv:mediaMeta). Payload NO confiable. */
  handleMeta(sender: Electron.WebContents, payload: unknown): void {
    if (!this.deps || sender.isDestroyed()) return
    // Solo pestanas de TEK (el shell y popups no pintan aqui).
    if (!this.deps.tabIdOfWcId(sender.id)) return
    const p = (payload ?? {}) as Record<string, unknown>
    const prev = this.byWc.get(sender.id)
    const playing = p['playing'] === true
    this.byWc.set(sender.id, {
      title: typeof p['title'] === 'string' ? p['title'].slice(0, 200) : '',
      artist: typeof p['artist'] === 'string' ? p['artist'].slice(0, 200) : '',
      artwork:
        typeof p['artwork'] === 'string' && /^https?:\/\//i.test(p['artwork'])
          ? p['artwork'].slice(0, 2000)
          : null,
      playing,
      canNext: p['canNext'] === true,
      canPrev: p['canPrev'] === true,
      real: p['real'] === true,
      playingAt: playing ? Date.now() : prev?.playingAt ?? 0,
      // El caducado cuenta desde que DEJO de sonar (no desde que empezo: una
      // cancion de 2 horas no debe caducar al pausarla).
      stoppedAt: playing ? 0 : prev?.playing ? Date.now() : prev?.stoppedAt ?? 0
    })
    this.emit()
  }

  /**
   * Una pestana empezo a sonar (lo avisa ViewManager con el mismo evento que
   * enciende el altavoz de la pestana). Con el modo exclusivo: pausa las demas
   * — pero SOLO si quien arranca es un reproductor real. Sin ese filtro, el
   * sonidito de notificacion de WhatsApp te pausaba la musica.
   */
  onAudible(tabId: string): void {
    this.emit()
    if (!this.store.data.exclusive || !this.deps) return
    if (this.isReal(tabId)) {
      this.pauseOthers(tabId)
      return
    }
    // El flag `real` viaja con el reporte del preload (debounce ~150ms) y puede
    // llegar DESPUES del evento de audio: un unico recheck decide.
    const old = this.retries.get(tabId)
    if (old) clearTimeout(old)
    this.retries.set(
      tabId,
      setTimeout(() => {
        this.retries.delete(tabId)
        if (!this.store.data.exclusive || !this.deps) return
        const stillAudible = this.deps.audibleTabs().some((t) => t.id === tabId)
        if (stillAudible && this.isReal(tabId)) this.pauseOthers(tabId)
      }, 700)
    )
  }

  /** ¿La pestana se declaro reproductor de verdad (ver WcMedia.real)? */
  private isReal(tabId: string): boolean {
    const wc = this.deps?.wcOfTab(tabId)
    return !!wc && !wc.isDestroyed() && this.byWc.get(wc.id)?.real === true
  }

  private pauseOthers(tabId: string): void {
    if (!this.deps) return
    for (const t of this.deps.audibleTabs()) {
      if (t.id === tabId || !t.wc || t.wc.isDestroyed()) continue
      t.wc.send(WV.mediaControl, 'pause')
    }
  }

  /** Accion sobre la pestana dueña (chip del shell o tecla multimedia). */
  control(action: MediaAction): void {
    if (!this.deps) return
    const wc = this.ownerWc() ?? this.deps.activeWc()
    if (wc && !wc.isDestroyed()) wc.send(WV.mediaControl, action)
  }

  setExclusive(on: boolean): MediaState {
    this.store.data.exclusive = on === true
    this.store.save()
    const s = this.state()
    this.onState?.(s)
    return s
  }

  state(): MediaState {
    return { now: this.now(), exclusive: this.store.data.exclusive }
  }

  /** La pestaña dueña de la musica: la que suena, o la ultima que sono. */
  private ownerWc(): Electron.WebContents | null {
    const owner = this.owner()
    return owner ? this.deps?.wcOfTab(owner.tabId) ?? null : null
  }

  private owner(): { tabId: string; wcId: number; m: WcMedia } | null {
    if (!this.deps) return null
    let best: { tabId: string; wcId: number; m: WcMedia; score: number } | null = null
    for (const [wcId, m] of this.byWc) {
      const tabId = this.deps.tabIdOfWcId(wcId)
      if (!tabId) {
        this.byWc.delete(wcId) // la pestana ya no existe: fuera del mapa
        continue
      }
      if (m.playingAt === 0) continue // nunca ha sonado: no puede ser dueña
      if (!m.real) continue // un ping de notificacion no es un reproductor
      // Jerarquia: sonando > pausado, y dentro de cada nivel un sitio DE MUSICA
      // (Spotify, YT Music...) gana a un video cualquiera. El desempate es
      // quien sono mas recientemente.
      const wc = this.deps.wcOfTab(tabId)
      const music = wc && !wc.isDestroyed() ? isMusicSite(hostKey(wc.getURL())) : false
      const score = ((m.playing ? 2 : 0) + (music ? 1 : 0)) * 1e15 + m.playingAt
      if (!best || score > best.score) best = { tabId, wcId, m, score }
    }
    return best
  }

  private now(): NowPlaying | null {
    const owner = this.owner()
    if (!owner || !this.deps) return null
    // Pausado demasiado tiempo: los controles se retiran solos.
    if (!owner.m.playing && owner.m.stoppedAt && Date.now() - owner.m.stoppedAt > OWNER_TTL)
      return null
    const wc = this.deps.wcOfTab(owner.tabId)
    if (!wc || wc.isDestroyed()) return null
    return {
      tabId: owner.tabId,
      title: owner.m.title || wc.getTitle(),
      artist: owner.m.artist,
      artwork: owner.m.artwork,
      playing: owner.m.playing,
      canNext: owner.m.canNext,
      canPrev: owner.m.canPrev,
      // El host sale del webContents, no de lo que diga la pagina.
      host: hostKey(wc.getURL())
    }
  }

  private emit(): void {
    this.onState?.(this.state())
  }

  dispose(): void {
    try {
      globalShortcut.unregister('MediaPlayPause')
      globalShortcut.unregister('MediaNextTrack')
      globalShortcut.unregister('MediaPreviousTrack')
      globalShortcut.unregister('MediaStop')
    } catch {
      /* app cerrandose */
    }
    for (const t of this.retries.values()) clearTimeout(t)
    this.retries.clear()
    this.byWc.clear()
    this.deps = null
    this.store.dispose()
  }
}
