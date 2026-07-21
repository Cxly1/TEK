import { app, net, session as electronSession } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  ElectronBlocker,
  fetchResources,
  type Fetch,
  type Request as AdRequest
} from '@ghostery/adblocker-electron'
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
 */

const RESOURCES_CHECKSUM = 'ghostery-resources'

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
 * Regla que exime a un sitio ENTERO del filtrado de red.
 *
 * OJO, esto tiene truco y nos costo un bug largo: la forma "obvia"
 * `@@||host^$document` NO SIRVE aqui. El adaptador de Electron de Ghostery
 * decide asi (comprobado en su codigo, `onBeforeRequest`):
 *
 *     if (request.isMainFrame()) { callback({}); return }
 *     const { redirect, match } = this.match(request)
 *
 * O sea: no existe ninguna nocion de "esta pagina esta permitida". Solo casa el
 * filtro contra CADA peticion. Y como las de tipo `document` ya salen antes por
 * el `isMainFrame()`, una excepcion `$document` no llega a exentar nada: las
 * subpeticiones (xhr, imagenes, scripts) se seguian bloqueando igual.
 *
 * `@@*$domain=host` si: casa cualquier peticion cuyo ORIGEN sea esa pagina,
 * incluidas las de terceros. Medido con el motor real (`__ztest__`): con
 * `$document` seguian bloqueadas 4 de 7 peticiones tipicas de YouTube; con
 * esta, 0 de 7. Cubre subdominios (www.youtube.com entra con `youtube.com`).
 */
function allowRule(host: string): string {
  return `@@*$domain=${host}`
}

/**
 * Sitios eximidos del filtrado de RED porque sus anuncios son de PRIMERA PARTE
 * (mismo dominio que el contenido) y bloquearlos rompe el sitio sin quitar nada.
 *
 * YOUTUBE YA NO ESTA AQUI, y es a proposito (2026-07-20). Eximirlo parecia lo
 * sensato, pero desactivaba de paso el filtrado COSMETICO y los SCRIPTLETS, que
 * son justo el metodo que funciona — el mismo que usa Brave. El motor ya se baja
 * los scriptlets de uBlock Origin (147 cargados, 34 aplicables a youtube.com) y
 * entre ellos van los `set-constant` que neutralizan el detector de adblock de
 * YouTube. Al eximir el sitio los apagabamos y luego intentabamos hacer su
 * trabajo a mano desde el preload, que es lo que YouTube detectaba. Ahora
 * YouTube va por el camino normal, como en Brave.
 *
 * Spotify SI sigue: sus anuncios de audio viajan por su maquina de reproduccion
 * y las listas publicas no los cubren, asi que ahi el defuser de webview.ts
 * sigue siendo la unica capa que funciona (ver [[tek-spotify]]).
 */
const SITE_EXCEPTIONS = [allowRule('spotify.com')]

interface AdSettings {
  enabled: boolean
  allowlist: string[]
}

/** Fetch de Chromium (usa los certs del sistema; el node fetch falla en su red). */
const cFetch = ((url: string) => net.fetch(url)) as unknown as Fetch

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
  private readonly settingsPath = join(this.dir, 'settings.json')
  private refreshTimer: NodeJS.Timeout | null = null

  constructor(partition: string) {
    this.session = electronSession.fromPartition(partition)
  }

  /** Arranque: settings + motor (cache→baseline) y refresco en segundo plano. */
  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true }).catch(() => undefined)
    await this.loadSettings()

    // 1) Motor desde cache (instantaneo, offline).
    try {
      const buf = await readFile(this.enginePath)
      this.setBlocker(ElectronBlocker.deserialize(new Uint8Array(buf)))
    } catch {
      // 2) Baseline embebido: nunca arrancar totalmente sin proteccion.
      try {
        this.setBlocker(ElectronBlocker.parse(BASELINE, { enableCompression: true }))
      } catch (e) {
        console.error('[TEK Adblock] no se pudo crear el motor baseline:', e)
      }
    }

    // 3) En segundo plano: listas completas frescas via net.fetch, ahora y
    // luego cada 12h (ver REFRESH_MS).
    void this.refresh()
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS)
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
    // en document_start desde el preload (ver scriptsFor / WV.adScripts), asi
    // que al camino del adaptador (sus llamadas llevan el callerContext que
    // pone BlockingContext) se le apagan las injection rules para no meterlos
    // dos veces; sus ESTILOS y reglas por DOM siguen tal cual, que para CSS el
    // timing tardio no es problema.
    const origGet = b.getCosmeticsFilters.bind(b)
    b.getCosmeticsFilters = (payload) => {
      const ctx = (payload as { callerContext?: { processId?: unknown } }).callerContext
      return typeof ctx?.processId === 'number'
        ? origGet({ ...payload, getInjectionRules: false })
        : origGet(payload)
    }
    b.on('request-blocked', (req: AdRequest) => {
      const id = req.tabId ?? -1
      this.blockedByWc.set(id, (this.blockedByWc.get(id) ?? 0) + 1)
      this.onBlocked?.()
    })
    this.applySiteExceptions()
    this.applyAllowlist()
    this.applyEnabled()
  }

  /** Exime ciertas paginas first-party del filtrado de RED (ver SITE_EXCEPTIONS). */
  private applySiteExceptions(): void {
    if (!this.blocker) return
    try {
      this.blocker.updateFromDiff({ added: SITE_EXCEPTIONS, removed: [] })
    } catch (e) {
      console.error('[TEK Adblock] no se pudieron aplicar las exenciones de sitio:', e)
    }
  }

  /** Descarga listas completas + scriptlets, cachea y reemplaza el motor. */
  private async refresh(): Promise<void> {
    try {
      const fresh = await ElectronBlocker.fromLists(cFetch, LISTS, { enableCompression: true })
      try {
        const resources = await fetchResources(cFetch)
        fresh.updateResources(resources, RESOURCES_CHECKSUM)
      } catch {
        /* sin scriptlets: el bloqueo de red sigue funcionando */
      }
      await writeFile(this.enginePath, Buffer.from(fresh.serialize())).catch(() => undefined)
      this.setBlocker(fresh)
    } catch (e) {
      console.error('[TEK Adblock] refresco de listas fallido (sigo con lo que tengo):', e)
    }
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

  /** Reaplica las excepciones de la allowlist al motor actual. */
  private applyAllowlist(): void {
    if (!this.blocker || this.allow.size === 0) return
    const added = [...this.allow].map(allowRule)
    try {
      this.blocker.updateFromDiff({ added, removed: [] })
    } catch (e) {
      // Antes esto se tragaba el fallo en silencio y no habia forma de saber
      // que un sitio permitido seguia filtrado. Que se vea.
      console.error('[TEK Adblock] no se pudo aplicar la allowlist:', e)
    }
  }

  setEnabled(on: boolean): boolean {
    this.enabled = on
    this.applyEnabled()
    void this.saveSettings()
    return this.enabled
  }

  /** Permite o vuelve a bloquear en un dominio concreto. */
  setSiteAllowed(host: string, allowed: boolean): void {
    if (!host) return
    const rule = allowRule(host)
    if (allowed) {
      this.allow.add(host)
      this.blocker?.updateFromDiff({ added: [rule], removed: [] })
    } else {
      this.allow.delete(host)
      this.blocker?.updateFromDiff({ added: [], removed: [rule] })
    }
    void this.saveSettings()
  }

  siteAllowed(host: string): boolean {
    return this.allow.has(host)
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
    // Sitio permitido en el escudo = no tocar nada (espejo de WV.siteUntouched;
    // el preload ya lo comprueba, esto es el cinturon del lado main).
    if (this.allow.has(u.hostname) || this.allow.has(u.hostname.replace(/^www\./, ''))) return []
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

  status(): { enabled: boolean; ready: boolean } {
    return { enabled: this.enabled, ready: this.blocker !== null }
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
    await writeFile(this.settingsPath, JSON.stringify(data), 'utf8').catch(() => undefined)
  }

  dispose(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
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
