import { net } from 'electron'
import type { DevServer } from '@shared/ipc'

/**
 * Radar de servers de desarrollo: escanea los puertos tipicos en 127.0.0.1 con
 * `net.fetch` (el fetch de Node NO funciona con SSL interceptado por un proxy;
 * net.fetch si) y un timeout corto. Es lo que hace que la nueva
 * pestana sepa "tienes Vite corriendo en :5173".
 */

/** Puertos donde suelen vivir los dev servers (Vite, Next, CRA, Django, etc.). */
const DEV_PORTS = [
  3000, 3001, 3002, 4200, 4321, 5000, 5173, 5174, 5175, 5500, 8000, 8080, 8081, 8888, 9000
]

/** Cada cuanto re-escanea en segundo plano. */
const SCAN_EVERY_MS = 20_000

/** Saca el <title> de un HTML (best-effort, sin parser). */
function titleOf(html: string): string {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html)
  return m ? m[1].trim().slice(0, 80) : ''
}

export class DevRadar {
  private servers: DevServer[] = []
  private timer: NodeJS.Timeout | null = null
  private scanning = false
  /** Avisa cuando cambia el conjunto de servers (push al renderer). */
  onChange: ((servers: DevServer[]) => void) | null = null
  /** Avisa cuando APARECE un server nuevo (disparador de recetas). */
  onUp: ((port: number) => void) | null = null

  start(): void {
    if (this.timer) return
    void this.scan()
    this.timer = setInterval(() => void this.scan(), SCAN_EVERY_MS)
  }

  list(): DevServer[] {
    return this.servers
  }

  /** Prueba un puerto: vivo si responde lo que sea por HTTP. */
  private async probe(port: number): Promise<DevServer | null> {
    try {
      const res = await net.fetch(`http://127.0.0.1:${port}/`, {
        cache: 'no-store',
        redirect: 'follow',
        signal: AbortSignal.timeout(1200)
      })
      let title = ''
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/html')) {
        // Solo el principio: el <title> vive arriba y no queremos megas.
        const text = await res.text()
        title = titleOf(text.slice(0, 65_536))
      }
      return { port, url: `http://localhost:${port}`, title, status: res.status }
    } catch {
      return null
    }
  }

  /** Escanea todos los puertos en paralelo (es loopback: barato y rapido). */
  async scan(): Promise<DevServer[]> {
    if (this.scanning) return this.servers
    this.scanning = true
    try {
      const results = await Promise.all(DEV_PORTS.map((p) => this.probe(p)))
      const found = results.filter((r): r is DevServer => r !== null)
      const before = new Set(this.servers.map((s) => s.port))
      const after = new Set(found.map((s) => s.port))
      const changed =
        before.size !== after.size || [...after].some((p) => !before.has(p))
      this.servers = found
      if (changed) {
        this.onChange?.(found)
        for (const s of found) if (!before.has(s.port)) this.onUp?.(s.port)
      }
      return found
    } finally {
      this.scanning = false
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.onChange = null
    this.onUp = null
  }
}
