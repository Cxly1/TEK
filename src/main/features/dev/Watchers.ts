import { Notification, net } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import type { Watcher } from '@shared/ipc'
import { JsonStore } from './jsonStore'

/**
 * Vigias de URL: TEK revisa una pagina cada N minutos (net.fetch desde el main)
 * y avisa con una notificacion NATIVA de Windows cuando pasa lo que esperas:
 * el contenido cambio (CI termino, salio un release), aparecio un texto, o el
 * status HTTP cambio (el deploy volvio a 200). Clic en la notificacion = abre
 * la pagina en TEK.
 */

interface WatchersData {
  watchers: Watcher[]
}

/** Tic del comprobador (cada watcher decide si "le toca" por su intervalo). */
const TICK_MS = 30_000
/** No bajamos de 1 minuto: seria martillear al servidor ajeno. */
const MIN_INTERVAL_MIN = 1

/** Huella del contenido, ignorando espacios (los HTML suelen variar en blancos). */
function hashOf(text: string): string {
  return createHash('sha1').update(text.replace(/\s+/g, ' ')).digest('hex')
}

export class Watchers {
  private readonly store = new JsonStore<WatchersData>('tek-watchers.json', { watchers: [] })
  private timer: NodeJS.Timeout | null = null
  /** Abre la URL en una pestana de TEK (clic en la notificacion). */
  openUrl: ((url: string) => void) | null = null
  /** Avisa al renderer de que la lista cambio (refresca el panel). */
  onChange: (() => void) | null = null

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  list(): Watcher[] {
    return this.store.data.watchers
  }

  save(w: Watcher): void {
    const clean: Watcher = {
      id: typeof w.id === 'string' && w.id ? w.id : randomUUID(),
      name: String(w.name ?? '').trim().slice(0, 80) || 'Watcher',
      url: String(w.url ?? '').trim(),
      mode: w.mode === 'contains' || w.mode === 'status' ? w.mode : 'change',
      pattern: String(w.pattern ?? '').slice(0, 300),
      intervalMin: Math.max(MIN_INTERVAL_MIN, Math.min(Number(w.intervalMin) || 5, 24 * 60)),
      enabled: w.enabled !== false,
      lastCheckedAt: typeof w.lastCheckedAt === 'number' ? w.lastCheckedAt : null,
      lastChangedAt: typeof w.lastChangedAt === 'number' ? w.lastChangedAt : null,
      lastStatus: typeof w.lastStatus === 'number' ? w.lastStatus : null,
      lastHash: typeof w.lastHash === 'string' ? w.lastHash : null,
      note: String(w.note ?? '')
    }
    if (!/^https?:\/\//i.test(clean.url)) return // solo web
    const idx = this.store.data.watchers.findIndex((x) => x.id === clean.id)
    if (idx >= 0) this.store.data.watchers[idx] = clean
    else this.store.data.watchers.push(clean)
    this.store.save()
  }

  delete(id: string): void {
    this.store.data.watchers = this.store.data.watchers.filter((w) => w.id !== id)
    this.store.save()
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    for (const w of this.store.data.watchers) {
      if (!w.enabled) continue
      const due = (w.lastCheckedAt ?? 0) + w.intervalMin * 60_000 <= now
      if (due) await this.check(w.id)
    }
  }

  /** Comprueba un watcher YA y devuelve su estado actualizado. */
  async check(id: string): Promise<Watcher | null> {
    const w = this.store.data.watchers.find((x) => x.id === id)
    if (!w) return null
    let status = 0
    let text = ''
    try {
      const res = await net.fetch(w.url, {
        cache: 'no-store',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000)
      })
      status = res.status
      text = (await res.text()).slice(0, 2_000_000)
    } catch {
      status = 0 // sin red / timeout: lo tratamos como status 0
    }

    const prevStatus = w.lastStatus
    const prevHash = w.lastHash
    const hash = text ? hashOf(text) : null
    w.lastCheckedAt = Date.now()
    w.lastStatus = status
    if (hash) w.lastHash = hash

    let fired = ''
    if (w.mode === 'status') {
      if (prevStatus !== null && prevStatus !== status) fired = `HTTP ${prevStatus} → ${status}`
      w.note = `HTTP ${status}`
    } else if (w.mode === 'contains') {
      const found = !!w.pattern && text.includes(w.pattern)
      const before = w.note === 'texto presente'
      if (found && !before) fired = `apareció «${w.pattern.slice(0, 60)}»`
      w.note = found ? 'texto presente' : 'texto ausente'
    } else {
      // 'change': contenido distinto al de la ultima vez.
      if (prevHash && hash && prevHash !== hash) fired = 'el contenido cambió'
      w.note = hash ? 'vigilando cambios' : `sin respuesta (HTTP ${status})`
    }

    if (fired) {
      w.lastChangedAt = Date.now()
      this.notify(w, fired)
    }
    this.store.save()
    this.onChange?.()
    return { ...w }
  }

  private notify(w: Watcher, what: string): void {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: `👁 ${w.name}`, body: what })
    n.on('click', () => this.openUrl?.(w.url))
    n.show()
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.openUrl = null
    this.onChange = null
    this.store.dispose()
  }
}
