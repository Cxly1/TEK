/**
 * Dev utils del ⌘K: transformaciones rapidas sin red. Escribes algo y TEK te
 * ofrece la conversion; Enter copia el resultado al portapapeles.
 *
 * Disparadores: "uuid", "now", un JWT pegado, un timestamp, "#aabbcc",
 * "b64 texto", "b64d ...", "url texto", "urld ...", "ts <fecha|epoch>".
 */

export interface DevUtil {
  id: string
  label: string
  /** Valor completo que se copia al portapapeles. */
  value: string
  sub: string
}

/** base64url -> string utf8 (para JWT). */
function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function b64encode(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
}

function b64decode(s: string): string {
  const bin = atob(s.trim())
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** Recorta para mostrar en la fila (el valor completo se copia igual). */
function short(s: string, n = 72): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function fechaLegible(d: Date): string {
  return d.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function devUtils(input: string): DevUtil[] {
  const raw = input.trim()
  if (!raw) return []
  const out: DevUtil[] = []
  const push = (id: string, label: string, value: string, sub: string): void => {
    out.push({ id, label, value, sub })
  }

  try {
    // UUID nuevo.
    if (/^uuid$/i.test(raw)) {
      const v = crypto.randomUUID()
      push('uuid', v, v, 'UUID v4 · Enter copia')
    }

    // Ahora: epoch + ISO.
    if (/^(now|ahora)$/i.test(raw)) {
      const ms = Date.now()
      push('now-ms', String(ms), String(ms), 'epoch ms · Enter copia')
      push('now-iso', new Date(ms).toISOString(), new Date(ms).toISOString(), 'ISO 8601 · Enter copia')
    }

    // JWT pegado: decodifica header y payload.
    if (/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+$/.test(raw)) {
      try {
        const [h, p] = raw.split('.')
        const payload = JSON.stringify(JSON.parse(b64urlDecode(p)))
        const header = JSON.stringify(JSON.parse(b64urlDecode(h)))
        push('jwt-payload', short(payload), payload, 'JWT payload · Enter copia')
        push('jwt-header', short(header), header, 'JWT header · Enter copia')
        const exp = (JSON.parse(payload) as { exp?: number }).exp
        if (typeof exp === 'number') {
          const when = new Date(exp * 1000)
          const vivo = when.getTime() > Date.now() ? 'expira' : 'EXPIRÓ'
          push('jwt-exp', `${vivo} ${fechaLegible(when)}`, when.toISOString(), 'JWT exp')
        }
      } catch {
        /* no era un JWT de verdad */
      }
    }

    // Timestamp pegado (10 = segundos, 13 = milisegundos).
    if (/^\d{10}$/.test(raw) || /^\d{13}$/.test(raw)) {
      const ms = raw.length === 10 ? Number(raw) * 1000 : Number(raw)
      const d = new Date(ms)
      if (!Number.isNaN(d.getTime())) {
        push('ts-local', fechaLegible(d), d.toISOString(), `epoch ${raw.length === 10 ? 's' : 'ms'} → fecha`)
      }
    }

    // "ts <fecha>": fecha -> epoch.
    const ts = /^ts\s+(.+)$/i.exec(raw)
    if (ts) {
      const d = new Date(ts[1])
      if (!Number.isNaN(d.getTime())) {
        push('ts-ms', String(d.getTime()), String(d.getTime()), `${fechaLegible(d)} → epoch ms`)
        push('ts-s', String(Math.floor(d.getTime() / 1000)), String(Math.floor(d.getTime() / 1000)), '→ epoch s')
      }
    }

    // base64
    const b64 = /^b64\s+(.+)$/is.exec(raw)
    if (b64) {
      const v = b64encode(b64[1])
      push('b64', short(v), v, 'base64 encode · Enter copia')
    }
    const b64d = /^b64d\s+(.+)$/is.exec(raw)
    if (b64d) {
      try {
        const v = b64decode(b64d[1])
        push('b64d', short(v), v, 'base64 decode · Enter copia')
      } catch {
        /* no era base64 */
      }
    }

    // URL encode/decode
    const urlE = /^url\s+(.+)$/is.exec(raw)
    if (urlE) {
      const v = encodeURIComponent(urlE[1])
      push('url', short(v), v, 'URL encode · Enter copia')
    }
    const urlD = /^urld\s+(.+)$/is.exec(raw)
    if (urlD) {
      try {
        const v = decodeURIComponent(urlD[1])
        push('urld', short(v), v, 'URL decode · Enter copia')
      } catch {
        /* secuencia invalida */
      }
    }

    // Color: #hex -> rgb y rgb() -> #hex.
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw)
    if (hex) {
      let h = hex[1]
      if (h.length === 3) h = h.split('').map((c) => c + c).join('')
      const n = parseInt(h, 16)
      const v = `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
      push('hex-rgb', v, v, 'hex → rgb · Enter copia')
    }
    const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(raw)
    if (rgb) {
      const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map((x) => Math.min(255, Number(x)))
      const v = `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`
      push('rgb-hex', v, v, 'rgb → hex · Enter copia')
    }
  } catch {
    /* una util rota no debe tumbar la paleta */
  }
  return out
}
