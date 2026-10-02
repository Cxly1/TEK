import { app, dialog, Notification, session as electronSession, shell, type BrowserWindow } from 'electron'
import { basename, dirname, extname, join } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { hostKey, type DownloadEntry } from '@shared/ipc'
import { JsonStore } from './dev/jsonStore'

/**
 * Tipos de archivo que EJECUTAN algo al abrirlos (o lo esconden: .iso/.vhd
 * montan un disco y saltan la marca de internet). Con estos TEK pregunta antes
 * de bajarlos, aunque hayas hecho clic. Sin Safe Browsing, es lo que queda.
 */
const DANGEROUS_EXT = new Set([
  'exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'bat', 'cmd',
  'com', 'scr', 'pif', 'cpl', 'hta', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'wsc', 'ws',
  'ps1', 'psm1', 'psd1', 'lnk', 'url', 'reg', 'jar', 'dll', 'sys', 'msc', 'msp', 'mst',
  'iso', 'img', 'vhd', 'vhdx', 'application', 'appref-ms', 'gadget', 'chm', 'scf', 'inf',
  'xll', 'settingcontent-ms'
])

export function isDangerousFile(filename: string): boolean {
  return DANGEROUS_EXT.has(extname(filename).slice(1).toLowerCase())
}

/** Descargas sin clic de una misma pagina: a partir de estas, en un minuto, ni se pregunta. */
const BURST_MAX = 3
const BURST_WINDOW_MS = 60_000
/** Una descarga que TEK pidio (menu "Guardar imagen") cuenta como clic durante esto. */
const EXPECT_TTL_MS = 10_000

interface TrustData {
  /** Sitios donde dijiste "No volver a preguntar" para bajar programas. */
  programs: string[]
}

let dlCounter = 0
const nextDlId = (): string => `d${Date.now().toString(36)}${(++dlCounter).toString(36)}`

/** Devuelve una ruta libre: "file.zip" -> "file (1).zip" -> "file (2).zip"... */
function uniquePath(p: string): string {
  if (!existsSync(p)) return p
  const dir = dirname(p)
  const ext = extname(p)
  const base = basename(p, ext)
  for (let i = 1; i < 1000; i++) {
    const candidate = join(dir, `${base} (${i})${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  return p
}

/**
 * Gestor de descargas de TEK. Engancha `will-download` sobre la sesion
 * compartida `persist:tek`: guarda directo en la carpeta Descargas (sin dialogo,
 * estilo Chrome), sigue el progreso y avisa al renderer (toast + panel de la
 * barra). Persiste el historial de descargas en `userData/tek-downloads.json` —
 * a proposito SIN SQLite, para que las descargas funcionen aunque el modulo
 * nativo del cerebro falle.
 *
 * CUANDO PREGUNTA (antes nunca): si la pagina descarga SIN que hicieras clic, o
 * si lo que baja es un PROGRAMA (ver DANGEROUS_EXT). Para programas que bajas tu
 * se puede marcar "No volver a preguntar en <sitio>"; para lo que llega sin clic
 * no se ofrece. Mientras pregunta, la descarga espera en pausa y los dialogos
 * van de uno en uno. Si a una descarga sin clic le dices Cancelar, esa pagina no
 * vuelve a preguntar (se cancela sola) hasta que navegue; y con mas de 3 sin
 * clic en un minuto, las siguientes se cancelan sin dialogo.
 */
export class Downloads {
  private readonly session: Electron.Session
  private entries: DownloadEntry[] = []
  /** Ventana sobre la que se cuelgan los dialogos (la cablea index.ts). */
  getWindow: () => BrowserWindow | null = () => null
  /** Sitios de confianza para bajar programas ("No volver a preguntar"). */
  private readonly trust = new JsonStore<TrustData>('tek-download-sites.json', { programs: [] })
  /** Dialogos de uno en uno. */
  private asking: Promise<void> = Promise.resolve()
  /** Descargas que pidio TEK (no la pagina): URL -> caducidad. */
  private readonly expected = new Map<string, number>()
  /** Pagina que cancelaste: no vuelve a preguntar hasta que navegue (wc -> su URL). */
  private readonly silenced = new WeakMap<Electron.WebContents, string>()
  /** Descargas sin clic recientes por pagina (marcas de tiempo). */
  private readonly burst = new WeakMap<Electron.WebContents, number[]>()
  /** Items vivos (para pausar/cancelar/abrir mientras siguen en curso). */
  private readonly live = new Map<string, Electron.DownloadItem>()
  private readonly file = join(app.getPath('userData'), 'tek-downloads.json')
  private emitTimer: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null
  /**
   * ¿El archivo sigue en disco? Con cache corta: list() corre en CADA empuje de
   * progreso (hasta 4 por segundo) y no hace falta mirar el disco tantas veces.
   */
  private readonly onDisk = new Map<string, { at: number; missing: boolean }>
  /** Avisa al renderer; index.ts lo cablea para enviar la lista por IPC. */
  onChange: (() => void) | null = null

  constructor(partition: string) {
    this.session = electronSession.fromPartition(partition)
    this.session.on('will-download', (_e, item, wc) => this.handle(item, wc ?? null))
  }

  /**
   * TEK va a pedir esta descarga por su cuenta (menu "Guardar imagen"): para
   * Chromium no hubo clic en la pagina, pero si lo hubo en TEK.
   */
  expect(url: string): void {
    const now = Date.now()
    for (const [u, t] of this.expected) if (t < now) this.expected.delete(u)
    this.expected.set(url, now + EXPECT_TTL_MS)
  }

  private wasExpected(item: Electron.DownloadItem): boolean {
    const urls = [...item.getURLChain(), item.getURL()]
    const now = Date.now()
    for (const u of urls) {
      const t = this.expected.get(u)
      if (t && t >= now) {
        this.expected.delete(u)
        return true
      }
    }
    return false
  }

  /** ¿Otra descarga sin clic de esta pagina cabe en el cupo? (y la cuenta) */
  private burstAllows(wc: Electron.WebContents | null): boolean {
    if (!wc) return true
    const now = Date.now()
    const recent = (this.burst.get(wc) ?? []).filter((t) => now - t < BURST_WINDOW_MS)
    recent.push(now)
    this.burst.set(wc, recent)
    return recent.length <= BURST_MAX
  }

  /** Carga el historial de descargas de disco (las activas no sobreviven). */
  async init(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const data = JSON.parse(raw) as DownloadEntry[]
      if (Array.isArray(data)) {
        // Lo que quedo "en progreso" de una sesion anterior = interrumpido.
        this.entries = data.map((d) =>
          d.state === 'progressing' ? { ...d, state: 'interrupted', paused: false } : d
        )
      }
    } catch {
      /* primera vez: sin historial */
    }
  }

  private handle(item: Electron.DownloadItem, wc: Electron.WebContents | null): void {
    // basename() por si el nombre sugerido trajera separadores de ruta: el
    // archivo SIEMPRE cae dentro de Descargas (anti path-traversal).
    const savePath = uniquePath(join(app.getPath('downloads'), basename(item.getFilename())))
    item.setSavePath(savePath) // evita el dialogo del sistema (guarda directo)

    const filename = basename(savePath)
    const pageUrl = wc && !wc.isDestroyed() ? wc.getURL() : ''
    // El sitio que se nombra es el de la PAGINA (donde estas), no el del
    // servidor que sirve el archivo (un CDN que no te dice nada).
    const site = hostKey(pageUrl) || hostKey(item.getURL()) || 'Una página'
    const gesture = item.hasUserGesture() || this.wasExpected(item)
    const danger = isDangerousFile(filename)

    if (gesture && (!danger || this.trust.data.programs.includes(site))) {
      this.track(item, savePath)
      return
    }
    if (!gesture && wc) {
      // Cancelaste otra de esta misma pagina: no se vuelve a preguntar.
      if (this.silenced.get(wc) === wc.getURL()) {
        item.cancel()
        return
      }
      // Rafaga: una pagina no te tira 20 dialogos.
      if (!this.burstAllows(wc)) {
        console.warn(`[tek] descarga sin clic cancelada (rafaga): ${filename} desde ${site}`)
        item.cancel()
        return
      }
    }
    item.pause()
    this.asking = this.asking.then(() =>
      this.ask({ item, savePath, filename, site, gesture, danger, wc, pageUrl })
    )
  }

  /** Pregunta por UNA descarga en pausa y la reanuda o la cancela. */
  private async ask(o: {
    item: Electron.DownloadItem
    savePath: string
    filename: string
    site: string
    gesture: boolean
    danger: boolean
    wc: Electron.WebContents | null
    pageUrl: string
  }): Promise<void> {
    const { item } = o
    // Pudo cancelarse mientras esperaba su turno (la pagina se cerro, etc.).
    if (item.getState() === 'cancelled') return
    const win = this.getWindow()
    if (!win || win.isDestroyed()) {
      item.cancel()
      return
    }
    const program = 'Es un programa: puede hacer cambios en tu equipo.'
    let res: Electron.MessageBoxReturnValue
    try {
      res = await dialog.showMessageBox(win, {
        type: o.danger ? 'warning' : 'question',
        title: 'Descarga',
        message: o.gesture ? `¿Descargar «${o.filename}»?` : `${o.site} quiere descargar «${o.filename}»`,
        detail: o.gesture
          ? `${program} Viene de ${o.site}.`
          : `Sin que hicieras clic.${o.danger ? ` ${program}` : ''}`,
        buttons: ['Descargar', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        // Recordar solo para programas que bajas TU: lo que llega sin clic se
        // pregunta siempre.
        ...(o.gesture && o.danger
          ? { checkboxLabel: `No volver a preguntar en ${o.site}`, checkboxChecked: false }
          : {})
      })
    } catch {
      item.cancel()
      return
    }
    if (res.response !== 0) {
      item.cancel()
      if (!o.gesture && o.wc && !o.wc.isDestroyed()) this.silenced.set(o.wc, o.pageUrl)
      return
    }
    if (o.gesture && o.danger && res.checkboxChecked && !this.trust.data.programs.includes(o.site)) {
      this.trust.data.programs.push(o.site)
      this.trust.save()
    }
    this.track(item, o.savePath)
    if (item.getState() === 'progressing' && item.isPaused()) item.resume()
  }

  /** A partir de aqui la descarga es tuya: entra en la lista y se sigue. */
  private track(item: Electron.DownloadItem, savePath: string): void {
    const id = nextDlId()
    this.live.set(id, item)

    const entry: DownloadEntry = {
      id,
      filename: basename(savePath),
      url: item.getURL(),
      savePath,
      total: item.getTotalBytes(),
      received: item.getReceivedBytes(),
      state: 'progressing',
      paused: false,
      startedAt: Date.now(),
      finishedAt: null
    }
    this.entries.unshift(entry)
    this.emit()

    item.on('updated', (_ev, state) => {
      entry.received = item.getReceivedBytes()
      entry.total = item.getTotalBytes()
      entry.paused = item.isPaused()
      entry.state = state === 'interrupted' ? 'interrupted' : 'progressing'
      this.emitThrottled()
    })
    const finish = (state: string): void => {
      if (!this.live.has(id)) return
      entry.received = item.getReceivedBytes()
      entry.finishedAt = Date.now()
      entry.state =
        state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      this.live.delete(id)
      this.notify(entry)
      this.emit()
      this.save()
    }
    item.once('done', (_ev, state) => finish(state))
    // Si termino (o se corto) MIENTRAS se preguntaba, su 'done' ya paso: se
    // cierra aqui, que si no se quedaria "descargando" para siempre.
    const now = item.getState()
    if (now !== 'progressing') finish(now)
  }

  /**
   * Notificacion NATIVA de Windows al terminar. A diferencia del toast in-app,
   * esta se ve aunque TEK este en segundo plano (que es justo cuando no te
   * enteras). Clic → abre la carpeta. No molesta con las canceladas a mano.
   */
  private notify(entry: DownloadEntry): void {
    if (entry.state === 'cancelled' || !Notification.isSupported()) return
    const ok = entry.state === 'completed'
    const n = new Notification({
      title: ok ? 'Descarga completa' : 'Descarga interrumpida',
      body: entry.filename
    })
    n.on('click', () => this.showInFolder(entry.id))
    n.show()
  }

  // --- API publica -----------------------------------------------------------

  /**
   * Las terminadas llevan `missing` si su archivo ya no esta (borrado o movido):
   * el panel lo dice en vez de ofrecer un "abrir" que no haria nada.
   */
  list(): DownloadEntry[] {
    const now = Date.now()
    return this.entries.map((e) => {
      if (e.state !== 'completed') return e
      let seen = this.onDisk.get(e.id)
      if (!seen || now - seen.at > 5000) {
        seen = { at: now, missing: !existsSync(e.savePath) }
        this.onDisk.set(e.id, seen)
      }
      return seen.missing ? { ...e, missing: true } : e
    })
  }

  openFile(id: string): void {
    const e = this.find(id)
    if (e && e.state === 'completed' && existsSync(e.savePath)) void shell.openPath(e.savePath)
  }

  showInFolder(id: string): void {
    const e = this.find(id)
    if (e && existsSync(e.savePath)) shell.showItemInFolder(e.savePath)
  }

  cancel(id: string): void {
    this.live.get(id)?.cancel()
  }

  /** Quita una entrada terminada del historial (no cancela una activa). */
  remove(id: string): void {
    if (this.live.has(id)) return
    this.entries = this.entries.filter((e) => e.id !== id)
    this.onDisk.delete(id)
    this.emit()
    this.save()
  }

  /** Limpia el historial dejando solo lo que sigue descargandose. */
  clear(): void {
    this.entries = this.entries.filter((e) => this.live.has(e.id))
    this.onDisk.clear()
    this.emit()
    this.save()
  }

  private find(id: string): DownloadEntry | undefined {
    return this.entries.find((e) => e.id === id)
  }

  private emit(): void {
    this.onChange?.()
  }

  /** Progreso: como mucho un emit cada 250ms (no satura el IPC). */
  private emitThrottled(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.emit()
    }, 250)
  }

  private save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      const data = this.entries.slice(0, 200)
      void writeFile(this.file, JSON.stringify(data), 'utf8').catch(() => undefined)
    }, 500)
  }

  dispose(): void {
    if (this.emitTimer) clearTimeout(this.emitTimer)
    if (this.saveTimer) {
      // Habia un guardado pendiente: al cerrar se hace YA (antes se perdia).
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      try {
        writeFileSync(this.file, JSON.stringify(this.entries.slice(0, 200)), 'utf8')
      } catch {
        /* disco lleno / permisos: el historial de descargas es best-effort */
      }
    }
    this.trust.dispose()
    this.onChange = null
  }
}
