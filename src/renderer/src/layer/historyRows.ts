import type { HistoryEntry } from '@shared/ipc'

/**
 * El historial tal como se LEE, a partir de las visitas crudas del cerebro.
 * El cerebro guarda cada carga de pagina (le sirve para aprender); para leer,
 * eso es ruido: la misma pagina salia tres veces seguidas, con "(65)" y
 * "- YouTube" en el titulo. Aqui se agrupa, se limpia y se nombra.
 */

/** Una fila del panel: una pagina (o una busqueda) en un dia. */
export interface HistoryRow {
  key: string
  /** Todas las visitas que resume (borrar la fila las borra todas). */
  ids: number[]
  url: string
  host: string
  title: string
  /** Si la pagina es una busqueda (YouTube, Google...), lo que se busco. */
  search: string | null
  /** La visita mas reciente del grupo. */
  at: number
  favicon: string | null
  day: string
}

/** Etiquetas de host que no nombran al sitio. */
const GENERIC = new Set(['www', 'm', 'open', 'app', 'web', 'es', 'en', 'mobile', 'mail'])
const TLDS = new Set(['com', 'org', 'net', 'ai', 'io', 'co', 'mx', 'es', 'gob', 'edu', 'dev', 'app', 'tv', 'me'])
/** Sitios que firman con un nombre que no sale en su host. */
const ALIASES: Record<string, string[]> = {
  'mail.google.com': ['gmail'],
  'x.com': ['x', 'twitter'],
  'twitter.com': ['twitter', 'x']
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Nombres con los que un sitio firma sus titulos ("YouTube", "Spotify"...). */
function brandsOf(host: string): string[] {
  const h = host.replace(/^www\./, '')
  const labels = h.split('.').filter((l) => l && !GENERIC.has(l) && !TLDS.has(l))
  return [...(ALIASES[h] ?? []), ...labels].map(fold).filter(Boolean)
}

/** Parte un titulo por su ULTIMO separador de firma (" - ", " | ", " — "...). */
function splitLast(t: string): [string, string] | null {
  const re = /\s+[-|–—·•]\s+/g
  let last: RegExpExecArray | null = null
  for (let m = re.exec(t); m; m = re.exec(t)) last = m
  if (!last) return null
  return [t.slice(0, last.index), t.slice(last.index + last[0].length)]
}

/**
 * Titulo limpio: sin el contador de avisos delante ("(65) ") y sin la firma del
 * sitio ("- YouTube", "| Spotify", "- Claude" al final; "GitHub - " delante),
 * que ya se ve al lado. Si limpiando no quedara nada, se deja el original.
 */
export function cleanTitle(title: string, host: string): string {
  const original = (title || '').replace(/\s+/g, ' ').trim()
  let t = original.replace(/^\(\d{1,5}\+?\)\s+/, '')
  const brands = brandsOf(host)
  const signs = (part: string): boolean => {
    const f = fold(part)
    return brands.some((b) => f === b || f.startsWith(b + ' '))
  }
  for (let i = 0; i < 2; i++) {
    const cut = splitLast(t)
    if (!cut || !signs(cut[1])) break
    t = cut[0].trim()
  }
  const first = /\s+[-|–—·•]\s+/.exec(t)
  if (first && brands.includes(fold(t.slice(0, first.index)))) {
    t = t.slice(first.index + first[0].length).trim()
  }
  return t || original
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/** Si la URL es una pagina de resultados, lo que se busco. */
export function searchOf(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const h = u.hostname.replace(/^www\./, '')
  const q = (k: string): string | null => u.searchParams.get(k)?.trim() || null
  if (h === 'youtube.com' || h === 'm.youtube.com') return u.pathname === '/results' ? q('search_query') : null
  if (/^google\.[a-z.]+$/.test(h)) return u.pathname === '/search' ? q('q') : null
  if (h === 'bing.com' || h === 'search.brave.com' || h === 'github.com') {
    return u.pathname === '/search' ? q('q') : null
  }
  if (h === 'duckduckgo.com') return q('q')
  if (h === 'open.spotify.com') {
    const m = /^\/search\/([^/]+)/.exec(u.pathname)
    return m ? decode(m[1]).trim() || null : null
  }
  return null
}

/** URL sin lo que no cambia la pagina: el #ancla y, en YouTube, todo menos el video. */
function pageKey(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    const h = u.hostname.replace(/^www\./, '')
    if ((h === 'youtube.com' || h === 'm.youtube.com') && u.pathname === '/watch') {
      const v = u.searchParams.get('v')
      return v ? `yt:${v}` : u.toString()
    }
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Filas del panel: una por pagina (o busqueda) y dia, con la visita mas
 * reciente; las demas visitas del mismo dia se funden en ella. Espera las
 * visitas de mas reciente a mas antigua (como las da el cerebro).
 */
export function buildRows(entries: HistoryEntry[], dayOf: (ts: number) => string): HistoryRow[] {
  const rows: HistoryRow[] = []
  const byKey = new Map<string, HistoryRow>()
  for (const e of entries) {
    const day = dayOf(e.at)
    const search = searchOf(e.url)
    const host = e.host.replace(/^www\./, '')
    const key = `${day}|${search ? `q:${host}:${search.toLowerCase()}` : pageKey(e.url)}`
    const seen = byKey.get(key)
    if (seen) {
      seen.ids.push(e.id)
      if (!seen.favicon && e.favicon) seen.favicon = e.favicon
      continue
    }
    const row: HistoryRow = {
      key,
      ids: [e.id],
      url: e.url,
      host,
      title: cleanTitle(e.title || host, host),
      search,
      at: e.at,
      favicon: e.favicon ?? null,
      day
    }
    byKey.set(key, row)
    rows.push(row)
  }
  return rows
}
