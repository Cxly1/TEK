import { app, net, session as electronSession, utilityProcess, webContents } from 'electron'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, stat } from 'node:fs/promises'
import {
  ElectronBlocker,
  type BlockingResponse,
  type Request as AdRequest
} from '@ghostery/adblocker-electron'
import type { AdblockSource } from '@shared/ipc'
// El mismo parser de dominios que usa el motor por dentro: el eTLD+1 que le
// pasemos a getCosmeticsFilters tiene que salir igual que el suyo.
import { parse as parseDomain } from 'tldts-experimental'

/**
 * Adblock definitivo de TEK (3 capas: red + cosmetico + scriptlets) sobre el
 * motor de Ghostery (linaje uBlock Origin / Brave).
 *
 * OFFLINE-FIRST: arranca SIEMPRE, sin red. En redes con SSL interceptado (proxy
 * corporativo) fallan las descargas por Node/curl, pero `net.fetch` (Chromium + certs del
 * sistema) SI funciona — asi que todas las descargas pasan por `net.fetch`, y
 * ademas cacheamos el motor serializado en disco para no depender de la red.
 *
 * Resiliente como el Brain: si algo falla, degrada y el navegador no se cae.
 *
 * CODIGO vs DATOS (ronda de seguridad 2026-10):
 *  - Los SCRIPTLETS (resources.json: el codigo que corre dentro de cada web)
 *    salen SOLO del instalador, como en uBlock Origin o Brave, que los llevan
 *    dentro. Antes se bajaban de raw.githubusercontent cada 12 h: si ese CDN se
 *    comprometia, su codigo acababa dentro de tu banco o tu correo.
 *  - Las LISTAS (datos: que bloquear y con que argumentos) se siguen bajando
 *    cada 12 h, que es lo que cambia a diario. Pero de las listas que no son de
 *    uBO se quitan los scriptlets `trusted-*`: esos aceptan cualquier argumento
 *    (meter HTML, reescribir respuestas...) y uBO solo los acepta de SUS listas;
 *    el motor de Ghostery no hace esa distincion, asi que la hacemos aqui.
 *  - Parsear las listas (1-1,5 s de CPU) va en un proceso aparte (worker.ts):
 *    antes congelaba TEK entero tras cada arranque y cada 12 h. Y si la cache
 *    tiene menos de 12 h, al arrancar ni se refresca.
 */

/** De quien son las listas en las que SI se aceptan scriptlets trusted-*. */
const TRUSTED_LISTS_PREFIX = 'https://ublockorigin.github.io/'

/** Un scriptlet trusted-* (sintaxis uBO `+js(...)` o AdGuard `//scriptlet(...)`). */
const TRUSTED_SCRIPTLET = /(\+js\(\s*|\/\/scriptlet\(\s*['"])trusted-/i

/** Quita los scriptlets trusted-* de una lista que no es de uBO (ver arriba). */
export function stripTrustedScriptlets(url: string, text: string): string {
  if (url.startsWith(TRUSTED_LISTS_PREFIX)) return text
  if (!TRUSTED_SCRIPTLET.test(text)) return text
  return text
    .split('\n')
    .filter((line) => !TRUSTED_SCRIPTLET.test(line))
    .join('\n')
}

/**
 * Escritura atomica (tmp + rename): un cierre a mitad no deja el motor, la meta
 * o los ajustes partidos (un engine.bin roto obligaba a reparsear el snapshot).
 */
async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

/** Huella corta de un texto (para saber si las listas o los scriptlets cambiaron). */
function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32)
}

/** Lo que se recuerda del motor guardado en cache (adblock/meta.json). */
interface EngineMeta {
  /** Huella de las listas con las que se construyo. */
  listsHash: string
  /** Cuando se comprobaron por ultima vez contra la red (ms). */
  checkedAt: number
}

/**
 * Refresco de listas: al arrancar y luego cada 12h mientras TEK siga abierta.
 * No es capricho: los quick-fixes de uBO (la contramedida del muro anti-adblock
 * de YouTube) cambian con frecuencia de DIAS, y TEK puede pasarse semanas
 * abierta sin reiniciar.
 */
const REFRESH_MS = 12 * 60 * 60 * 1000

/** Listas completas (se bajan en segundo plano por net.fetch y se cachean). */
const LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/filters.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/badware.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/privacy.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/quick-fixes.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/annoyances-cookies.txt',
  'https://filters.adtidy.org/extension/ublock/filters/14_optimized.txt', // AdGuard Annoyances
  'https://easylist-downloads.adblockplus.org/easylistspanish.txt' // anuncios MX/ES
]

/**
 * Baseline embebido: los peores ofensores. Garantiza bloqueo inmediato en el
 * primer arranque, antes de que termine la primera descarga de listas.
 */
const BASELINE = `
||doubleclick.net^
||g.doubleclick.net^
||pagead2.googlesyndication.com^
||googlesyndication.com^
||googleadservices.com^
||googletagservices.com^
||google-analytics.com^
||googletagmanager.com^
||adservice.google.com^
||2mdn.net^
||ads.youtube.com^
||static.doubleclick.net^
||connect.facebook.net^
||facebook.com/tr^
||scorecardresearch.com^
||adnxs.com^
||amazon-adsystem.com^
||taboola.com^
||outbrain.com^
||criteo.com^
||criteo.net^
||quantserve.com^
||moatads.com^
||adsafeprotected.com^
||serving-sys.com^
||rubiconproject.com^
||pubmatic.com^
||openx.net^
||casalemedia.com^
||bidswitch.net^
||zedo.com^
||adcolony.com^
`

/**
 * Sitios eximidos del filtrado de RED porque sus anuncios son de PRIMERA PARTE
 * (mismo dominio que el contenido) y bloquearlos rompe el sitio sin quitar nada.
 *
 * YOUTUBE NO ESTA AQUI, y es a proposito (2026-07-20). Eximirlo parecia lo
 * sensato, pero desactivaba de paso el filtrado COSMETICO y los SCRIPTLETS, que
 * son justo el metodo que funciona — el mismo que usa Brave (34 scriptlets de
 * uBO aplicables a youtube.com, entre ellos los `set-constant` que neutralizan
 * su detector de adblock). YouTube va por el camino normal, como en Brave.
 *
 * Spotify SI: sus anuncios de audio viajan por su maquina de reproduccion y las
 * listas publicas no los cubren; ahi el defuser de webview.ts es la unica capa
 * que funciona. Solo se le quita el filtrado de RED (cosmeticos y scriptlets
 * siguen).
 */
const NETWORK_EXEMPT = ['spotify.com']

/** Lo que contesta el motor cuando una peticion NO se toca. */
const NO_MATCH: BlockingResponse = {
  match: false,
  redirect: undefined,
  rewrite: undefined,
  exception: undefined,
  filter: undefined,
  metadata: undefined
}

/** Host de una URL ('' si no lo tiene). */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Host de la PAGINA de una pestana por su id de webContents (el `tabId` del motor). */
function pageHostOf(wcId: number): string {
  if (!(wcId >= 0)) return ''
  const wc = webContents.fromId(wcId)
  return wc && !wc.isDestroyed() ? hostnameOf(wc.getURL()) : ''
}

/**
 * ¿`hostname` es alguno de `domains` o un subdominio suyo? (lo mismo que hacia
 * la regla `@@*$domain=host` del motor). Las entradas pueden traer puerto o
 * `www.`: no cuentan.
 */
function covers(domains: Iterable<string>, hostname: string): boolean {
  const h = (hostname || '').toLowerCase().replace(/^www\./, '')
  if (!h) return false
  for (const raw of domains) {
    const d = raw.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '')
    if (d && (h === d || h.endsWith(`.${d}`))) return true
  }
  return false
}

interface AdSettings {
  enabled: boolean
  allowlist: string[]
}

/** Fetch de Chromium (usa los certs del sistema; el node fetch falla en su red). */
const cFetch = (url: string): Promise<Response> => net.fetch(url)

export class Adblock {
  private readonly session: Electron.Session
  private blocker: ElectronBlocker | null = null
  private enabled = true
  private readonly allow = new Set<string>()
  /** Bloqueos por webContents id (= request.tabId). Se reinicia al navegar. */
  private readonly blockedByWc = new Map<number, number>()
  /** Callback que avisa al ViewManager para refrescar el contador (throttled). */
  onBlocked: (() => void) | null = null

  private readonly dir = join(app.getPath('userData'), 'adblock')
  private readonly enginePath = join(this.dir, 'engine.bin')
  private readonly metaPath = join(this.dir, 'meta.json')
  private readonly settingsPath = join(this.dir, 'settings.json')
  private meta: EngineMeta = { listsHash: '', checkedAt: 0 }
  /**
   * Snapshot de listas EMPAQUETADO con la app (listas + scriptlets del dia del
   * build). En produccion vive en resources/adblock; en dev, en assets/adblock.
   * Es lo que da proteccion COMPLETA en una instalacion fresca sin red — antes
   * solo estaba el baseline de ~30 dominios y a quien no le cargaban las listas
   * (red que bloquea GitHub, primer arranque sin internet) le pasaban anuncios.
   */
  private readonly assetDir = app.isPackaged
    ? join(process.resourcesPath, 'adblock')
    : join(app.getAppPath(), 'assets', 'adblock')
  /** El siguiente refresco programado (uno solo a la vez). */
  private refreshTimer: NodeJS.Timeout | null = null

  /** Diagnostico: de donde salio el motor activo y de que fecha son sus listas. */
  private source: AdblockSource = 'baseline'
  private updatedAt: number | null = null
  /** Anti-solape + backoff del refresco (un fallo transitorio no espera 12h). */
  private refreshing = false
  private refreshRetries = 0
  /** resources.json del instalador (scriptlets) y su huella, leido una vez. */
  private packed: { data: string; checksum: string } | null = null
  private packedTried = false

  constructor(partition: string) {
    this.session = electronSession.fromPartition(partition)
  }

  /** Arranque: settings + motor (cache→snapshot→baseline) y refresco en segundo plano. */
  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true }).catch(() => undefined)
    await this.loadSettings()
    await this.loadMeta()
    const res = await this.packagedResources()

    // 1) Cache de un refresco previo (lo mas fresco, instantaneo, offline). Sus
    // scriptlets se alinean con los del instalador (una version nueva de TEK
    // trae los suyos).
    if (await this.loadEngine(this.enginePath, 'cache')) {
      this.pinResources(res)
    } else if (await this.loadSnapshot(res)) {
      // 2) Snapshot empaquetado: listas + scriptlets del dia del build. Cubre la
      // instalacion fresca aunque no haya red o la red bloquee las listas. Se
      // deja en cache para que el siguiente arranque no vuelva a parsearlo.
      void this.saveEngine()
    } else {
      // 3) Baseline embebido: nunca arrancar del todo sin proteccion.
      try {
        this.setBlocker(ElectronBlocker.parse(BASELINE, { enableCompression: true }))
        this.source = 'baseline'
        this.updatedAt = null
      } catch (e) {
        console.error('[TEK Adblock] no se pudo crear el motor baseline:', e)
      }
    }
    if (!res) {
      // En el instalador SIEMPRE esta. En dev falta si no se genero el snapshot.
      console.warn('[TEK Adblock] sin resources.json empaquetado: no hay scriptlets (pnpm snapshot:adblock)')
    }

    // 4) Listas frescas en segundo plano. Si la cache se comprobo hace menos de
    // 12 h, no hace falta mirar ahora: se programa para cuando toque (antes se
    // refrescaba en CADA arranque y eso era el congelon).
    const last = this.source === 'cache' ? this.meta.checkedAt || this.updatedAt || 0 : 0
    const age = Date.now() - last
    this.scheduleRefresh(age >= 0 && age < REFRESH_MS ? REFRESH_MS - age : 0)
  }

  /** Carga el motor desde un .bin serializado; true si funciono. Fija origen/fecha. */
  private async loadEngine(path: string, source: AdblockSource): Promise<boolean> {
    try {
      const buf = await readFile(path)
      this.setBlocker(ElectronBlocker.deserialize(new Uint8Array(buf)))
      this.source = source
      this.updatedAt = await stat(path)
        .then((s) => s.mtimeMs)
        .catch(() => null)
      return true
    } catch {
      return false
    }
  }

  /** Motor desde el snapshot empaquetado: listas (lists.txt) + scriptlets (resources.json). */
  private async loadSnapshot(res: { data: string; checksum: string } | null): Promise<boolean> {
    try {
      const text = await readFile(join(this.assetDir, 'lists.txt'), 'utf8')
      // Primera vez en este equipo (o motor de otra version): se parsea AQUI,
      // como siempre, para que la primera pagina ya salga protegida del todo.
      const engine = ElectronBlocker.parse(text, { enableCompression: true })
      if (res) engine.updateResources(res.data, res.checksum)
      this.setBlocker(engine)
      this.source = 'snapshot'
      this.updatedAt = await stat(join(this.assetDir, 'lists.txt'))
        .then((s) => s.mtimeMs)
        .catch(() => null)
      return true
    } catch {
      return false
    }
  }

  /** Lee (una sola vez) el resources.json del instalador y calcula su huella. */
  private async packagedResources(): Promise<{ data: string; checksum: string } | null> {
    if (this.packedTried) return this.packed
    this.packedTried = true
    const data = await readFile(join(this.assetDir, 'resources.json'), 'utf8').catch(() => null)
    this.packed = data ? { data, checksum: `tek-${fingerprint(data)}` } : null
    return this.packed
  }

  /**
   * Los scriptlets del motor activo pasan a ser los del instalador si no lo
   * eran (cache de una version anterior, o de cuando se bajaban de internet).
   */
  private pinResources(res: { data: string; checksum: string } | null): void {
    if (!res || !this.blocker || this.blocker.resources.checksum === res.checksum) return
    try {
      this.blocker.updateResources(res.data, res.checksum)
      void this.saveEngine()
    } catch (e) {
      console.error('[TEK Adblock] no se pudieron poner los scriptlets del instalador:', e)
    }
  }

  /** Guarda el motor activo en cache (para arrancar sin parsear). */
  private async saveEngine(): Promise<void> {
    if (!this.blocker) return
    await writeAtomic(this.enginePath, this.blocker.serialize()).catch(() => undefined)
  }

  private async loadMeta(): Promise<void> {
    try {
      const m = JSON.parse(await readFile(this.metaPath, 'utf8')) as Partial<EngineMeta>
      this.meta = {
        listsHash: typeof m.listsHash === 'string' ? m.listsHash : '',
        checkedAt: typeof m.checkedAt === 'number' ? m.checkedAt : 0
      }
    } catch {
      /* primera vez: sin meta (se refresca al arrancar) */
    }
  }

  private async saveMeta(): Promise<void> {
    await writeAtomic(this.metaPath, JSON.stringify(this.meta)).catch(() => undefined)
  }

  /** Reemplaza el motor activo: re-cablea conteo, allowlist y bloqueo. */
  private setBlocker(b: ElectronBlocker): void {
    // Quita el anterior de la sesion antes de cambiar.
    if (this.blocker) {
      try {
        this.blocker.disableBlockingInSession(this.session)
      } catch {
        /* no estaba activo */
      }
    }
    this.blocker = b
    // SCRIPTLETS POR NUESTRA CUENTA, y esta es la pieza que mata el muro
    // anti-adblock de YouTube: el adaptador de Ghostery los inyecta con
    // webContents.executeJavaScript, que si la pagina aun esta cargando ESPERA
    // a did-stop-loading — los set-constant que desarman el detector llegaban
    // SEGUNDOS despues de que el detector ya hubiera corrido. TEK los inyecta
    // en document_start desde el preload (ver scriptsFor / WV.boot), asi
    // que al camino del adaptador (sus llamadas llevan el callerContext que
    // pone BlockingContext) se le apagan las injection rules para no meterlos
    // dos veces; sus ESTILOS y reglas por DOM siguen tal cual, que para CSS el
    // timing tardio no es problema.
    const origGet = b.getCosmeticsFilters.bind(b)
    b.getCosmeticsFilters = (payload) => {
      if (this.userAllowed(payload.hostname)) {
        return { active: false, extended: [], scripts: [], styles: '' }
      }
      const ctx = (payload as { callerContext?: { processId?: unknown } }).callerContext
      return typeof ctx?.processId === 'number'
        ? origGet({ ...payload, getInjectionRules: false })
        : origGet(payload)
    }
    // SITIOS PERMITIDOS sin tocar el motor. Antes se le metian reglas
    // `@@*$domain=host` con updateFromDiff, y eso cuesta ~460 ms de CPU en el
    // proceso principal CADA vez que se pone un motor (al arrancar, tras cada
    // refresco y al pulsar "permitir sitio"): medido en
    // __ztest__/probe-abw-costes.mjs. Ahora se mira el sitio de ORIGEN de cada
    // peticion aqui fuera, que es lo mismo que hacia esa regla y no cuesta nada.
    // "Permitir sitio" = no tocar nada: ni red, ni CSP, ni cosmeticos, ni
    // scriptlets. Spotify (NETWORK_EXEMPT) solo se libra de la red.
    // El sitio "permitido" es el de la PESTANA (lo que ves en la barra), asi que
    // se libra todo lo que pida esa pagina, iframes incluidos. Spotify se mira
    // como lo miraba el motor: por quien hace la peticion (su referer).
    const origMatch = b.match.bind(b)
    b.match = (request: AdRequest, withMetadata?: boolean) => {
      const page = pageHostOf(request.tabId)
      if (this.userAllowed(page)) return NO_MATCH
      const details = request._originalRequestDetails as { referrer?: string } | undefined
      if (covers(NETWORK_EXEMPT, hostnameOf(details?.referrer ?? '') || page)) return NO_MATCH
      return origMatch(request, withMetadata)
    }
    const origCSP = b.getCSPDirectives.bind(b)
    b.getCSPDirectives = (request: AdRequest) =>
      this.userAllowed(request.hostname) || this.userAllowed(pageHostOf(request.tabId))
        ? undefined
        : origCSP(request)
    b.on('request-blocked', (req: AdRequest) => {
      const id = req.tabId ?? -1
      this.blockedByWc.set(id, (this.blockedByWc.get(id) ?? 0) + 1)
      this.onBlocked?.()
    })
    this.applyEnabled()
  }

  /** ¿Sitio permitido por ti en el escudo (o subdominio suyo)? */
  private userAllowed(hostname: string): boolean {
    return this.allow.size > 0 && covers(this.allow, hostname)
  }

  /** Programa el siguiente refresco (uno solo a la vez). */
  private scheduleRefresh(ms: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh()
    }, Math.max(0, ms))
  }

  /**
   * Descarga las listas, y SOLO si cambiaron construye un motor nuevo, en un
   * proceso aparte. Los scriptlets son siempre los del instalador.
   */
  private async refresh(): Promise<void> {
    if (this.refreshing) return
    this.refreshing = true
    try {
      // Descarga TOLERANTE: cada lista por su cuenta (allSettled). Si 8 de 9
      // llegan, refrescamos con esas 8. Una respuesta de error (404, pagina
      // de un portal cautivo) no es una lista: se descarta.
      const settled = await Promise.allSettled(
        LISTS.map(async (u) => {
          const r = await cFetch(u)
          if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`)
          return stripTrustedScriptlets(u, await r.text())
        })
      )
      const texts = settled
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value)
      if (texts.length === 0) throw new Error('ninguna lista disponible')
      const text = texts.join('\n')
      const listsHash = fingerprint(text)
      const res = await this.packagedResources()

      if (
        listsHash === this.meta.listsHash &&
        this.blocker &&
        (this.source === 'cache' || this.source === 'live')
      ) {
        // Las mismas listas que ya tiene el motor: nada que parsear.
        this.meta.checkedAt = Date.now()
        await this.saveMeta()
      } else {
        const buf = await this.buildEngine(text, res)
        const fresh = ElectronBlocker.deserialize(buf)
        await writeAtomic(this.enginePath, buf).catch(() => undefined)
        this.meta = { listsHash, checkedAt: Date.now() }
        await this.saveMeta()
        this.setBlocker(fresh)
      }
      this.source = 'live'
      this.updatedAt = Date.now()
      this.refreshRetries = 0
      this.scheduleRefresh(REFRESH_MS)
    } catch (e) {
      console.error('[TEK Adblock] refresco de listas fallido (sigo con lo que tengo):', e)
      // Backoff 1,2,4,8,16 min (tope 30): reintenta pronto, no a las 12h.
      const delayMin = Math.min(30, 2 ** this.refreshRetries)
      this.refreshRetries = Math.min(this.refreshRetries + 1, 5)
      this.scheduleRefresh(delayMin * 60_000)
    } finally {
      this.refreshing = false
    }
  }

  /**
   * Construye el motor serializado. En un proceso aparte (worker.ts) para no
   * congelar TEK; si ese proceso no arranca o falla, aqui mismo como antes:
   * mejor un congelon que quedarse con listas viejas para siempre.
   */
  private async buildEngine(
    text: string,
    res: { data: string; checksum: string } | null
  ): Promise<Uint8Array> {
    try {
      return await this.buildElsewhere(text, res)
    } catch (e) {
      console.error('[TEK Adblock] el proceso del bloqueador fallo; parseo aqui:', e)
      const engine = ElectronBlocker.parse(text, { enableCompression: true })
      if (res) engine.updateResources(res.data, res.checksum)
      return engine.serialize()
    }
  }

  private buildElsewhere(
    text: string,
    res: { data: string; checksum: string } | null
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const child = utilityProcess.fork(join(import.meta.dirname, 'adblockWorker.js'), [], {
        serviceName: 'TEK bloqueador',
        stdio: 'ignore'
      })
      let settled = false
      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
        try {
          child.kill()
        } catch {
          /* ya salio */
        }
      }
      // Parsear lleva ~1,5 s; con 90 s de margen, algo se colgo.
      const timer = setTimeout(() => finish(() => reject(new Error('sin respuesta en 90 s'))), 90_000)
      child.once('message', (m: { ok?: boolean; buf?: Uint8Array; error?: string }) => {
        finish(() =>
          m?.ok && m.buf ? resolve(new Uint8Array(m.buf)) : reject(new Error(m?.error ?? 'fallo'))
        )
      })
      child.once('exit', (code) => finish(() => reject(new Error(`salio con codigo ${code}`))))
      child.postMessage({ text, resources: res?.data ?? null, checksum: res?.checksum ?? '' })
    })
  }

  // --- Estado / control ------------------------------------------------------

  private applyEnabled(): void {
    if (!this.blocker) return
    try {
      if (this.enabled) this.blocker.enableBlockingInSession(this.session)
      else this.blocker.disableBlockingInSession(this.session)
    } catch (e) {
      console.error('[TEK Adblock] applyEnabled:', e)
    }
  }

  setEnabled(on: boolean): boolean {
    this.enabled = on
    this.applyEnabled()
    void this.saveSettings()
    return this.enabled
  }

  /**
   * Permite o vuelve a bloquear en un dominio concreto. Instantaneo: el motor
   * no se toca (ver los envoltorios de setBlocker). Vale desde la siguiente
   * peticion; lo ya cargado se ve al recargar, como en cualquier bloqueador.
   */
  setSiteAllowed(host: string, allowed: boolean): void {
    if (!host) return
    if (allowed) this.allow.add(host)
    else this.allow.delete(host)
    void this.saveSettings()
  }

  siteAllowed(host: string): boolean {
    return this.allow.has(host)
  }

  /**
   * ¿TEK debe dejar esta pagina COMPLETAMENTE en paz? (lo pregunta el preload en
   * el arranque de cada pagina, WV.boot, antes de parchear nada).
   *
   * No es lo mismo que `siteAllowed`: apagar el escudo con el interruptor global
   * tambien cuenta. Antes NO contaba, y era un embuste — con el adblock apagado
   * se caian el filtrado de red y los scriptlets, pero los defusers del preload
   * (el de anuncios de Spotify, que MUTEA y ADELANTA audio) seguian corriendo.
   * Quien apagaba el escudo para descartarlo de un problema se llevaba una
   * respuesta falsa, que es justo como se pierde una tarde de diagnostico.
   */
  siteUntouched(host: string): boolean {
    return !this.enabled || this.userAllowed(host)
  }

  /**
   * Scriptlets (los `+js(...)` de las listas) que tocan en `url`. Los pide el
   * preload de cada pagina en DOCUMENT_START via sendSync — el metodo de
   * uBO/Brave: un set-constant solo desarma el detector anti-adblock de
   * YouTube si corre ANTES del primer script de la pagina. Sincrono a
   * proposito y barato: es un match en memoria (~ms), una vez por carga.
   */
  scriptsFor(rawUrl: string): string[] {
    if (!this.blocker || !this.enabled) return []
    let u: URL
    try {
      u = new URL(rawUrl)
    } catch {
      return []
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return []
    // Sitio permitido en el escudo = no tocar nada (espejo de `untouched` en WV.boot;
    // el preload ya lo comprueba, esto es el cinturon del lado main).
    if (this.userAllowed(u.hostname)) return []
    try {
      const { active, scripts } = this.blocker.getCosmeticsFilters({
        url: rawUrl,
        hostname: u.hostname,
        domain: parseDomain(u.hostname).domain ?? '',
        // Solo scripts. El CSS (base y por DOM) sigue llegando entero por el
        // adaptador de Ghostery; mandarlo tambien aqui seria duplicarlo.
        getBaseRules: false,
        getInjectionRules: true,
        getExtendedRules: false,
        getRulesFromDOM: false,
        getRulesFromHostname: true
      })
      return active === false ? [] : scripts
    } catch (e) {
      console.error('[TEK Adblock] scriptsFor fallo:', e)
      return []
    }
  }

  status(): { enabled: boolean; ready: boolean; source: AdblockSource; updatedAt: number | null } {
    return {
      enabled: this.enabled,
      ready: this.blocker !== null,
      source: this.source,
      updatedAt: this.updatedAt
    }
  }

  // --- Contador --------------------------------------------------------------

  blockedFor(wcId: number): number {
    return this.blockedByWc.get(wcId) ?? 0
  }

  resetCount(wcId: number): void {
    this.blockedByWc.delete(wcId)
  }

  // --- Persistencia de ajustes ----------------------------------------------

  private async loadSettings(): Promise<void> {
    try {
      const raw = await readFile(this.settingsPath, 'utf8')
      const s = JSON.parse(raw) as AdSettings
      this.enabled = s.enabled !== false
      for (const h of s.allowlist ?? []) this.allow.add(h)
    } catch {
      /* primera vez: defaults (enabled) */
    }
  }

  private async saveSettings(): Promise<void> {
    const data: AdSettings = { enabled: this.enabled, allowlist: [...this.allow] }
    await writeAtomic(this.settingsPath, JSON.stringify(data)).catch(() => undefined)
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = null
    if (this.blocker) {
      try {
        this.blocker.disableBlockingInSession(this.session)
      } catch {
        /* ya estaba */
      }
    }
    this.blocker = null
  }
}
