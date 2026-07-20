import { app, net } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

/**
 * Cache local de favicons por host, para que la pantalla de nueva pestana (los
 * accesos directos) muestre el icono real de cada sitio en vez de una inicial.
 *
 * 100% local, en linea con el resto de TEK: los iconos se bajan del propio sitio
 * (al visitarlo via `page-favicon-updated`, o como fallback `/favicon.ico`) con
 * `net.fetch` (Chromium + certs del sistema; el fetch de Node falla en redes con
 * SSL interceptado) y se guardan como data URLs en `userData/favicons.json`. Nada sale a un
 * servicio de terceros.
 */
export class Favicons {
  /** host (sin www) -> data URL del favicon. */
  private readonly map = new Map<string, string>()
  private readonly file = join(app.getPath('userData'), 'favicons.json')
  private readonly inflight = new Set<string>()
  private saveTimer: NodeJS.Timeout | null = null

  /** Carga la cache de disco (instantanea, offline). */
  async init(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const obj = JSON.parse(raw) as Record<string, string>
      for (const [h, d] of Object.entries(obj)) {
        if (typeof d === 'string' && d.startsWith('data:')) this.map.set(h, d)
      }
    } catch {
      /* primera vez: cache vacia */
    }
  }

  /** Data URL cacheada para un host (o null). */
  get(host: string): string | null {
    return this.map.get(this.norm(host)) ?? null
  }

  /**
   * Una pagina declaro su favicon (evento `page-favicon-updated`). Si aun no
   * tenemos uno para ese host, lo bajamos y cacheamos. Resuelve cuando termina
   * (para que ViewManager refresque la pestana con el icono nuevo).
   */
  capture(rawHost: string, faviconUrl: string): Promise<void> {
    const host = this.norm(rawHost)
    if (!host || !faviconUrl || this.map.has(host)) return Promise.resolve()
    return this.fetchInto(host, faviconUrl)
  }

  /**
   * Garantiza un favicon para un host (aunque no lo hayamos capturado todavia):
   * intenta `https://<host>/favicon.ico`. Resuelve cuando hay icono o se agota.
   * Pensado para los hosts sugeridos en la nueva pestana.
   */
  async ensure(rawHost: string): Promise<void> {
    const host = this.norm(rawHost)
    if (!host || this.map.has(host)) return
    await this.fetchInto(host, `https://${host}/favicon.ico`)
  }

  private async fetchInto(host: string, url: string): Promise<void> {
    // Solo iconos web: una pagina maliciosa podria declarar un favicon file://
    // y hacernos leer (y cachear) un archivo local.
    if (!/^https?:\/\//i.test(url)) return
    if (this.map.has(host) || this.inflight.has(host)) return
    this.inflight.add(host)
    try {
      // Timeout duro: sin el, un servidor que gotea bytes deja la peticion (y el
      // host en `inflight`) colgados para siempre.
      const res = await net.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return
      // Corta ANTES de descargar si el servidor ya declara un tamano absurdo.
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > 200_000) return
      const type = (res.headers.get('content-type') || 'image/x-icon').split(';')[0].trim()
      if (!type.startsWith('image/')) return
      const buf = Buffer.from(await res.arrayBuffer())
      // Descarta vacios y cosas absurdamente grandes (un favicon sano es < 200KB).
      if (buf.length < 50 || buf.length > 200_000) return
      this.map.set(host, `data:${type};base64,${buf.toString('base64')}`)
      this.scheduleSave()
    } catch {
      /* sin icono: la UI cae al glyph de inicial */
    } finally {
      this.inflight.delete(host)
    }
  }

  private norm(host: string): string {
    return (host || '').replace(/^www\./, '').toLowerCase()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      const obj = Object.fromEntries(this.map)
      void writeFile(this.file, JSON.stringify(obj), 'utf8').catch(() => undefined)
    }, 800)
  }

  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
  }
}
