import { app, Notification, session as electronSession, shell } from 'electron'
import { basename, dirname, extname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import type { DownloadEntry } from '@shared/ipc'

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
 */
export class Downloads {
  private readonly session: Electron.Session
  private entries: DownloadEntry[] = []
  /** Items vivos (para pausar/cancelar/abrir mientras siguen en curso). */
  private readonly live = new Map<string, Electron.DownloadItem>()
  private readonly file = join(app.getPath('userData'), 'tek-downloads.json')
  private emitTimer: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null
  /** Avisa al renderer; index.ts lo cablea para enviar la lista por IPC. */
  onChange: (() => void) | null = null

  constructor(partition: string) {
    this.session = electronSession.fromPartition(partition)
    this.session.on('will-download', (_e, item) => this.handle(item))
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

  private handle(item: Electron.DownloadItem): void {
    const id = nextDlId()
    // basename() por si el nombre sugerido trajera separadores de ruta: el
    // archivo SIEMPRE cae dentro de Descargas (anti path-traversal).
    const savePath = uniquePath(join(app.getPath('downloads'), basename(item.getFilename())))
    item.setSavePath(savePath) // evita el dialogo del sistema (guarda directo)
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
    item.once('done', (_ev, state) => {
      entry.received = item.getReceivedBytes()
      entry.finishedAt = Date.now()
      entry.state =
        state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'
      this.live.delete(id)
      this.notify(entry)
      this.emit()
      this.save()
    })
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

  list(): DownloadEntry[] {
    return this.entries
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
    this.emit()
    this.save()
  }

  /** Limpia el historial dejando solo lo que sigue descargandose. */
  clear(): void {
    this.entries = this.entries.filter((e) => this.live.has(e.id))
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
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.onChange = null
  }
}
