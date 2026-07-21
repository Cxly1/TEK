import { app } from 'electron'
// OJO, import POR DEFECTO y no `import { autoUpdater }`: electron-updater es
// CommonJS y declara sus exports con `Object.defineProperty(exports, ...)`, que
// el analizador de Node NO detecta. Como este main se compila a ESM
// ("type":"module"), el import con nombre revienta EN PRODUCCION con
// "does not provide an export named 'autoUpdater'" (comprobado antes de
// escribir esto). Ademas se accede a `.autoUpdater` DENTRO de los metodos, no
// aqui arriba: ese getter construye el NsisUpdater al tocarlo.
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@shared/ipc'
import { JsonStore } from './dev/jsonStore'

/**
 * Actualizacion de TEK contra las releases de GitHub.
 *
 * DECISION: NADA se descarga sin permiso. `autoDownload = false`, asi que al
 * encontrar version nueva nos quedamos en `available` esperando respuesta. Una
 * vez descargada si se instala sola al cerrar TEK (`autoInstallOnAppQuit`), que
 * es el unico momento en que no molesta.
 *
 * Lo que se dice "ahora no" se recuerda por VERSION: no se vuelve a ofrecer esa,
 * pero la siguiente si. Pedirlo a mano desde el menu borra ese olvido.
 *
 * CONTEXTO DE SEGURIDAD (importante): TEK no esta firmada con un certificado
 * Authenticode, asi que electron-updater NO puede verificar la firma del
 * instalador que baja. La confianza se apoya en HTTPS contra GitHub y en el
 * sha512 que viene en `latest.yml` (integridad, no autoria). Es el mismo nivel
 * que bajar el .exe a mano de la pagina de releases. Si algun dia hay
 * certificado, electron-updater empieza a verificar solo, sin tocar esto.
 *
 * REQUISITO DEL RELEASE: hay que subir `latest.yml` junto al .exe o esto da 404.
 */

/** Primera comprobacion: con retraso, arrancar el navegador tiene prioridad. */
const FIRST_CHECK_MS = 25_000
/** Y luego cada 6 horas mientras TEK siga abierta. */
const EVERY_MS = 6 * 60 * 60 * 1000

interface UpdatePrefs {
  /** Version que se dijo "ahora no". No se vuelve a ofrecer sola. */
  skipped: string
}

/** Notas de la release a texto plano y acotadas (GitHub las manda en HTML). */
function plainNotes(raw: unknown): string {
  const html = Array.isArray(raw)
    ? raw
        .map((r) => (r && typeof r === 'object' ? String((r as { note?: string }).note ?? '') : String(r)))
        .join('\n')
    : typeof raw === 'string'
      ? raw
      : ''
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // &amp; EL ULTIMO: antes de los demas, "&amp;lt;" acabaria decodificado dos
    // veces (-> "<") en vez de quedarse en el "&lt;" literal que era.
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

/** Traduce los fallos tipicos a algo que se pueda leer sin ser programador. */
function friendlyError(msg: string): string {
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|ECONNREFUSED|ECONNRESET/i.test(msg)) {
    return 'No se pudo conectar con GitHub para comprobar si hay una versión nueva.'
  }
  if (/404/.test(msg)) {
    return 'La última versión publicada todavía no trae los archivos de actualización.'
  }
  if (/sha512|checksum/i.test(msg)) {
    return 'La descarga no coincide con lo esperado y se descartó. Se puede reintentar.'
  }
  return msg.split('\n')[0].slice(0, 200)
}

export class Updater {
  private readonly prefs = new JsonStore<UpdatePrefs>('tek-update.json', { skipped: '' })
  private state: UpdateState = { phase: 'idle', version: '', notes: '', percent: 0, error: '' }
  private firstTimer: NodeJS.Timeout | null = null
  private timer: NodeJS.Timeout | null = null
  private wired = false
  /** La comprobacion en curso la pidio la persona: hay que contestarle siempre. */
  private manual = false

  constructor(private readonly emit: (s: UpdateState) => void) {}

  getState(): UpdateState {
    return { ...this.state }
  }

  /** Arranca las comprobaciones periodicas. No-op fuera del TEK instalado. */
  start(): void {
    if (!app.isPackaged) return
    this.wire()
    if (this.firstTimer || this.timer) return
    this.firstTimer = setTimeout(() => {
      this.firstTimer = null
      void this.check(false)
    }, FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(false), EVERY_MS)
  }

  private wire(): void {
    if (this.wired) return
    this.wired = true
    const au = electronUpdater.autoUpdater
    au.autoDownload = false
    au.autoInstallOnAppQuit = true

    au.on('checking-for-update', () => this.set({ phase: 'checking', error: '' }))

    au.on('update-available', (info) => {
      // Ya dijo "ahora no" a ESTA version: no insistimos (salvo que lo pida el).
      if (!this.manual && this.prefs.data.skipped === info.version) {
        this.set({ phase: 'idle' })
        return
      }
      this.set({
        phase: 'available',
        version: info.version,
        notes: plainNotes(info.releaseNotes),
        percent: 0,
        error: ''
      })
    })

    au.on('update-not-available', () =>
      this.set({ phase: 'idle', version: '', notes: '', percent: 0, error: '' })
    )

    au.on('download-progress', (p) =>
      this.set({ phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent))) })
    )

    au.on('update-downloaded', (info) =>
      this.set({ phase: 'ready', version: info.version, percent: 100, error: '' })
    )

    au.on('error', (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[TEK Updater]', msg)
      // Que falle una comprobacion de fondo NO se enseña: no hay nada que la
      // persona pueda hacer y solo seria ruido. Si lo pidio el, o si se cayo a
      // mitad de una descarga que estaba viendo, entonces si se cuenta.
      const visible = this.manual || this.state.phase === 'downloading'
      this.manual = false
      if (visible) this.set({ phase: 'error', error: friendlyError(msg) })
      else this.set({ phase: 'idle' })
    })
  }

  /** Busca version nueva. `manual` = lo pidio la persona desde el menu. */
  async check(manual = false): Promise<UpdateState> {
    if (!app.isPackaged) {
      return manual
        ? this.set({
            phase: 'error',
            error: 'Las actualizaciones solo funcionan en TEK instalado, no en modo desarrollo.'
          })
        : this.state
    }
    this.wire()
    // Con algo ya en marcha no se pisa lo que hay.
    if (this.state.phase === 'downloading' || this.state.phase === 'ready') return this.state
    // Y una oferta que sigue en pantalla tampoco: el re-chequeo de fondo (cada
    // 6h) la haria parpadear (la fase 'checking' oculta el toast) o esfumarse
    // si justo entonces no hay red. A mano si se re-mira.
    if (!manual && this.state.phase === 'available') return this.state
    this.manual = manual
    // Pedirlo a mano borra el "ahora no" guardado: es una peticion explicita.
    if (manual && this.prefs.data.skipped) {
      this.prefs.data.skipped = ''
      this.prefs.save()
    }
    try {
      await electronUpdater.autoUpdater.checkForUpdates()
    } catch {
      /* el manejador de 'error' ya dejo el estado como toca */
    }
    return this.state
  }

  /** Descarga la version ofrecida (solo tras un si explicito). */
  async download(): Promise<UpdateState> {
    if (!app.isPackaged || this.state.phase !== 'available') return this.state
    this.set({ phase: 'downloading', percent: 0, error: '' })
    try {
      await electronUpdater.autoUpdater.downloadUpdate()
    } catch {
      /* idem: lo cuenta el manejador de 'error' */
    }
    return this.state
  }

  /** Cierra TEK y aplica la actualizacion ya descargada. */
  install(): void {
    if (!app.isPackaged || this.state.phase !== 'ready') return
    // Fuera del tick del IPC (recomendacion de electron-updater). isSilent=false
    // para que el instalador se vea; isForceRunAfter=true para que TEK vuelva.
    setImmediate(() => electronUpdater.autoUpdater.quitAndInstall(false, true))
  }

  /** "Ahora no": se recuerda la version para no volver a ofrecerla sola. */
  dismiss(): UpdateState {
    // Cerrar un ERROR no veta la version: que se cayera la descarga no es decir
    // "esta no la quiero". Solo cuentan "ahora no" (available) y "al cerrar"
    // (ready, donde ademas evita volver a dar la lata por algo que ya se
    // instalara solo al salir).
    if (this.state.version && this.state.phase !== 'error') {
      this.prefs.data.skipped = this.state.version
      this.prefs.save()
    }
    return this.set({ phase: 'idle', percent: 0, error: '' })
  }

  private set(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch }
    this.emit(this.getState())
    return this.state
  }

  dispose(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer)
    if (this.timer) clearInterval(this.timer)
    this.firstTimer = null
    this.timer = null
    this.prefs.dispose()
  }
}
