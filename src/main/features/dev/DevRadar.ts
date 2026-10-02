import { net } from 'electron'
import type { DevServer } from '@shared/ipc'

/**
 * Radar de servers de desarrollo: escanea los puertos tipicos en 127.0.0.1 con
 * `net.fetch` (el fetch de Node NO funciona con SSL interceptado por un proxy;
 * net.fetch si) y un timeout corto. Es lo que hace que la nueva
 * pestana sepa "tienes Vite corriendo en :5173".
 *
 * BAJO DEMANDA (2026-10): antes sondeaba 15 puertos cada 20 s SIEMPRE (45
 * peticiones por minuto) aunque no estuvieras programando. Ahora solo mientras
 * alguien lo necesita (`need`): la pestana nueva a la vista, o una receta que
 * se dispara "al detectar un servidor". Sin nadie, para. Y quien pida la lista
 * suelta (la paleta ⌘K) la recibe fresca (`fresh`).
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
  /** Quien necesita el radar encendido ahora mismo (motivos). */
  private readonly demand = new Set<string>()
  /** Cuando termino el ultimo escaneo (ms). */
  private lastScanAt = 0
  /** Avisa cuando cambia el conjunto de servers (push al renderer). */
  onChange: ((servers: DevServer[]) => void) | null = null
  /** Avisa cuando APARECE un server nuevo (disparador de recetas). */
  onUp: ((port: number) => void) | null = null

  /**
   * Enciende o suelta el radar por un motivo ('pestana-nueva', 'recetas'...).
   * Escanea mientras quede alguno; al encenderse, mira ya.
   */
  need(reason: string, on: boolean): void {
    if (on) this.demand.add(reason)
    else this.demand.delete(reason)
    if (this.demand.size > 0 && !this.timer) {
      void this.scan()
      this.timer = setInterval(() => void this.scan(), SCAN_EVERY_MS)
    } else if (this.demand.size === 0 && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  list(): DevServer[] {
    return this.servers
  }

  /** La lista, pero si la ultima vuelta es vieja (radar parado), mira antes. */
  async fresh(): Promise<DevServer[]> {
    if (Date.now() - this.lastScanAt < SCAN_EVERY_MS) return this.servers
    return this.scan()
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
      this.lastScanAt = Date.now()
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.demand.clear()
    this.onChange = null
    this.onUp = null
  }
}
