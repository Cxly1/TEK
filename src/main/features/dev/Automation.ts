import { Notification } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  Recipe,
  RecipeAction,
  RecipeToastInfo,
  SnippetResult,
  Workspace
} from '@shared/ipc'
import { JsonStore } from './jsonStore'

/**
 * Motor de Recetas de TEK: regla = disparador -> acciones. Es LA pieza de la
 * automatizacion; los workspaces viven aqui porque "abrir workspace" es una
 * accion mas. Las recetas disparadas NO se ejecutan a ciegas: piden confirmacion
 * via toast con cuenta atras (onToast -> renderer -> runRecipe), igual que las
 * rutinas aprendidas del cerebro. Ejecutar a mano (⌘K/panel) si es inmediato.
 */

interface AutomationData {
  recipes: Recipe[]
  workspaces: Workspace[]
}

/** Lo que el motor necesita del resto de TEK para ejecutar acciones. */
export interface AutomationDeps {
  openTabs(urls: string[]): void
  runSnippet(id: string): Promise<SnippetResult>
  runMacro(id: string): Promise<void>
  openDevtools(): void
}

/** Un disparador no se re-ofrece hasta pasado este tiempo (visita/server). */
const RETRIGGER_COOLDOWN_MS = 30 * 60_000

/** Solo URLs web en las acciones: nada de file:// u otros esquemas raros. */
function safeUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return []
  return urls
    .filter((u): u is string => typeof u === 'string')
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .slice(0, 20)
}

export class Automation {
  private readonly store = new JsonStore<AutomationData>('tek-automation.json', {
    recipes: [],
    workspaces: []
  })
  private deps: AutomationDeps | null = null
  private timer: NodeJS.Timeout | null = null
  /** Disparos de hora ya ofrecidos hoy (id|fecha|HH:MM). */
  private readonly offered = new Set<string>()
  /** Ultimo disparo por receta (cooldown de visita/server). */
  private readonly lastFired = new Map<string, number>()
  /** El renderer muestra el toast con cuenta atras y decide ejecutar. */
  onToast: ((t: RecipeToastInfo) => void) | null = null

  setDeps(deps: AutomationDeps): void {
    this.deps = deps
  }

  start(): void {
    if (this.timer) return
    // Tic de 20s para los disparadores de hora (granularidad de minuto sobrada).
    this.timer = setInterval(() => this.tickTime(), 20_000)
  }

  // --- Recetas ---------------------------------------------------------------

  recipes(): Recipe[] {
    return this.store.data.recipes
  }

  saveRecipe(r: Recipe): void {
    // Normaliza lo que llega por IPC: ids/strings sanos y URLs solo web.
    const clean: Recipe = {
      id: typeof r.id === 'string' && r.id ? r.id : randomUUID(),
      name: String(r.name ?? '').trim().slice(0, 80) || 'Receta sin nombre',
      enabled: r.enabled !== false,
      trigger: r.trigger ?? { type: 'manual' },
      actions: (Array.isArray(r.actions) ? r.actions : [])
        .map((a) => (a.type === 'openTabs' ? { ...a, urls: safeUrls(a.urls) } : a))
        .filter((a) => a.type !== 'openTabs' || a.urls.length > 0),
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      lastRunAt: typeof r.lastRunAt === 'number' ? r.lastRunAt : null
    }
    const idx = this.store.data.recipes.findIndex((x) => x.id === clean.id)
    if (idx >= 0) this.store.data.recipes[idx] = clean
    else this.store.data.recipes.push(clean)
    this.store.save()
  }

  deleteRecipe(id: string): void {
    this.store.data.recipes = this.store.data.recipes.filter((r) => r.id !== id)
    this.store.save()
  }

  /** Ejecuta las acciones de una receta YA (tras confirmacion o a mano). */
  async run(id: string): Promise<void> {
    const r = this.store.data.recipes.find((x) => x.id === id)
    if (!r || !this.deps) return
    for (const a of r.actions) {
      try {
        await this.runAction(a)
      } catch (err) {
        console.error('[TEK Automation] accion fallida', a.type, err)
      }
    }
    r.lastRunAt = Date.now()
    this.store.save()
  }

  private async runAction(a: RecipeAction): Promise<void> {
    const deps = this.deps!
    switch (a.type) {
      case 'openTabs':
        deps.openTabs(safeUrls(a.urls))
        break
      case 'openWorkspace':
        this.openWorkspace(a.workspaceId)
        break
      case 'notify':
        if (Notification.isSupported()) {
          new Notification({ title: a.title || 'TEK', body: a.body ?? '' }).show()
        }
        break
      case 'runSnippet':
        await deps.runSnippet(a.snippetId)
        break
      case 'runMacro':
        await deps.runMacro(a.macroId)
        break
      case 'openDevtools':
        deps.openDevtools()
        break
    }
  }

  /** Resumen legible de las acciones (para el toast y el panel). */
  summaryOf(r: Recipe): string {
    const parts: string[] = []
    for (const a of r.actions) {
      if (a.type === 'openTabs') parts.push(`abre ${a.urls.length} pestaña${a.urls.length === 1 ? '' : 's'}`)
      else if (a.type === 'openWorkspace') {
        const w = this.store.data.workspaces.find((x) => x.id === a.workspaceId)
        parts.push(`workspace «${w?.name ?? '?'}»`)
      } else if (a.type === 'notify') parts.push('notifica')
      else if (a.type === 'runSnippet') parts.push('ejecuta snippet')
      else if (a.type === 'runMacro') parts.push('ejecuta macro')
      else if (a.type === 'openDevtools') parts.push('abre DevTools')
    }
    return parts.join(' · ') || 'sin acciones'
  }

  // --- Disparadores ------------------------------------------------------------

  /** Ofrece una receta (toast con cuenta atras en el renderer). */
  private offer(r: Recipe): void {
    this.lastFired.set(r.id, Date.now())
    this.onToast?.({ recipeId: r.id, name: r.name, summary: this.summaryOf(r) })
  }

  private cooledDown(id: string): boolean {
    const last = this.lastFired.get(id) ?? 0
    return Date.now() - last > RETRIGGER_COOLDOWN_MS
  }

  /** Al arrancar TEK (lo llama index.ts cuando la ventana esta lista). */
  fireStartup(): void {
    for (const r of this.store.data.recipes) {
      if (r.enabled && r.trigger.type === 'startup') this.offer(r)
    }
  }

  /** Tic del reloj: dispara las recetas de hora que tocan este minuto. */
  private tickTime(): void {
    const now = new Date()
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const date = now.toISOString().slice(0, 10)
    for (const r of this.store.data.recipes) {
      if (!r.enabled || r.trigger.type !== 'time' || r.trigger.at !== hhmm) continue
      if (r.trigger.days && r.trigger.days.length > 0 && !r.trigger.days.includes(now.getDay())) continue
      const key = `${r.id}|${date}|${hhmm}`
      if (this.offered.has(key)) continue
      this.offered.add(key)
      this.offer(r)
    }
  }

  /** Una pestana navego a `host` (lo llama ViewManager). */
  onVisit(host: string): void {
    if (!host) return
    for (const r of this.store.data.recipes) {
      if (!r.enabled || r.trigger.type !== 'visit') continue
      const t = r.trigger.host.replace(/^www\./, '')
      const h = host.replace(/^www\./, '')
      if ((h === t || h.endsWith(`.${t}`)) && this.cooledDown(r.id)) this.offer(r)
    }
  }

  /** Aparecio un server local en `port` (lo llama DevRadar). */
  onServer(port: number): void {
    for (const r of this.store.data.recipes) {
      if (!r.enabled || r.trigger.type !== 'server' || r.trigger.port !== port) continue
      if (this.cooledDown(r.id)) this.offer(r)
    }
  }

  // --- Workspaces ---------------------------------------------------------------

  workspaces(): Workspace[] {
    return this.store.data.workspaces
  }

  saveWorkspace(w: Workspace): void {
    const clean: Workspace = {
      id: typeof w.id === 'string' && w.id ? w.id : randomUUID(),
      name: String(w.name ?? '').trim().slice(0, 80) || 'Workspace',
      urls: safeUrls(w.urls),
      createdAt: typeof w.createdAt === 'number' ? w.createdAt : Date.now()
    }
    const idx = this.store.data.workspaces.findIndex((x) => x.id === clean.id)
    if (idx >= 0) this.store.data.workspaces[idx] = clean
    else this.store.data.workspaces.push(clean)
    this.store.save()
  }

  deleteWorkspace(id: string): void {
    this.store.data.workspaces = this.store.data.workspaces.filter((w) => w.id !== id)
    this.store.save()
  }

  openWorkspace(id: string): void {
    const w = this.store.data.workspaces.find((x) => x.id === id)
    if (w && this.deps) this.deps.openTabs(w.urls)
  }

  /** Crea un workspace a partir de URLs ya abiertas (boton "usar pestañas"). */
  workspaceFromUrls(name: string, urls: string[]): Workspace | null {
    const clean = safeUrls(urls)
    if (clean.length === 0) return null
    const w: Workspace = {
      id: randomUUID(),
      name: String(name ?? '').trim().slice(0, 80) || 'Workspace',
      urls: clean,
      createdAt: Date.now()
    }
    this.store.data.workspaces.push(w)
    this.store.save()
    return w
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.onToast = null
    this.store.dispose()
  }
}
