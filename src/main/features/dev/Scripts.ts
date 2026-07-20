import { randomUUID } from 'node:crypto'
import type { SiteScript, Snippet, SnippetResult } from '@shared/ipc'
import { JsonStore } from './jsonStore'

/**
 * Scripts de TEK, dos sabores:
 *  - SNIPPETS: one-liners de consola guardados, se ejecutan a mano en la pestana
 *    activa (⌘K / panel / accion de receta).
 *  - SITE SCRIPTS: JS/CSS que se inyecta SOLO en los sitios que tu digas, en cada
 *    carga (Tampermonkey-lite). ViewManager llama applyTo() en dom-ready.
 * Todo es codigo DEL USUARIO ejecutandose en paginas que el elige; TEK no inyecta
 * nada por su cuenta.
 */

interface ScriptsData {
  snippets: Snippet[]
  siteScripts: SiteScript[]
}

export class Scripts {
  private readonly store = new JsonStore<ScriptsData>('tek-scripts.json', {
    snippets: [],
    siteScripts: []
  })
  /** El motor pide la pestana activa al ejecutar un snippet. */
  getActiveWc: (() => Electron.WebContents | null) | null = null

  // --- Snippets ----------------------------------------------------------------

  snippets(): Snippet[] {
    return this.store.data.snippets
  }

  saveSnippet(s: Snippet): void {
    const clean: Snippet = {
      id: typeof s.id === 'string' && s.id ? s.id : randomUUID(),
      name: String(s.name ?? '').trim().slice(0, 80) || 'Snippet',
      code: String(s.code ?? ''),
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now()
    }
    const idx = this.store.data.snippets.findIndex((x) => x.id === clean.id)
    if (idx >= 0) this.store.data.snippets[idx] = clean
    else this.store.data.snippets.push(clean)
    this.store.save()
  }

  deleteSnippet(id: string): void {
    this.store.data.snippets = this.store.data.snippets.filter((s) => s.id !== id)
    this.store.save()
  }

  /** Ejecuta un snippet en la pestana activa y devuelve el resultado legible. */
  async runSnippet(id: string): Promise<SnippetResult> {
    const s = this.store.data.snippets.find((x) => x.id === id)
    if (!s) return { ok: false, value: 'Snippet no encontrado' }
    const wc = this.getActiveWc?.() ?? null
    if (!wc || wc.isDestroyed()) return { ok: false, value: 'No hay pestaña activa con página' }
    return evalInPage(wc, s.code)
  }

  // --- Scripts por sitio ---------------------------------------------------------

  siteScripts(): SiteScript[] {
    return this.store.data.siteScripts
  }

  saveSiteScript(s: SiteScript): void {
    const clean: SiteScript = {
      id: typeof s.id === 'string' && s.id ? s.id : randomUUID(),
      name: String(s.name ?? '').trim().slice(0, 80) || 'Script de sitio',
      host: String(s.host ?? '').trim().replace(/^www\./, '').toLowerCase(),
      enabled: s.enabled !== false,
      js: String(s.js ?? ''),
      css: String(s.css ?? ''),
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now()
    }
    const idx = this.store.data.siteScripts.findIndex((x) => x.id === clean.id)
    if (idx >= 0) this.store.data.siteScripts[idx] = clean
    else this.store.data.siteScripts.push(clean)
    this.store.save()
  }

  deleteSiteScript(id: string): void {
    this.store.data.siteScripts = this.store.data.siteScripts.filter((s) => s.id !== id)
    this.store.save()
  }

  /** Inyecta los scripts del usuario que apliquen a este host (dom-ready). */
  applyTo(wc: Electron.WebContents, host: string): void {
    if (!host || wc.isDestroyed()) return
    const h = host.replace(/^www\./, '').toLowerCase()
    for (const s of this.store.data.siteScripts) {
      if (!s.enabled || !s.host) continue
      if (h !== s.host && !h.endsWith(`.${s.host}`)) continue
      if (s.css.trim()) void wc.insertCSS(s.css).catch(() => undefined)
      if (s.js.trim()) void wc.executeJavaScript(`(() => {\n${s.js}\n})()`, true).catch(() => undefined)
    }
  }

  dispose(): void {
    this.store.dispose()
  }
}

/**
 * Ejecuta codigo del usuario en una pagina y devuelve algo legible. Primero lo
 * intenta como EXPRESION (estilo consola: `document.title`); si no parsea, como
 * cuerpo de funcion (usa `return` para devolver un valor).
 */
export async function evalInPage(wc: Electron.WebContents, code: string): Promise<SnippetResult> {
  const show = `
    .then((v) => { try { return JSON.stringify(v) ?? 'undefined' } catch { return String(v) } })`
  const asExpression = `Promise.resolve().then(async () => ( ${code} ))${show}`
  const asStatements = `Promise.resolve().then(async () => { ${code} })${show}`
  try {
    const value = (await wc.executeJavaScript(asExpression, true)) as string
    return { ok: true, value }
  } catch {
    try {
      const value = (await wc.executeJavaScript(asStatements, true)) as string
      return { ok: true, value }
    } catch (err) {
      return { ok: false, value: err instanceof Error ? err.message : String(err) }
    }
  }
}
