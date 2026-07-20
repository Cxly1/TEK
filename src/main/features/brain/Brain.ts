import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import type {
  BrainProfile,
  HistoryEntry,
  MusicInfo,
  MusicNow,
  MusicTop,
  Routine,
  RoutineStep,
  Suggestion
} from '@shared/ipc'

/**
 * El "Cerebro" de TEK: aprendizaje local. Observa en silencio que sitios abres,
 * cuanto te quedas, que escuchas y en que orden, y lo convierte en sugerencias
 * y rutinas. Todo vive en `userData/tek-brain.db` (SQLite). Nada sale del equipo.
 *
 * Resiliencia: si el modulo nativo no carga, `db` queda en null y TODOS los
 * metodos degradan a no-op / vacio. El navegador jamas se cae por el cerebro.
 */

/** Hosts que tratamos como "musica" para la tarjeta de continuar escuchando. */
const MUSIC_HOSTS = [
  'youtube.com',
  'music.youtube.com',
  'open.spotify.com',
  'spotify.com',
  'soundcloud.com',
  'bandcamp.com'
]

const DAY = 86_400_000

/** Franja horaria legible. Sin acentos para no pelear con el almacen. */
function bucketOf(hour: number): string {
  if (hour >= 5 && hour <= 11) return 'manana'
  if (hour >= 12 && hour <= 18) return 'tarde'
  if (hour >= 19 && hour <= 23) return 'noche'
  return 'madrugada'
}

/** Franja de un momento dado (por defecto, ahora). */
export function currentBucket(d = new Date()): string {
  return bucketOf(d.getHours())
}

/** ¿Es un host de musica? (subdominios incluidos). */
export function isMusicHost(host: string): boolean {
  return MUSIC_HOSTS.some((m) => host === m || host.endsWith(`.${m}`))
}

/** Marcas/tokens de contenido adulto que NO deben colarse en las sugerencias. */
const ADULT_RE =
  /(porn|porno|pornhub|xvideos|xnxx|xhamster|redtube|youporn|brazzers|onlyfans|hentai|rule34|nhentai|spankbang|chaturbate|camsoda|stripchat|fapello|erome|motherless|livejasmin|bongacams|tnaflix|eporner|hclips|txxx|camgirl|sexcam|nsfw|xxx)/i

/**
 * ¿Es un host "basura" para sugerir? Filtra contenido adulto y el TLD .xxx. Es
 * NO destructivo: solo evita que aparezca en sugerencias/ ⌘K; el historial sigue
 * guardando la visita (lo que se cura es el aprendizaje, no el registro).
 */
export function isJunkHost(host: string): boolean {
  if (!host) return true
  if (/\.xxx$/i.test(host)) return true
  return ADULT_RE.test(host)
}

/** Visitas minimas a un host para que TEK lo sugiera (curado, no "lo que abri"). */
const MIN_SUGGEST_VISITS = 3

interface VisitRow {
  host: string
  url: string
  title: string
  started_at: number
}

export class Brain {
  private db: Database.Database | null = null
  /** Dominios que el usuario pidio NO aprender (cache en memoria del kv). */
  private readonly ignoredSet = new Set<string>()

  constructor() {
    try {
      const path = join(app.getPath('userData'), 'tek-brain.db')
      this.db = new Database(path)
      this.db.pragma('journal_mode = WAL')
      this.migrate()
      this.loadIgnored()
    } catch (err) {
      // Modulo nativo desactualizado / disco: seguimos sin cerebro.
      console.error('[TEK Brain] no se pudo abrir la base; aprendizaje desactivado:', err)
      this.db = null
    }
  }

  private migrate(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS visits (
        id         INTEGER PRIMARY KEY,
        host       TEXT    NOT NULL,
        url        TEXT    NOT NULL,
        title      TEXT    NOT NULL DEFAULT '',
        started_at INTEGER NOT NULL,
        dwell_ms   INTEGER NOT NULL DEFAULT 0,
        hour       INTEGER NOT NULL,
        dow        INTEGER NOT NULL,
        bucket     TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_visits_host    ON visits(host);
      CREATE INDEX IF NOT EXISTS idx_visits_started ON visits(started_at);
      CREATE INDEX IF NOT EXISTS idx_visits_bucket  ON visits(bucket);

      CREATE TABLE IF NOT EXISTS music (
        id         INTEGER PRIMARY KEY,
        host       TEXT    NOT NULL,
        url        TEXT    NOT NULL DEFAULT '',
        title      TEXT    NOT NULL,
        started_at INTEGER NOT NULL,
        hour       INTEGER NOT NULL,
        bucket     TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS queries (
        id   INTEGER PRIMARY KEY,
        text TEXT    NOT NULL,
        ts   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
    `)
  }

  // --- Estado / privacidad ---------------------------------------------------

  get paused(): boolean {
    if (!this.db) return true
    const row = this.db.prepare(`SELECT value FROM kv WHERE key = 'paused'`).get() as
      | { value: string }
      | undefined
    return row?.value === '1'
  }

  setPaused(paused: boolean): boolean {
    if (!this.db) return true
    this.db
      .prepare(`INSERT INTO kv(key, value) VALUES('paused', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(paused ? '1' : '0')
    return paused
  }

  // --- Captura ---------------------------------------------------------------

  /** Registra una visita y devuelve su id (para acumular dwell despues). */
  recordVisit(host: string, url: string, title: string): number | null {
    if (!this.db || this.paused || !host || this.ignoredSet.has(host)) return null
    const now = Date.now()
    const d = new Date(now)
    const info = this.db
      .prepare(
        `INSERT INTO visits(host, url, title, started_at, hour, dow, bucket)
         VALUES(?, ?, ?, ?, ?, ?, ?)`
      )
      .run(host, url, title, now, d.getHours(), d.getDay(), bucketOf(d.getHours()))
    return Number(info.lastInsertRowid)
  }

  /** Suma tiempo de permanencia (foco activo) a una visita. */
  addDwell(visitId: number, ms: number): void {
    if (!this.db || ms <= 0) return
    this.db.prepare(`UPDATE visits SET dwell_ms = dwell_ms + ? WHERE id = ?`).run(Math.round(ms), visitId)
  }

  /** El titulo de una visita puede llegar tarde (page-title-updated). */
  updateTitle(visitId: number, title: string): void {
    if (!this.db || !title) return
    this.db.prepare(`UPDATE visits SET title = ? WHERE id = ?`).run(title, visitId)
  }

  /** Registra que empezo a sonar algo (solo en hosts de musica). */
  recordMusic(host: string, url: string, title: string): void {
    if (!this.db || this.paused || !title || !isMusicHost(host) || this.ignoredSet.has(host)) return
    // Evita duplicar el mismo titulo si se reanuda el audio en pocos minutos.
    const last = this.db
      .prepare(`SELECT title, started_at FROM music ORDER BY started_at DESC LIMIT 1`)
      .get() as { title: string; started_at: number } | undefined
    if (last && last.title === title && Date.now() - last.started_at < 10 * 60_000) return
    const now = Date.now()
    const h = new Date(now).getHours()
    this.db
      .prepare(`INSERT INTO music(host, url, title, started_at, hour, bucket) VALUES(?, ?, ?, ?, ?, ?)`)
      .run(host, url, title, now, h, bucketOf(h))
  }

  /** Registra una busqueda del ⌘K (para autocompletado futuro). */
  recordQuery(text: string): void {
    if (!this.db || this.paused || !text.trim()) return
    this.db.prepare(`INSERT INTO queries(text, ts) VALUES(?, ?)`).run(text.trim(), Date.now())
  }

  // --- Conocimiento ----------------------------------------------------------

  /**
   * Ranking de hosts por "frecency": frecuencia ponderada por recencia y por el
   * tiempo que te quedas. Inspirado en el algoritmo de Firefox.
   */
  private rank(
    bucket: string | null,
    limit: number,
    exclude: Set<string>,
    minVisits = 1
  ): Suggestion[] {
    if (!this.db) return []
    const now = Date.now()
    const where = bucket ? `WHERE bucket = @bucket` : ``
    const rows = this.db
      .prepare(
        `SELECT host,
                SUM(
                  (CASE
                     WHEN @now - started_at < @d4  THEN 100
                     WHEN @now - started_at < @d14 THEN 70
                     WHEN @now - started_at < @d31 THEN 50
                     WHEN @now - started_at < @d90 THEN 30
                     ELSE 10
                   END)
                  * (1.0 + MIN(dwell_ms, 600000) / 600000.0)
                ) AS score
         FROM visits ${where}
         GROUP BY host
         HAVING COUNT(*) >= @minVisits
         ORDER BY score DESC
         LIMIT @limit`
      )
      .all({
        now,
        bucket,
        minVisits,
        d4: 4 * DAY,
        d14: 14 * DAY,
        d31: 31 * DAY,
        d90: 90 * DAY,
        // Pide de mas: en JS descartamos basura/ignorados/excluidos.
        limit: limit + exclude.size + 24
      }) as { host: string; score: number }[]

    const latest = this.db.prepare(
      `SELECT url, title FROM visits WHERE host = ? ORDER BY started_at DESC LIMIT 1`
    )
    const out: Suggestion[] = []
    for (const r of rows) {
      if (exclude.has(r.host) || isJunkHost(r.host) || this.ignoredSet.has(r.host)) continue
      const rep = latest.get(r.host) as { url: string; title: string } | undefined
      out.push({
        host: r.host,
        url: rep?.url ?? `https://${r.host}`,
        title: rep?.title || r.host,
        score: Math.round(r.score)
      })
      if (out.length >= limit) break
    }
    return out
  }

  /** Sugerencias para AHORA: primero las de la franja, se rellena con globales. */
  suggestions(limit = 8): Suggestion[] {
    if (!this.db) return []
    const bucket = currentBucket()
    const byBucket = this.rank(bucket, limit, new Set(), MIN_SUGGEST_VISITS)
    if (byBucket.length >= limit) return byBucket
    const have = new Set(byBucket.map((s) => s.host))
    const fill = this.rank(null, limit - byBucket.length, have, MIN_SUGGEST_VISITS)
    return [...byBucket, ...fill]
  }

  music(): MusicInfo {
    if (!this.db) return { last: null, top: [] }
    const last = (this.db.prepare(`SELECT host, url, title, started_at AS at FROM music ORDER BY started_at DESC LIMIT 1`).get() ??
      null) as MusicNow | null
    const top = this.db
      .prepare(`SELECT title, host, COUNT(*) AS count FROM music GROUP BY title ORDER BY count DESC, MAX(started_at) DESC LIMIT 8`)
      .all() as MusicTop[]
    return { last, top }
  }

  /**
   * Detecta la rutina de una franja: sesiones de navegacion (cortes de >30 min)
   * iniciadas en esa franja durante los ultimos 45 dias; busca el conjunto de
   * sitios-de-apertura que mas se repite. Si una combinacion aparece con
   * suficiente soporte, es una rutina candidata a automatizar.
   */
  routineFor(bucket: string): Routine | null {
    if (!this.db) return null
    const since = Date.now() - 45 * DAY
    const visits = this.db
      .prepare(`SELECT host, url, title, started_at FROM visits WHERE started_at >= ? ORDER BY started_at ASC`)
      .all(since) as VisitRow[]
    if (visits.length === 0) return null

    // Sesionizar: corta cuando hay >30 min de hueco entre visitas consecutivas.
    const GAP = 30 * 60_000
    const sessions: VisitRow[][] = []
    let cur: VisitRow[] = []
    for (const v of visits) {
      if (cur.length && v.started_at - cur[cur.length - 1].started_at > GAP) {
        sessions.push(cur)
        cur = []
      }
      cur.push(v)
    }
    if (cur.length) sessions.push(cur)

    // Sesiones cuyo arranque cae en la franja pedida.
    const inBucket = sessions.filter((s) => bucketOf(new Date(s[0].started_at).getHours()) === bucket)
    if (inBucket.length < 3) return null

    // Firma de cada sesion = primeros 3 hosts distintos (ordenados) de la apertura.
    const sig = (s: VisitRow[]): string[] => {
      const seen: string[] = []
      for (const v of s) {
        if (isJunkHost(v.host)) continue
        if (!seen.includes(v.host)) seen.push(v.host)
        if (seen.length === 3) break
      }
      return seen
    }
    const counts = new Map<string, { support: number; hosts: string[] }>()
    for (const s of inBucket) {
      const hosts = sig(s)
      if (hosts.length < 2) continue
      const key = [...hosts].sort().join('|')
      const e = counts.get(key) ?? { support: 0, hosts }
      e.support++
      counts.set(key, e)
    }
    if (counts.size === 0) return null

    let best: { support: number; hosts: string[] } | null = null
    for (const e of counts.values()) if (!best || e.support > best.support) best = e
    if (!best) return null
    // Umbral: visto >=3 veces y en >=40% de las sesiones de la franja.
    if (best.support < 3 || best.support / inBucket.length < 0.4) return null

    const latest = this.db.prepare(`SELECT url, title FROM visits WHERE host = ? ORDER BY started_at DESC LIMIT 1`)
    const steps: RoutineStep[] = best.hosts.map((host) => {
      const rep = latest.get(host) as { url: string; title: string } | undefined
      return { host, url: rep?.url ?? `https://${host}`, title: rep?.title || host }
    })
    return { bucket, steps, support: best.support }
  }

  /** La rutina de la franja actual (si la hay). */
  routineForNow(): Routine | null {
    return this.routineFor(currentBucket())
  }

  /** Perfil completo para el panel de privacidad. */
  profile(): BrainProfile {
    const bucket = currentBucket()
    if (!this.db) {
      return { paused: true, totalVisits: 0, bucket, topSites: [], topMusic: [], routines: [] }
    }
    const totalVisits = (this.db.prepare(`SELECT COUNT(*) AS c FROM visits`).get() as { c: number }).c
    const routines: Routine[] = []
    for (const b of ['manana', 'tarde', 'noche', 'madrugada']) {
      const r = this.routineFor(b)
      if (r) routines.push(r)
    }
    return {
      paused: this.paused,
      totalVisits,
      bucket,
      topSites: this.rank(null, 8, new Set(), 2),
      topMusic: this.music().top,
      routines
    }
  }

  // --- Olvido ----------------------------------------------------------------

  forget(host: string): void {
    if (!this.db || !host) return
    this.db.prepare(`DELETE FROM visits WHERE host = ?`).run(host)
    this.db.prepare(`DELETE FROM music WHERE host = ?`).run(host)
  }

  wipe(): void {
    if (!this.db) return
    this.db.exec(`DELETE FROM visits; DELETE FROM music; DELETE FROM queries;`)
  }

  // --- Historial -------------------------------------------------------------

  /**
   * Historial cronologico (mas reciente primero), con busqueda opcional.
   * Con `distinct`: una fila por URL (su visita mas reciente) y sin hosts
   * basura/ignorados — es superficie de SUGERENCIAS (⌘K), no el panel de
   * historial, asi que se cura como rank(): pedir de mas y filtrar en JS.
   */
  history(
    opts: { query?: string; limit?: number; offset?: number; distinct?: boolean } = {}
  ): HistoryEntry[] {
    if (!this.db) return []
    const limit = Math.min(Math.max(opts.limit ?? 300, 1), 2000)
    const offset = Math.max(opts.offset ?? 0, 0)
    const q = (opts.query ?? '').trim()
    if (opts.distinct) {
      const like = `%${q}%`
      // En SQLite, las columnas sueltas junto a MAX() vienen de la fila del
      // maximo: exactamente la visita mas reciente de cada URL.
      const rows = this.db
        .prepare(
          `SELECT id, host, url, title, MAX(started_at) AS at FROM visits
           WHERE title LIKE ? OR url LIKE ? OR host LIKE ?
           GROUP BY url ORDER BY at DESC LIMIT ?`
        )
        .all(like, like, like, limit + 24) as HistoryEntry[]
      return rows
        .filter((r) => !isJunkHost(r.host) && !this.ignoredSet.has(r.host))
        .slice(0, limit)
    }
    if (q) {
      const like = `%${q}%`
      return this.db
        .prepare(
          `SELECT id, host, url, title, started_at AS at FROM visits
           WHERE title LIKE ? OR url LIKE ? OR host LIKE ?
           ORDER BY started_at DESC LIMIT ? OFFSET ?`
        )
        .all(like, like, like, limit, offset) as HistoryEntry[]
    }
    return this.db
      .prepare(
        `SELECT id, host, url, title, started_at AS at FROM visits
         ORDER BY started_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as HistoryEntry[]
  }

  /**
   * Busquedas anteriores (⌘K / URLs con ?q=) que casan con `q`, sin repetir y
   * mas recientes primero. Alimenta el "volver a buscar" de la paleta.
   */
  pastQueries(q: string, limit = 3): string[] {
    if (!this.db) return []
    const text = q.trim()
    if (!text) return []
    const rows = this.db
      .prepare(
        `SELECT text, MAX(ts) AS ts FROM queries WHERE text LIKE ?
         GROUP BY text COLLATE NOCASE ORDER BY ts DESC LIMIT ?`
      )
      .all(`%${text}%`, Math.min(Math.max(limit, 1), 10)) as { text: string }[]
    return rows.map((r) => r.text)
  }

  /** Borra una visita concreta del historial. */
  deleteVisit(id: number): void {
    if (!this.db) return
    this.db.prepare(`DELETE FROM visits WHERE id = ?`).run(id)
  }

  /** Borra el historial: todo, o solo lo posterior a `sinceMs` (epoch ms). */
  clearHistory(sinceMs?: number): void {
    if (!this.db) return
    if (sinceMs && sinceMs > 0) this.db.prepare(`DELETE FROM visits WHERE started_at >= ?`).run(sinceMs)
    else this.db.exec(`DELETE FROM visits`)
  }

  // --- Ignorar (no aprender este sitio) --------------------------------------

  private loadIgnored(): void {
    if (!this.db) return
    const row = this.db.prepare(`SELECT value FROM kv WHERE key = 'ignored'`).get() as
      | { value: string }
      | undefined
    if (!row?.value) return
    try {
      for (const h of JSON.parse(row.value) as string[]) this.ignoredSet.add(h)
    } catch {
      /* valor corrupto: lista vacia */
    }
  }

  private saveIgnored(): void {
    if (!this.db) return
    this.db
      .prepare(
        `INSERT INTO kv(key, value) VALUES('ignored', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(JSON.stringify([...this.ignoredSet]))
  }

  isIgnored(host: string): boolean {
    return this.ignoredSet.has(host)
  }

  /** Deja de aprender de un dominio y olvida lo que ya sabia de el. */
  ignore(host: string): void {
    if (!host) return
    this.ignoredSet.add(host)
    this.saveIgnored()
    this.forget(host)
  }

  /** Vuelve a permitir el aprendizaje de un dominio. */
  unignore(host: string): void {
    if (!this.ignoredSet.delete(host)) return
    this.saveIgnored()
  }

  ignored(): string[] {
    return [...this.ignoredSet].sort()
  }

  dispose(): void {
    try {
      this.db?.close()
    } catch {
      /* ya cerrada */
    }
    this.db = null
  }
}
