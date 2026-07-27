import { app, powerMonitor } from 'electron'
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
 * PERO "ahora no" NO te deja a ciegas (arreglado el 2026-07-27, tras un caso
 * real de enterarse de una version nueva buscandola): aparte de la fase, que es
 * pasajera, guardamos `pending` — la version publicada mas nueva que la tuya.
 * Eso sigue siendo verdad aunque cierres el aviso y aunque reinicies, y es lo
 * que mantiene encendido el punto del megafono hasta que actualices. Antes, el
 * unico rastro de que habia version nueva era un toast: si no lo veias en ese
 * momento, TEK lo sabia y no te lo decia en ningun sitio.
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
/**
 * Y luego cada 3 horas mientras TEK siga abierta. Eran 6 y se quedaba corto:
 * una TEK abierta desde por la mañana podia tardar media jornada en enterarse
 * de una version publicada al mediodia. El fichero que se mira son unos cientos
 * de bytes en el CDN de GitHub, asi que mirar el doble de veces no cuesta nada.
 */
const EVERY_MS = 3 * 60 * 60 * 1000
/** Margen tras despertar el equipo: la red aun no suele estar lista. */
const AFTER_RESUME_MS = 20_000

interface UpdatePrefs {
  /** Version que se dijo "ahora no". No se vuelve a ofrecer sola. */
  skipped: string
  /** Ultima version conocida mas nueva que la instalada ('' = al dia). */
  pending: string
}

/**
 * ¿`a` es version mas nueva que `b`? Comparacion numerica por tramos, que es
 * cuanto necesita TEK: sus versiones son X.Y.Z a secas. Cualquier cosa rara
 * (sufijos, campos de mas) cae del lado prudente: NO es mas nueva, y como mucho
 * se pierde un aviso — nunca se anuncia una version que no existe.
 */
function isNewer(a: string, b: string): boolean {
  const p = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10))
  const x = p(a)
  const y = p(b)
  if (x.length !== 3 || y.length !== 3 || [...x, ...y].some((n) => !Number.isFinite(n))) return false
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i]
  }
  return false
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
  private readonly prefs = new JsonStore<UpdatePrefs>('tek-update.json', { skipped: '', pending: '' })
  private state: UpdateState = { phase: 'idle', version: '', notes: '', percent: 0, error: '', pending: '' }
  private firstTimer: NodeJS.Timeout | null = null
  private timer: NodeJS.Timeout | null = null
  private resumeTimer: NodeJS.Timeout | null = null
  private onResume: (() => void) | null = null
  private wired = false
  /** La comprobacion en curso la pidio la persona: hay que contestarle siempre. */
  private manual = false

  constructor(private readonly emit: (s: UpdateState) => void) {
    // La marca de "tienes una vieja" sobrevive al reinicio, asi que el punto se
    // enciende ya, sin esperar los 25s de la primera comprobacion. Pero si la
    // guardada ya no es mas nueva que la que corre, es que se instalo: fuera.
    const saved = this.prefs.data.pending
    if (saved && isNewer(saved, app.getVersion())) this.state.pending = saved
    else if (saved) this.forget()
  }

  /** Olvida la version pendiente (se instalo, o ya no hay ninguna). */
  private forget(): void {
    this.state.pending = ''
    if (this.prefs.data.pending) {
      this.prefs.data.pending = ''
      this.prefs.save()
    }
  }

  /** Anota que existe una version mas nueva. Idempotente: solo guarda si cambia. */
  private remember(version: string): void {
    if (!isNewer(version, app.getVersion())) return
    if (this.prefs.data.pending !== version) {
      this.prefs.data.pending = version
      this.prefs.save()
    }
    this.set({ pending: version })
  }

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
    // El portatil que pasa la noche suspendido con TEK abierta: al levantar la
    // tapa se mira ya, en vez de esperar a que toque el siguiente tic (el
    // setInterval no corre mientras el equipo duerme). Con margen, que la red
    // tarda un poco en volver.
    this.onResume = (): void => {
      if (this.resumeTimer) clearTimeout(this.resumeTimer)
      this.resumeTimer = setTimeout(() => {
        this.resumeTimer = null
        void this.check(false)
      }, AFTER_RESUME_MS)
    }
    powerMonitor.on('resume', this.onResume)
  }

  private wire(): void {
    if (this.wired) return
    this.wired = true
    const au = electronUpdater.autoUpdater
    au.autoDownload = false
    au.autoInstallOnAppQuit = true

    au.on('checking-for-update', () => this.set({ phase: 'checking', error: '' }))

    au.on('update-available', (info) => {
      // Lo primero, y pase lo que pase debajo: existe una mas nueva. Esto es lo
      // que enciende el punto del megafono y no se apaga por cerrar el aviso.
      this.remember(info.version)
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

    // Estas al dia: si quedaba marca de una pendiente, ya no vale (te la
    // instalaste, o la release se retiro).
    au.on('update-not-available', () => {
      this.forget()
      this.set({ phase: 'idle', version: '', notes: '', percent: 0, error: '', pending: '' })
    })

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
    if (!app.isPackaged) return this.state
    // Tras reiniciar, o tras un "ahora no", SABEMOS que hay version nueva
    // (`pending`) pero la fase esta en idle: electron-updater no tiene nada
    // preparado que bajar y esto se quedaba sin hacer nada. Se vuelve a mirar
    // primero. Cuenta como peticion explicita (borra el "ahora no" y, si algo
    // falla, se cuenta en vez de callarselo).
    if (this.state.phase !== 'available' && this.state.pending) await this.check(true)
    if (this.state.phase !== 'available') return this.state
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
    if (this.resumeTimer) clearTimeout(this.resumeTimer)
    if (this.onResume) powerMonitor.off('resume', this.onResume)
    this.firstTimer = null
    this.timer = null
    this.resumeTimer = null
    this.onResume = null
    this.prefs.dispose()
  }
}
