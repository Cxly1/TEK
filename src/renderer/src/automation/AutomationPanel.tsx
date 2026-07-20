import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type {
  AutomationState,
  BridgeStatus,
  DevSettings,
  Macro,
  Recipe,
  RecipeAction,
  RecipeTrigger,
  SitePermission,
  SiteScript,
  Snippet,
  SnippetResult,
  Watcher
} from '@shared/ipc'
import { useTek, useActiveTab } from '@/store'
import { useArrowNav } from '@/lib/useArrowNav'
import '../brain/brain.css'
import './automation.css'

type Section = 'recetas' | 'workspaces' | 'snippets' | 'sitios' | 'watchers' | 'macros' | 'ajustes'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'recetas', label: '⚡ Recetas' },
  { id: 'workspaces', label: '▦ Workspaces' },
  { id: 'snippets', label: '⌁ Snippets' },
  { id: 'sitios', label: '✚ Sitios' },
  { id: 'watchers', label: '👁 Watchers' },
  { id: 'macros', label: '● Macros' },
  { id: 'ajustes', label: '⚙ Ajustes' }
]

/** Etiqueta legible del disparador de una receta. */
function triggerLabel(t: RecipeTrigger): string {
  if (t.type === 'startup') return 'al arrancar TEK'
  if (t.type === 'time') return `a las ${t.at}`
  if (t.type === 'visit') return `al visitar ${t.host}`
  if (t.type === 'server') return `server en :${t.port}`
  return 'manual'
}

// --- Recetas -------------------------------------------------------------------

interface RecipeDraft {
  id: string | null
  name: string
  enabled: boolean
  trigger: RecipeTrigger['type']
  at: string
  host: string
  port: string
  urls: string
  workspaceId: string
  snippetId: string
  macroId: string
  devtools: boolean
  notify: boolean
}

const EMPTY_RECIPE: RecipeDraft = {
  id: null,
  name: '',
  enabled: true,
  trigger: 'manual',
  at: '09:00',
  host: '',
  port: '5173',
  urls: '',
  workspaceId: '',
  snippetId: '',
  macroId: '',
  devtools: false,
  notify: false
}

function recipeToDraft(r: Recipe): RecipeDraft {
  const d: RecipeDraft = { ...EMPTY_RECIPE, id: r.id, name: r.name, enabled: r.enabled, trigger: r.trigger.type }
  if (r.trigger.type === 'time') d.at = r.trigger.at
  if (r.trigger.type === 'visit') d.host = r.trigger.host
  if (r.trigger.type === 'server') d.port = String(r.trigger.port)
  for (const a of r.actions) {
    if (a.type === 'openTabs') d.urls = a.urls.join('\n')
    else if (a.type === 'openWorkspace') d.workspaceId = a.workspaceId
    else if (a.type === 'runSnippet') d.snippetId = a.snippetId
    else if (a.type === 'runMacro') d.macroId = a.macroId
    else if (a.type === 'openDevtools') d.devtools = true
    else if (a.type === 'notify') d.notify = true
  }
  return d
}

function draftToRecipe(d: RecipeDraft): Recipe {
  let trigger: RecipeTrigger = { type: 'manual' }
  if (d.trigger === 'startup') trigger = { type: 'startup' }
  else if (d.trigger === 'time') trigger = { type: 'time', at: d.at || '09:00' }
  else if (d.trigger === 'visit') trigger = { type: 'visit', host: d.host.trim() }
  else if (d.trigger === 'server') trigger = { type: 'server', port: Number(d.port) || 5173 }
  const actions: RecipeAction[] = []
  if (d.workspaceId) actions.push({ type: 'openWorkspace', workspaceId: d.workspaceId })
  const urls = d.urls.split('\n').map((u) => u.trim()).filter(Boolean)
  if (urls.length > 0) actions.push({ type: 'openTabs', urls })
  if (d.snippetId) actions.push({ type: 'runSnippet', snippetId: d.snippetId })
  if (d.macroId) actions.push({ type: 'runMacro', macroId: d.macroId })
  if (d.devtools) actions.push({ type: 'openDevtools' })
  if (d.notify) actions.push({ type: 'notify', title: `⚡ ${d.name || 'Receta'}`, body: 'Receta ejecutada' })
  return {
    id: d.id ?? '',
    name: d.name,
    enabled: d.enabled,
    trigger,
    actions,
    createdAt: Date.now(),
    lastRunAt: null
  }
}

function RecipesSec({ st, refresh }: { st: AutomationState; refresh: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState<RecipeDraft | null>(null)
  const set = (patch: Partial<RecipeDraft>): void => setDraft((d) => (d ? { ...d, ...patch } : d))

  const save = async (): Promise<void> => {
    if (!draft) return
    await window.tek.auto.saveRecipe(draftToRecipe(draft))
    setDraft(null)
    refresh()
  }
  const del = async (id: string): Promise<void> => {
    if (!confirm('¿Borrar esta receta?')) return
    await window.tek.auto.deleteRecipe(id)
    refresh()
  }
  const run = async (id: string): Promise<void> => {
    await window.tek.auto.runRecipe(id)
    refresh()
  }

  return (
    <section className="brain-sec">
      <h2>Recetas (disparador → acciones)</h2>
      {st.recipes.length === 0 && !draft && (
        <p className="brain-empty">Crea tu primera receta: «al arrancar, abre mi proyecto».</p>
      )}
      <ul className="brain-list">
        {st.recipes.map((r) => (
          <li key={r.id}>
            <span className="brain-eq">⚡</span>
            <span className="brain-host" title={r.name}>
              {r.name}
              <span style={{ color: 'var(--text-lo)' }}> · {triggerLabel(r.trigger)}</span>
            </span>
            {!r.enabled && <span className="auto-meta">off</span>}
            <button className="brain-forget is-shown" onClick={() => void run(r.id)}>
              ejecutar
            </button>
            <button className="brain-forget is-shown" onClick={() => setDraft(recipeToDraft(r))}>
              editar
            </button>
            <button className="brain-forget" onClick={() => void del(r.id)}>
              borrar
            </button>
          </li>
        ))}
      </ul>

      {draft ? (
        <div className="auto-form">
          <div className="auto-grid2">
            <label className="auto-field">
              <span>Nombre</span>
              <input
                className="auto-input"
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Mi proyecto por la mañana"
              />
            </label>
            <label className="auto-field">
              <span>Disparador</span>
              <select
                className="auto-select"
                value={draft.trigger}
                onChange={(e) => set({ trigger: e.target.value as RecipeDraft['trigger'] })}
              >
                <option value="manual">Manual (⌘K / panel)</option>
                <option value="startup">Al arrancar TEK</option>
                <option value="time">A una hora</option>
                <option value="visit">Al visitar un sitio</option>
                <option value="server">Al detectar server local</option>
              </select>
            </label>
          </div>
          {draft.trigger === 'time' && (
            <label className="auto-field">
              <span>Hora</span>
              <input className="auto-input" type="time" value={draft.at} onChange={(e) => set({ at: e.target.value })} />
            </label>
          )}
          {draft.trigger === 'visit' && (
            <label className="auto-field">
              <span>Host (ej. github.com)</span>
              <input className="auto-input" value={draft.host} onChange={(e) => set({ host: e.target.value })} />
            </label>
          )}
          {draft.trigger === 'server' && (
            <label className="auto-field">
              <span>Puerto</span>
              <input className="auto-input" type="number" value={draft.port} onChange={(e) => set({ port: e.target.value })} />
            </label>
          )}
          <label className="auto-field">
            <span>Abrir pestañas (una URL por línea)</span>
            <textarea
              className="auto-textarea"
              value={draft.urls}
              onChange={(e) => set({ urls: e.target.value })}
              placeholder={'http://localhost:5173\nhttps://github.com/mi/repo'}
            />
          </label>
          <div className="auto-grid2">
            <label className="auto-field">
              <span>Abrir workspace</span>
              <select className="auto-select" value={draft.workspaceId} onChange={(e) => set({ workspaceId: e.target.value })}>
                <option value="">—</option>
                {st.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="auto-field">
              <span>Ejecutar snippet</span>
              <select className="auto-select" value={draft.snippetId} onChange={(e) => set({ snippetId: e.target.value })}>
                <option value="">—</option>
                {st.snippets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="auto-grid2">
            <label className="auto-field">
              <span>Ejecutar macro</span>
              <select className="auto-select" value={draft.macroId} onChange={(e) => set({ macroId: e.target.value })}>
                <option value="">—</option>
                {st.macros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="auto-field">
              <span>Extras</span>
              <label className="auto-check">
                <input type="checkbox" checked={draft.devtools} onChange={(e) => set({ devtools: e.target.checked })} />
                abrir DevTools
              </label>
              <label className="auto-check">
                <input type="checkbox" checked={draft.notify} onChange={(e) => set({ notify: e.target.checked })} />
                notificar al ejecutar
              </label>
              <label className="auto-check">
                <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
                receta activa
              </label>
            </div>
          </div>
          <div className="auto-row-btns">
            <button className="auto-btn" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button className="auto-btn-gold" onClick={() => void save()}>
              Guardar receta
            </button>
          </div>
        </div>
      ) : (
        <button className="auto-add" onClick={() => setDraft({ ...EMPTY_RECIPE })}>
          + Nueva receta
        </button>
      )}
    </section>
  )
}

// --- Workspaces ------------------------------------------------------------------

function WorkspacesSec({ st, refresh }: { st: AutomationState; refresh: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState<{ id: string | null; name: string; urls: string } | null>(null)

  const save = async (): Promise<void> => {
    if (!draft) return
    await window.tek.auto.saveWorkspace({
      id: draft.id ?? '',
      name: draft.name,
      urls: draft.urls.split('\n').map((u) => u.trim()).filter(Boolean),
      createdAt: Date.now()
    })
    setDraft(null)
    refresh()
  }
  const fromTabs = async (): Promise<void> => {
    const w = await window.tek.auto.workspaceFromTabs(draft?.name || 'Workspace')
    if (!w) {
      alert('No hay pestañas con página abierta ahora mismo.')
      return
    }
    setDraft(null)
    refresh()
  }
  const del = async (id: string): Promise<void> => {
    if (!confirm('¿Borrar este workspace?')) return
    await window.tek.auto.deleteWorkspace(id)
    refresh()
  }

  return (
    <section className="brain-sec">
      <h2>Workspaces (abre tu proyecto de un golpe)</h2>
      {st.workspaces.length === 0 && !draft && (
        <p className="brain-empty">Un workspace = tus pestañas de un proyecto, listas con un clic.</p>
      )}
      <ul className="brain-list">
        {st.workspaces.map((w) => (
          <li key={w.id}>
            <span className="brain-eq">▦</span>
            <span className="brain-host">
              {w.name}
              <span style={{ color: 'var(--text-lo)' }}> · {w.urls.length} pestaña{w.urls.length === 1 ? '' : 's'}</span>
            </span>
            <button className="brain-forget is-shown" onClick={() => void window.tek.auto.openWorkspace(w.id)}>
              abrir
            </button>
            <button
              className="brain-forget is-shown"
              onClick={() => setDraft({ id: w.id, name: w.name, urls: w.urls.join('\n') })}
            >
              editar
            </button>
            <button className="brain-forget" onClick={() => void del(w.id)}>
              borrar
            </button>
          </li>
        ))}
      </ul>
      {draft ? (
        <div className="auto-form">
          <label className="auto-field">
            <span>Nombre</span>
            <input className="auto-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="auto-field">
            <span>URLs (una por línea)</span>
            <textarea
              className="auto-textarea"
              value={draft.urls}
              onChange={(e) => setDraft({ ...draft, urls: e.target.value })}
              placeholder={'http://localhost:5173\nhttps://github.com/mi/repo\nhttps://vercel.com/dashboard'}
            />
          </label>
          <div className="auto-row-btns">
            <button className="auto-btn" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            {!draft.id && (
              <button className="auto-btn" onClick={() => void fromTabs()}>
                Usar pestañas abiertas
              </button>
            )}
            <button className="auto-btn-gold" onClick={() => void save()}>
              Guardar
            </button>
          </div>
        </div>
      ) : (
        <button className="auto-add" onClick={() => setDraft({ id: null, name: '', urls: '' })}>
          + Nuevo workspace
        </button>
      )}
    </section>
  )
}

// --- Snippets ---------------------------------------------------------------------

function SnippetsSec({ st, refresh }: { st: AutomationState; refresh: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState<{ id: string | null; name: string; code: string } | null>(null)
  const [result, setResult] = useState<{ id: string; r: SnippetResult } | null>(null)

  const save = async (): Promise<void> => {
    if (!draft) return
    await window.tek.auto.saveSnippet({ id: draft.id ?? '', name: draft.name, code: draft.code, createdAt: Date.now() })
    setDraft(null)
    refresh()
  }
  const run = async (id: string): Promise<void> => {
    const r = await window.tek.auto.runSnippet(id)
    setResult({ id, r })
  }
  const del = async (id: string): Promise<void> => {
    if (!confirm('¿Borrar este snippet?')) return
    await window.tek.auto.deleteSnippet(id)
    refresh()
  }

  return (
    <section className="brain-sec">
      <h2>Snippets (JS sobre la pestaña activa)</h2>
      {st.snippets.length === 0 && !draft && (
        <p className="brain-empty">Guarda tus one-liners de consola y lánzalos desde el ⌘K.</p>
      )}
      <ul className="brain-list">
        {st.snippets.map((s) => (
          <li key={s.id}>
            <span className="brain-eq">⌁</span>
            <span className="brain-host">{s.name}</span>
            <button className="brain-forget is-shown" onClick={() => void run(s.id)}>
              ejecutar
            </button>
            <button className="brain-forget is-shown" onClick={() => setDraft({ id: s.id, name: s.name, code: s.code })}>
              editar
            </button>
            <button className="brain-forget" onClick={() => void del(s.id)}>
              borrar
            </button>
          </li>
        ))}
      </ul>
      {result && (
        <div className={`auto-result ${result.r.ok ? '' : 'is-error'}`}>
          {st.snippets.find((s) => s.id === result.id)?.name}: {result.r.value}
        </div>
      )}
      {draft ? (
        <div className="auto-form">
          <label className="auto-field">
            <span>Nombre</span>
            <input className="auto-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="auto-field">
            <span>Código (expresión o cuerpo con return)</span>
            <textarea
              className="auto-textarea"
              value={draft.code}
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              placeholder="document.title"
              spellCheck={false}
            />
          </label>
          <div className="auto-row-btns">
            <button className="auto-btn" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button className="auto-btn-gold" onClick={() => void save()}>
              Guardar
            </button>
          </div>
        </div>
      ) : (
        <button className="auto-add" onClick={() => setDraft({ id: null, name: '', code: '' })}>
          + Nuevo snippet
        </button>
      )}
    </section>
  )
}

// --- Scripts por sitio ----------------------------------------------------------------

function SitesSec({ st, refresh }: { st: AutomationState; refresh: () => void }): React.JSX.Element {
  const [draft, setDraft] = useState<SiteScript | null>(null)

  const save = async (): Promise<void> => {
    if (!draft) return
    await window.tek.auto.saveSiteScript(draft)
    setDraft(null)
    refresh()
  }
  const toggle = async (s: SiteScript): Promise<void> => {
    await window.tek.auto.saveSiteScript({ ...s, enabled: !s.enabled })
    refresh()
  }
  const del = async (id: string): Promise<void> => {
    if (!confirm('¿Borrar este script de sitio?')) return
    await window.tek.auto.deleteSiteScript(id)
    refresh()
  }

  return (
    <section className="brain-sec">
      <h2>Scripts por sitio (JS/CSS que se inyecta solo)</h2>
      {st.siteScripts.length === 0 && !draft && (
        <p className="brain-empty">Tu Tampermonkey-lite: arregla o tunea cualquier sitio en cada carga.</p>
      )}
      <ul className="brain-list">
        {st.siteScripts.map((s) => (
          <li key={s.id}>
            <span className="brain-eq">✚</span>
            <span className="brain-host">
              {s.name}
              <span style={{ color: 'var(--text-lo)' }}> · {s.host}</span>
            </span>
            <button className="brain-forget is-shown" onClick={() => void toggle(s)}>
              {s.enabled ? 'on' : 'off'}
            </button>
            <button className="brain-forget is-shown" onClick={() => setDraft({ ...s })}>
              editar
            </button>
            <button className="brain-forget" onClick={() => void del(s.id)}>
              borrar
            </button>
          </li>
        ))}
      </ul>
      {draft ? (
        <div className="auto-form">
          <div className="auto-grid2">
            <label className="auto-field">
              <span>Nombre</span>
              <input className="auto-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="auto-field">
              <span>Host (ej. github.com)</span>
              <input className="auto-input" value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} />
            </label>
          </div>
          <label className="auto-field">
            <span>JS (en cada carga del sitio)</span>
            <textarea
              className="auto-textarea"
              value={draft.js}
              onChange={(e) => setDraft({ ...draft, js: e.target.value })}
              spellCheck={false}
            />
          </label>
          <label className="auto-field">
            <span>CSS</span>
            <textarea
              className="auto-textarea"
              value={draft.css}
              onChange={(e) => setDraft({ ...draft, css: e.target.value })}
              spellCheck={false}
            />
          </label>
          <div className="auto-row-btns">
            <button className="auto-btn" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button className="auto-btn-gold" onClick={() => void save()}>
              Guardar
            </button>
          </div>
        </div>
      ) : (
        <button
          className="auto-add"
          onClick={() =>
            setDraft({ id: '', name: '', host: '', enabled: true, js: '', css: '', createdAt: Date.now() })
          }
        >
          + Nuevo script de sitio
        </button>
      )}
    </section>
  )
}

// --- Watchers -----------------------------------------------------------------------

function WatchersSec({ st, refresh }: { st: AutomationState; refresh: () => void }): React.JSX.Element {
  const active = useActiveTab()
  const [draft, setDraft] = useState<Watcher | null>(null)

  const blank = (): Watcher => ({
    id: '',
    name: '',
    url: active && !active.blank ? active.url : '',
    mode: 'change',
    pattern: '',
    intervalMin: 5,
    enabled: true,
    lastCheckedAt: null,
    lastChangedAt: null,
    lastStatus: null,
    lastHash: null,
    note: ''
  })

  const save = async (): Promise<void> => {
    if (!draft) return
    await window.tek.auto.saveWatcher(draft)
    setDraft(null)
    refresh()
  }
  const check = async (id: string): Promise<void> => {
    await window.tek.auto.checkWatcher(id)
    refresh()
  }
  const toggle = async (w: Watcher): Promise<void> => {
    await window.tek.auto.saveWatcher({ ...w, enabled: !w.enabled })
    refresh()
  }
  const del = async (id: string): Promise<void> => {
    if (!confirm('¿Borrar este watcher?')) return
    await window.tek.auto.deleteWatcher(id)
    refresh()
  }

  return (
    <section className="brain-sec">
      <h2>Watchers (TEK vigila, tú sigues a lo tuyo)</h2>
      {st.watchers.length === 0 && !draft && (
        <p className="brain-empty">CI, deploys, releases: notificación nativa cuando algo cambie.</p>
      )}
      <ul className="brain-list">
        {st.watchers.map((w) => (
          <li key={w.id}>
            <span className="brain-eq">👁</span>
            <span className="brain-host" title={w.url}>
              {w.name}
              <span style={{ color: 'var(--text-lo)' }}> · {w.note || 'sin comprobar'}</span>
            </span>
            <span className="auto-meta">{w.intervalMin}m</span>
            <button className="brain-forget is-shown" onClick={() => void toggle(w)}>
              {w.enabled ? 'on' : 'off'}
            </button>
            <button className="brain-forget is-shown" onClick={() => void check(w.id)}>
              comprobar
            </button>
            <button className="brain-forget is-shown" onClick={() => setDraft({ ...w })}>
              editar
            </button>
            <button className="brain-forget" onClick={() => void del(w.id)}>
              borrar
            </button>
          </li>
        ))}
      </ul>
      {draft ? (
        <div className="auto-form">
          <div className="auto-grid2">
            <label className="auto-field">
              <span>Nombre</span>
              <input className="auto-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="auto-field">
              <span>Cada (minutos)</span>
              <input
                className="auto-input"
                type="number"
                min={1}
                value={draft.intervalMin}
                onChange={(e) => setDraft({ ...draft, intervalMin: Number(e.target.value) || 5 })}
              />
            </label>
          </div>
          <label className="auto-field">
            <span>URL</span>
            <input
              className="auto-input"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="https://github.com/mi/repo/releases"
            />
          </label>
          <div className="auto-grid2">
            <label className="auto-field">
              <span>Avisar cuando</span>
              <select
                className="auto-select"
                value={draft.mode}
                onChange={(e) => setDraft({ ...draft, mode: e.target.value as Watcher['mode'] })}
              >
                <option value="change">el contenido cambie</option>
                <option value="contains">aparezca un texto</option>
                <option value="status">cambie el status HTTP</option>
              </select>
            </label>
            {draft.mode === 'contains' && (
              <label className="auto-field">
                <span>Texto a esperar</span>
                <input
                  className="auto-input"
                  value={draft.pattern}
                  onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
                />
              </label>
            )}
          </div>
          <div className="auto-row-btns">
            <button className="auto-btn" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            <button className="auto-btn-gold" onClick={() => void save()}>
              Guardar
            </button>
          </div>
        </div>
      ) : (
        <button className="auto-add" onClick={() => setDraft(blank())}>
          + Nuevo watcher{active && !active.blank ? ' (con la página actual)' : ''}
        </button>
      )}
    </section>
  )
}

// --- Macros ------------------------------------------------------------------------

function MacrosSec({ st, refresh }: { st: AutomationState; refresh: () => void }): React.JSX.Element {
  const closeAutomation = useTek((s) => s.closeAutomation)
  const [name, setName] = useState('')

  const start = async (): Promise<void> => {
    const ok = await window.tek.auto.recordStart()
    if (!ok) {
      alert('Abre primero la página donde quieres grabar (pestaña activa con web).')
      return
    }
    refresh()
    // Cierra el panel para que puedas interactuar con la página; el indicador
    // REC de la barra te trae de vuelta aquí para parar.
    closeAutomation()
  }
  const stop = async (save: boolean): Promise<void> => {
    await window.tek.auto.recordStop(save ? name || `Macro ${new Date().toLocaleTimeString().slice(0, 5)}` : null)
    setName('')
    refresh()
  }
  const run = async (id: string): Promise<void> => {
    closeAutomation()
    await window.tek.auto.runMacro(id)
  }
  const del = async (id: string): Promise<void> => {
    if (!confirm('¿Borrar esta macro?')) return
    await window.tek.auto.deleteMacro(id)
    refresh()
  }

  return (
    <section className="brain-sec">
      <h2>Macros (graba un flujo, repítelo con un clic)</h2>
      <p className="brain-note">
        Se graban clics, texto y Enter con selectores robustos. Los campos de contraseña
        <strong> jamás</strong> se graban.
      </p>
      {st.recording ? (
        <div className="auto-form">
          <label className="auto-field">
            <span>● Grabando… nombre de la macro</span>
            <input
              className="auto-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Login al panel interno"
              autoFocus
            />
          </label>
          <div className="auto-row-btns">
            <button className="auto-btn" onClick={() => void stop(false)}>
              Descartar
            </button>
            <button className="auto-btn-gold" onClick={() => void stop(true)}>
              Detener y guardar
            </button>
          </div>
        </div>
      ) : (
        <button className="auto-add" onClick={() => void start()}>
          ● Grabar macro en la pestaña activa
        </button>
      )}
      <ul className="brain-list" style={{ marginTop: 10 }}>
        {st.macros.map((m: Macro) => (
          <li key={m.id}>
            <span className="brain-eq">●</span>
            <span className="brain-host" title={m.startUrl}>
              {m.name}
              <span style={{ color: 'var(--text-lo)' }}> · {m.steps.length} paso{m.steps.length === 1 ? '' : 's'}</span>
            </span>
            <button className="brain-forget is-shown" onClick={() => void run(m.id)}>
              reproducir
            </button>
            <button className="brain-forget" onClick={() => void del(m.id)}>
              borrar
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// --- Ajustes (dev + puente + permisos) --------------------------------------------------

/** Texto humano de un permiso recordado (espejo del label del main). */
const PERM_LABEL: Record<string, string> = {
  media: 'cámara/micrófono',
  'display-capture': 'compartir pantalla',
  geolocation: 'ubicación',
  notifications: 'notificaciones',
  'clipboard-read': 'leer portapapeles',
  midi: 'MIDI',
  midiSysex: 'MIDI (sysex)',
  openExternal: 'abrir apps externas',
  fileSystem: 'acceso a archivos',
  'idle-detection': 'detección de inactividad'
}

function SettingsSec(): React.JSX.Element {
  const [settings, setSettings] = useState<DevSettings | null>(null)
  const [bridge, setBridge] = useState<BridgeStatus | null>(null)
  const [perms, setPerms] = useState<SitePermission[]>([])
  const [copied, setCopied] = useState(false)

  const refresh = (): void => {
    void window.tek.dev.settings().then(setSettings)
    void window.tek.bridge.status().then(setBridge)
    void window.tek.perms.list().then(setPerms)
  }
  useEffect(refresh, [])

  const revoke = async (p: SitePermission): Promise<void> => {
    await window.tek.perms.revoke(p.host, p.permission)
    refresh()
  }

  const toggleDevtools = async (): Promise<void> => {
    if (!settings) return
    setSettings(await window.tek.dev.setSettings({ autoDevtoolsLocalhost: !settings.autoDevtoolsLocalhost }))
  }
  const toggleBridge = async (): Promise<void> => {
    if (!bridge) return
    const next = await window.tek.bridge.setEnabled(!bridge.enabled)
    if (next) setBridge(next)
    refresh()
  }
  const copyExample = async (): Promise<void> => {
    if (!bridge) return
    await navigator.clipboard.writeText(
      `curl -H "Authorization: Bearer ${bridge.token}" http://127.0.0.1:${bridge.port || 4923}/tabs`
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <section className="brain-sec">
        <div className="brain-sec-head">
          <h2>DevTools automático en localhost</h2>
          <button
            className={`brain-toggle ${settings?.autoDevtoolsLocalhost ? 'is-on' : 'is-off'}`}
            onClick={() => void toggleDevtools()}
          >
            {settings?.autoDevtoolsLocalhost ? 'Activo' : 'Apagado'}
          </button>
        </div>
        <p className="brain-note">Al navegar a localhost, TEK abre las DevTools solas (ventana aparte).</p>
      </section>

      <section className="brain-sec">
        <div className="brain-sec-head">
          <h2>Puente para agentes</h2>
          <button
            className={`brain-toggle ${bridge?.enabled ? 'is-on' : 'is-off'}`}
            onClick={() => void toggleBridge()}
          >
            {bridge?.enabled ? (bridge.running ? `:${bridge.port}` : 'Activo') : 'Apagado'}
          </button>
        </div>
        <p className="brain-note">
          HTTP local (solo 127.0.0.1, con token) para que Claude Code maneje TEK: pestañas,
          navegar, ejecutar JS, screenshot y texto de la página. Apagado por defecto.
        </p>
        {bridge?.enabled && bridge.running && (
          <div className="auto-token" style={{ marginTop: 10 }}>
            <code title={bridge.token}>{bridge.token}</code>
            <button className="auto-btn" onClick={() => void copyExample()}>
              {copied ? '¡copiado!' : 'copiar ejemplo curl'}
            </button>
          </div>
        )}
      </section>

      <section className="brain-sec">
        <h2>Permisos de sitios</h2>
        <p className="brain-note">
          Cuando un sitio pide cámara, micrófono, ubicación o notificaciones, TEK pregunta y
          recuerda tu decisión. Aquí puedes deshacerla (volverá a preguntar).
        </p>
        {perms.length === 0 ? (
          <p className="brain-empty">Ningún sitio ha pedido permisos todavía.</p>
        ) : (
          <ul className="brain-list">
            {perms.map((p) => (
              <li key={`${p.host}|${p.permission}`}>
                <span className="brain-eq">{p.allowed ? '✓' : '✕'}</span>
                <span className="brain-host">
                  {p.host}
                  <span style={{ color: 'var(--text-lo)' }}>
                    {' '}
                    · {PERM_LABEL[p.permission] ?? p.permission} ·{' '}
                    {p.allowed ? 'permitido' : 'bloqueado'}
                  </span>
                </span>
                <button className="brain-forget is-shown" onClick={() => void revoke(p)}>
                  quitar
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

// --- Panel ------------------------------------------------------------------------

export function AutomationPanel(): React.JSX.Element {
  const closeAutomation = useTek((s) => s.closeAutomation)
  const recording = useTek((s) => s.recording)
  const [st, setSt] = useState<AutomationState | null>(null)
  // El menu lateral de secciones se recorre con flechas; el contenido de cada
  // seccion con Tab (todos sus controles muestran foco dorado via :focus-visible).
  const tabsRef = useRef<HTMLElement | null>(null)
  const nav = useArrowNav({
    rowLengths: SECTIONS.map(() => 1),
    initial: recording ? SECTIONS.findIndex((s) => s.id === 'macros') : 0
  })
  const sec: Section = SECTIONS[nav.index]?.id ?? 'recetas'

  const refresh = (): void => {
    void window.tek.auto.state().then(setSt)
  }
  useEffect(refresh, [])
  useEffect(() => {
    tabsRef.current?.focus()
  }, [])

  return (
    <div className="brain-overlay" onMouseDown={closeAutomation}>
      <motion.div
        className="brain-panel auto-wide"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <header className="brain-head">
          <div>
            <h1 className="brain-title">⚡ Automatización</h1>
            <p className="brain-sub">
              {st
                ? `${st.recipes.length} recetas · ${st.workspaces.length} workspaces · ${st.watchers.length} watchers`
                : 'cargando…'}
            </p>
          </div>
          <button className="brain-x" onClick={closeAutomation} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <nav className="auto-tabs" tabIndex={-1} ref={tabsRef} onKeyDown={nav.onKeyDown}>
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              className={`auto-tab ${sec === s.id ? 'is-active' : ''}`}
              onClick={() => nav.setIndex(i)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="brain-body">
          {st && sec === 'recetas' && <RecipesSec st={st} refresh={refresh} />}
          {st && sec === 'workspaces' && <WorkspacesSec st={st} refresh={refresh} />}
          {st && sec === 'snippets' && <SnippetsSec st={st} refresh={refresh} />}
          {st && sec === 'sitios' && <SitesSec st={st} refresh={refresh} />}
          {st && sec === 'watchers' && <WatchersSec st={st} refresh={refresh} />}
          {st && sec === 'macros' && <MacrosSec st={st} refresh={refresh} />}
          {sec === 'ajustes' && <SettingsSec />}
        </div>
      </motion.div>
    </div>
  )
}
