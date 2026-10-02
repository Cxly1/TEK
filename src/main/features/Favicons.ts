import { app, net } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'

/**
 * ¿Este host es de tu red (loopback, LAN, link-local, nombres sin dominio)?
 * Lo pide el PROCESO PRINCIPAL, no la pagina: sin este filtro, cualquier web
 * podia declarar como favicon `http://192.168.1.1/...` y TEK iba a buscarlo a
 * tu router. Una IP publica que resuelva a la LAN (DNS rebinding) se escapa de
 * esta comprobacion; para eso ademas se mira la URL final tras las redirecciones.
 */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true
  const kind = isIP(h)
  if (kind === 4) {
    const [a, b] = h.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  if (kind === 6) {
    if (h === '::' || h === '::1') return true
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true // ULA y link-local
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)
    return mapped ? isPrivateHost(mapped[1]) : false
  }
  // Un nombre sin punto ("router", "nas") solo existe en tu red.
  return !h.includes('.')
}

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

  /**
   * ¿Se puede pedir este icono? Solo web (una pagina podria declarar un favicon
   * file:// y hacernos leer un archivo local), y a tu red solo si la propia
   * pagina vive ahi (el icono de tu localhost:5173 si; el de tu router desde
   * una web cualquiera, no).
   */
  private allowedTarget(host: string, url: string): boolean {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return false
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return !isPrivateHost(u.hostname) || this.norm(u.host) === host
  }

  private async fetchInto(host: string, url: string): Promise<void> {
    if (!this.allowedTarget(host, url)) return
    if (this.map.has(host) || this.inflight.has(host)) return
    this.inflight.add(host)
    try {
      // Timeout duro: sin el, un servidor que gotea bytes deja la peticion (y el
      // host en `inflight`) colgados para siempre.
      const res = await net.fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) })
      if (!res.ok) return
      // Una redireccion que acabo en tu red no se cachea (ver isPrivateHost).
      if (res.url && !this.allowedTarget(host, res.url)) return
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
