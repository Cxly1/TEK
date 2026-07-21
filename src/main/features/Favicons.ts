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

  /**
   * ¿Los bytes SON una imagen? Por magia de cabecera, porque el content-type
   * MIENTE: Spotify sirvio texto plano ("version https://...") con header
   * `image/vnd.microsoft.icon` y el cache quedo envenenado para siempre (la
   * pestana pintaba un data URL indescifrable y capture/ensure ya no
   * reintentaban porque "habia" icono).
   */
  private static looksLikeImage(b: Buffer): boolean {
    if (b.length < 12) return false
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true // PNG
    if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00)
      return true // ICO / CUR
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true // JPEG
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true // GIF
    if (
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    )
      return true // WEBP
    if (b[0] === 0x42 && b[1] === 0x4d) return true // BMP
    // SVG: texto que abre con <svg o <?xml (un HTML de error "<!doctype" NO pasa).
    const head = b.subarray(0, 256).toString('utf8').replace(/^﻿/, '').trimStart().toLowerCase()
    return head.startsWith('<svg') || head.startsWith('<?xml')
  }

  /** Carga la cache de disco (instantanea, offline), purgando lo envenenado. */
  async init(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8')
      const obj = JSON.parse(raw) as Record<string, string>
      let purged = false
      for (const [h, d] of Object.entries(obj)) {
        if (typeof d !== 'string' || !d.startsWith('data:')) continue
        // Solo entra al mapa lo que decodifica a una imagen de verdad; el resto
        // se descarta y el sitio se re-captura limpio en la proxima visita.
        try {
          if (Favicons.looksLikeImage(Buffer.from(d.slice(d.indexOf(',') + 1), 'base64'))) {
            this.map.set(h, d)
          } else {
            purged = true
          }
        } catch {
          purged = true
        }
      }
      if (purged) this.scheduleSave()
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
      // Y descarta lo que no SEA una imagen, diga lo que diga el content-type
      // (asi entro el veneno de Spotify: texto plano con header de icono).
      if (!Favicons.looksLikeImage(buf)) return
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
