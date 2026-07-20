import { app, net, session as electronSession } from 'electron'
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  ElectronBlocker,
  fetchResources,
  type Fetch,
  type Request as AdRequest
} from '@ghostery/adblocker-electron'

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
 * Algunos sitios se ROMPEN si el adblock filtra a nivel de RED su propia pagina,
 * porque sus anuncios son de PRIMERA PARTE (mismo dominio que el contenido):
 *
 *  - YouTube: al bloquear sus pings de anuncios (pagead/ptracking/stats/ads)
 *    dispara su anti-adblock y el reproductor se queda en NEGRO / cargando para
 *    siempre (confirmado: permitir el sitio lo arregla al instante).
 *  - Spotify: movio sus anuncios de audio a su propio dominio; filtrar sus
 *    endpoints arriesga romper el login/la reproduccion sin quitar el anuncio.
 *
 * En ambos, los anuncios los quita el "defuse" del preload de la pagina
 * (webview.ts), que corre SIEMPRE e independiente del adblock. Por eso eximimos
 * estas paginas del filtrado de red (igual que hace Brave): el contenido carga y
 * los anuncios siguen fuera. Estas excepciones se reaplican en cada (re)carga del
 * motor, asi que sobreviven al refresco de listas.
 */
const SITE_EXCEPTIONS = [
  '@@||youtube.com^$document',
  '@@||youtube-nocookie.com^$document',
  '@@||spotify.com^$document'
]

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

    // 3) En segundo plano: listas completas frescas via net.fetch.
    void this.refresh()
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
    } catch {
      /* el motor no acepto la diff */
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
    const added = [...this.allow].map((h) => `@@||${h}^$document`)
    try {
      this.blocker.updateFromDiff({ added, removed: [] })
    } catch {
      /* el motor no acepto la diff */
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
    const rule = `@@||${host}^$document`
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
