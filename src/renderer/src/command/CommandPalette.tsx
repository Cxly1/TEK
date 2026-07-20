import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  hostKey,
  toNavigableUrl,
  type AutomationState,
  type DevServer,
  type HistoryEntry,
  type Suggestion
} from '@shared/ipc'
import { useTek } from '@/store'
import { useGoldSpotlight } from '@/lib/useGoldSpotlight'
import { devUtils } from '@/lib/devutils'
import './command.css'

interface Cmd {
  id: string
  label: string
  sub: string
  icon: string
  /** Favicon (data URL) para las filas que son un sitio; cae al glyph si falta. */
  favicon?: string | null
  run: () => void
}

interface Helpers {
  navigate: (url: string) => void
  setInput: (v: string) => void
  newTab: () => void
  home: () => void
  reload: () => void
  closeActive: () => void
  openBrain: () => void
  openHistory: () => void
  openDownloads: () => void
  openAutomation: () => void
  openPasswords: () => void
  /** Copia un valor (dev utils) y cierra. */
  copy: (v: string) => void
  /** Crea un watcher sobre la pestana activa. */
  watchActive: () => void
  /** Crea un workspace con las pestanas abiertas. */
  createWorkspace: (name: string) => void
  /** Cierra el palette sin tocar pestanas (acciones que corren en segundo plano). */
  closePaletteOnly: () => void
  hasActive: boolean
  /** URL de la pestana activa ('' si en blanco). */
  activeUrl: string
}

/**
 * Sub legible de una URL del historial: host + ruta, sin ruido (protocolo, www,
 * query). Con la ruta se distinguen varias paginas del mismo sitio cuyo titulo
 * es identico (Netflix titula "Netflix" todos sus /watch/...).
 */
function histSub(url: string): string {
  const s = url
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '')
  return s.length > 44 ? `${s.slice(0, 44)}…` : s
}

/** Cambiar de entorno conservando la ruta: localhost:A <-> localhost:B <-> prod. */
function envSwitchCmds(activeUrl: string, servers: DevServer[], h: Helpers): Cmd[] {
  if (!activeUrl || servers.length === 0) return []
  let u: URL
  try {
    u = new URL(activeUrl)
  } catch {
    return []
  }
  const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(u.hostname)
  const out: Cmd[] = []
  for (const s of servers) {
    if (isLocal && u.port === String(s.port)) continue
    out.push({
      id: `env:${s.port}`,
      label: `Abrir esta ruta en localhost:${s.port}`,
      icon: '⇄',
      sub: `${s.title || 'server local'} · ${u.pathname}`,
      run: () => h.navigate(`http://localhost:${s.port}${u.pathname}${u.search}`)
    })
  }
  return out.slice(0, 3)
}

function buildCommands(
  input: string,
  h: Helpers,
  suggestions: Suggestion[],
  auto: AutomationState | null,
  servers: DevServer[],
  histMatches: HistoryEntry[],
  pastQueries: string[]
): Cmd[] {
  const raw = input.trim()

  if (raw === '') {
    // Paleta = buscador puro. Vacia, solo mostramos tus sitios aprendidos para
    // esta franja (✦) y, si aplica, el cambio de entorno dev. Las herramientas
    // del navegador viven ahora en el menu ☰ de la barra.
    const cmds: Cmd[] = []
    for (const s of suggestions.slice(0, 6)) {
      cmds.push({
        id: `sug:${s.host}`,
        label: s.title || s.host.replace(/^www\./, ''),
        icon: '✦',
        favicon: s.favicon,
        sub: s.host.replace(/^www\./, ''),
        run: () => h.navigate(s.url)
      })
    }
    // Cambiar de entorno (si hay servers locales y una pagina abierta).
    cmds.push(...envSwitchCmds(h.activeUrl, servers, h))
    return cmds
  }

  const lower = raw.toLowerCase()
  const cmds: Cmd[] = []

  // Dev utils: si lo que escribiste es un JWT/timestamp/b64/color..., la
  // transformacion va ARRIBA (es claramente lo que buscas).
  for (const u of devUtils(raw).slice(0, 4)) {
    cmds.push({ id: `util:${u.id}`, label: u.label, icon: '⌗', sub: u.sub, run: () => h.copy(u.value) })
  }

  // "ws nombre" = crear workspace con las pestanas abiertas.
  const ws = /^ws\s+(.+)$/i.exec(raw)
  if (ws) {
    cmds.push({
      id: 'ws-create',
      label: `Crear workspace «${ws[1]}» con las pestañas abiertas`,
      icon: '▦',
      sub: 'workspace nuevo',
      run: () => h.createWorkspace(ws[1])
    })
  }

  // La intencion ESCRITA va primero y es el Enter por defecto: buscar o ir a lo
  // que dice el texto. Antes iban delante las coincidencias (sitios aprendidos)
  // y Enter abria "solo" una pagina vieja que casaba (p. ej. la ultima visita de
  // netflix.com al escribir "netflix") en vez de buscar lo escrito.
  const looksUrl = /^https?:\/\//i.test(raw) || (/\.[^\s]{2,}$/.test(raw) && !raw.includes(' '))
  cmds.push(
    looksUrl
      ? { id: 'go', label: `Ir a ${raw}`, icon: '↵', sub: 'abrir sitio', run: () => h.navigate(toNavigableUrl(raw)) }
      : { id: 'search', label: `Buscar "${raw}"`, icon: '⌕', sub: 'Google', run: () => h.navigate(toNavigableUrl(raw)) }
  )

  // Busquedas anteriores que casan (autocompletado del cerebro): repetir una
  // busqueda de un Enter. Se descartan la identica a lo escrito (la cubre la
  // fila de arriba) y las que son prefijo de otra de la lista — artefactos de
  // escribir incremental ("dolar a pes" sobra si existe "dolar a peso").
  const qs = pastQueries.filter(
    (t, i) =>
      t.toLowerCase() !== lower &&
      !pastQueries.some(
        (o, j) => j !== i && o.length > t.length && o.toLowerCase().startsWith(t.toLowerCase())
      )
  )
  for (const t of qs.slice(0, 2)) {
    cmds.push({
      id: `q:${t}`,
      label: `Volver a buscar «${t}»`,
      icon: '⌕',
      sub: 'búsqueda anterior',
      run: () => h.navigate(toNavigableUrl(t))
    })
  }

  // Tus sitios que casan con el texto (se eligen con ↓; nunca son el default).
  const matches = suggestions
    .filter((s) => s.host.toLowerCase().includes(lower) || s.title.toLowerCase().includes(lower))
    .slice(0, 3)
  for (const s of matches) {
    cmds.push({
      id: `sug:${s.host}`,
      label: s.title || s.host.replace(/^www\./, ''),
      icon: '✦',
      favicon: s.favicon,
      sub: s.host.replace(/^www\./, ''),
      run: () => h.navigate(s.url)
    })
  }

  // Paginas del historial que casan con lo escrito (ya vienen unicas por URL y
  // curadas del main); se descarta lo que ya listo un sitio ✦.
  const seen = new Set(matches.map((s) => s.url))
  let nHist = 0
  for (const e of histMatches) {
    if (nHist >= 4) break
    if (seen.has(e.url)) continue
    seen.add(e.url)
    cmds.push({
      id: `hist:${e.id}`,
      label: e.title || e.host,
      icon: '◷',
      favicon: e.favicon,
      sub: histSub(e.url),
      run: () => h.navigate(e.url)
    })
    nHist++
  }

  // Automatizacion que casa por nombre: workspaces, snippets, macros, recetas.
  if (auto) {
    for (const w of auto.workspaces.filter((x) => x.name.toLowerCase().includes(lower)).slice(0, 2)) {
      cmds.push({
        id: `ws:${w.id}`,
        label: w.name,
        icon: '▦',
        sub: `workspace · ${w.urls.length} pestañas`,
        run: () => {
          void window.tek.auto.openWorkspace(w.id)
          h.closePaletteOnly()
        }
      })
    }
    for (const s of auto.snippets.filter((x) => x.name.toLowerCase().includes(lower)).slice(0, 2)) {
      cmds.push({
        id: `sn:${s.id}`,
        label: s.name,
        icon: '⌁',
        sub: 'snippet · ejecutar en la pestaña activa',
        run: () => {
          void window.tek.auto.runSnippet(s.id)
          h.closePaletteOnly()
        }
      })
    }
    for (const m of auto.macros.filter((x) => x.name.toLowerCase().includes(lower)).slice(0, 2)) {
      cmds.push({
        id: `mc:${m.id}`,
        label: m.name,
        icon: '●',
        sub: `macro · ${m.steps.length} pasos`,
        run: () => {
          void window.tek.auto.runMacro(m.id)
          h.closePaletteOnly()
        }
      })
    }
    for (const r of auto.recipes.filter((x) => x.name.toLowerCase().includes(lower)).slice(0, 2)) {
      cmds.push({
        id: `rc:${r.id}`,
        label: r.name,
        icon: '⚡',
        sub: 'receta · ejecutar ahora',
        run: () => {
          void window.tek.auto.runRecipe(r.id)
          h.closePaletteOnly()
        }
      })
    }
  }

  if (!looksUrl) {
    cmds.push({
      id: 'yt',
      label: `Buscar "${raw}" en YouTube`,
      icon: '▶',
      sub: 'youtube.com',
      run: () => h.navigate(toNavigableUrl(`yt ${raw}`))
    })
    cmds.push({
      id: 'gh',
      label: `Buscar "${raw}" en GitHub`,
      icon: '◧',
      sub: 'github.com',
      run: () => h.navigate(toNavigableUrl(`gh ${raw}`))
    })
  }
  return cmds
}

function Row({
  cmd,
  active,
  onRun,
  onHover
}: {
  cmd: Cmd
  active: boolean
  onRun: () => void
  onHover: () => void
}): React.JSX.Element {
  const spot = useGoldSpotlight<HTMLButtonElement>()
  const [broken, setBroken] = useState(false)
  return (
    <button
      className={`cmd-row gold-spot ${active ? 'is-active' : ''}`}
      onClick={onRun}
      // La seleccion sigue al raton solo si el raton SE MUEVE de verdad. Con
      // pointerenter, un cursor parado sobre la lista "robaba" la seleccion
      // cuando las filas aparecian debajo al escribir (Chromium sintetiza el
      // enter al cambiar el layout) y Enter abria esa fila en vez de la 0.
      onPointerMove={(e) => {
        spot.onPointerMove(e)
        onHover()
      }}
      onPointerEnter={spot.onPointerEnter}
      onPointerLeave={spot.onPointerLeave}
    >
      <span className="cmd-icon">
        {cmd.favicon && !broken ? (
          <img className="cmd-favicon" src={cmd.favicon} alt="" onError={() => setBroken(true)} />
        ) : (
          cmd.icon
        )}
      </span>
      <span className="cmd-label">{cmd.label}</span>
      <span className="cmd-sub">{cmd.sub}</span>
    </button>
  )
}

export function CommandPalette(): React.JSX.Element {
  const [input, setInput] = useState(() => useTek.getState().seed)
  // -1 = nada preseleccionado (paleta sin texto): Enter no abre nada "solo".
  const [sel, setSel] = useState(() => (useTek.getState().seed.trim() ? 0 : -1))
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [auto, setAuto] = useState<AutomationState | null>(null)
  const [servers, setServers] = useState<DevServer[]>([])
  const [histMatches, setHistMatches] = useState<HistoryEntry[]>([])
  const [pastQ, setPastQ] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const activeRef = useRef<HTMLDivElement | null>(null)
  const setPhase = useTek((s) => s.setPhase)
  const closePalette = useTek((s) => s.closePalette)
  const openBrain = useTek((s) => s.openBrain)
  const openHistory = useTek((s) => s.openHistory)
  const openDownloads = useTek((s) => s.openDownloads)
  const openAutomation = useTek((s) => s.openAutomation)
  const openPasswords = useTek((s) => s.openPasswords)
  const activeId = useTek((s) => s.activeId)
  const activeTab = useTek((s) => s.tabs.find((t) => t.id === s.activeId))

  useEffect(() => {
    void window.tek.brain.suggestions(8).then(setSuggestions)
    void window.tek.auto.state().then(setAuto)
    void window.tek.dev.servers().then(setServers)
  }, [])

  // Historial + busquedas anteriores que casan con lo escrito, con un pequeno
  // debounce (como el panel de historial). El cleanup invalida las respuestas
  // que llegan tarde (el input ya cambio) para no pintar coincidencias viejas.
  useEffect(() => {
    const raw = input.trim()
    if (raw.length < 2) {
      setHistMatches([])
      setPastQ([])
      return
    }
    let alive = true
    const t = setTimeout(() => {
      void window.tek.brain
        .history({ query: raw, limit: 12, distinct: true })
        .then((rows) => alive && setHistMatches(rows))
      void window.tek.brain.pastQueries(raw).then((qs) => alive && setPastQ(qs))
    }, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [input])

  const helpers: Helpers = {
    navigate: (url) => {
      // Cerramos el overlay ANTES de navegar para que el main muestre la vista
      // como ULTIMO paso. Si navegamos primero, el main oculta la vista (con la
      // paleta aun "abierta") y luego la muestra: esa carrera ocultar→mostrar a
      // veces dejaba la pagina sin aparecer hasta un segundo Enter.
      setPhase('shell')
      closePalette()
      void window.tek.navigate(url)
    },
    setInput: (v) => {
      setInput(v)
      inputRef.current?.focus()
    },
    newTab: () => {
      // Abre la pestana nueva y cierra el palette para aterrizar en ella.
      void window.tek.tabs.create()
      closePalette()
    },
    home: () => {
      void window.tek.tabs.home()
      closePalette()
    },
    reload: () => {
      void window.tek.reload()
      closePalette()
    },
    closeActive: () => {
      if (activeId) void window.tek.tabs.close(activeId)
    },
    openBrain: () => {
      closePalette()
      openBrain()
    },
    openHistory: () => {
      closePalette()
      openHistory()
    },
    openDownloads: () => {
      closePalette()
      openDownloads()
    },
    openAutomation: () => {
      closePalette()
      openAutomation()
    },
    openPasswords: () => {
      closePalette()
      openPasswords()
    },
    copy: (v) => {
      void navigator.clipboard.writeText(v)
      closePalette()
    },
    watchActive: () => {
      if (!activeTab || activeTab.blank) return
      void window.tek.auto.saveWatcher({
        id: '',
        name: hostKey(activeTab.url) || activeTab.title || 'Página',
        url: activeTab.url,
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
      closePalette()
      openAutomation()
    },
    createWorkspace: (name) => {
      void window.tek.auto.workspaceFromTabs(name)
      closePalette()
    },
    closePaletteOnly: () => closePalette(),
    hasActive: !!activeTab && !activeTab.blank,
    activeUrl: activeTab && !activeTab.blank ? activeTab.url : ''
  }

  const cmds = useMemo(
    () => buildCommands(input, helpers, suggestions, auto, servers, histMatches, pastQ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, activeId, suggestions, auto, servers, histMatches, pastQ]
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    // Con texto, el default es la primera fila (la intencion escrita); sin
    // texto no se preselecciona nada (↓ entra a la lista).
    setSel(input.trim() ? 0 : -1)
  }, [input])
  // Mantener el item activo a la vista cuando la lista crece (scroll suave).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, cmds.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      // Sin texto se puede volver a "nada seleccionado" (-1); con texto el
      // suelo es la fila 0 (la intencion escrita).
      setSel((s) => Math.max(s - 1, input.trim() ? 0 : -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // Este Enter NO debe seguir hacia los listeners de window: React 18
      // ejecuta los efectos sincronamente en eventos discretos, asi que al
      // cerrar la paleta el listener del lienzo se re-engancha DURANTE este
      // mismo evento y lo recibiria (reabria la paleta / activaba un tile).
      e.stopPropagation()
      cmds[sel]?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closePalette()
    }
  }

  return (
    <div className="cmd-overlay" onMouseDown={closePalette}>
      <motion.div
        className="cmd-panel"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: -12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      >
        <div className="cmd-inputrow">
          <span className="cmd-prompt">⌘</span>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="buscar, ir a un sitio, o un comando…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="cmd-list">
          {cmds.map((cmd, i) => (
            <motion.div
              key={cmd.id}
              ref={i === sel ? activeRef : undefined}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02, duration: 0.18 }}
            >
              <Row cmd={cmd} active={i === sel} onRun={cmd.run} onHover={() => setSel(i)} />
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
