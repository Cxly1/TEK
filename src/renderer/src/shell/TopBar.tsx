import { useState, type CSSProperties } from 'react'
import { useTek, useActiveTab } from '@/store'
import { hostKey, prettyHost, type TabMeta } from '@shared/ipc'
import { groupColor } from '@/lib/groupColor'
import { AdblockShield } from '@/adblock/AdblockShield'
import '../automation/automation.css'

/** Agrupa pestanas contiguas del mismo dominio (ya vienen ordenadas del main). */
function toRuns(tabs: TabMeta[]): { group: string; tabs: TabMeta[] }[] {
  const runs: { group: string; tabs: TabMeta[] }[] = []
  for (const t of tabs) {
    const last = runs[runs.length - 1]
    if (last && last.group !== '' && last.group === t.group) last.tabs.push(t)
    else runs.push({ group: t.group, tabs: [t] })
  }
  return runs
}

/**
 * Boton de audio por pestana (inspirado en los toggles de skiper-ui / 21st.dev):
 * un altavoz con ondas que laten cuando suena, y tachado cuando esta silenciado.
 * SVG propio para que herede el color del tema sin dependencias externas.
 */
function MuteButton({ tab }: { tab: TabMeta }): React.JSX.Element {
  const muted = tab.muted
  return (
    <span
      className={`tab-mute ${muted ? 'is-muted' : 'is-audible'}`}
      role="button"
      aria-label={muted ? 'Reactivar audio' : 'Silenciar pestaña'}
      title={muted ? 'Reactivar audio' : 'Silenciar pestaña'}
      onClick={(e) => {
        e.stopPropagation()
        void window.tek.tabs.setMuted(tab.id, !muted)
      }}
    >
      <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden>
        {/* cuerpo del altavoz */}
        <path
          d="M4 9v6h3.5L13 19.5V4.5L7.5 9H4z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {muted ? (
          /* tachado */
          <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        ) : (
          /* ondas (animadas por CSS) */
          <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path className="wave wave-1" d="M16.2 9.2a4 4 0 010 5.6" />
            <path className="wave wave-2" d="M18.6 7a7.2 7.2 0 010 10" />
          </g>
        )}
      </svg>
    </span>
  )
}

/** Manda la pestana activa al mini-player (Picture-in-Picture). */
function PipButton(): React.JSX.Element {
  return (
    <button
      className="tb-tool no-drag"
      title="Ver en mini-player (Ctrl+Shift+P)"
      onClick={() => void window.tek.pip.enter()}
    >
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
        <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <rect x="11.5" y="11" width="7.5" height="6" rx="1.2" fill="currentColor" />
      </svg>
    </button>
  )
}

/** Menu unico de herramientas (☰): historial, descargas, contrasenas,
 *  automatizacion y perfil. El badge refleja descargas activas o completadas
 *  sin ver (se limpia al abrir el panel de descargas). */
function ToolsButton(): React.JSX.Element {
  const openToolsMenu = useTek((s) => s.openToolsMenu)
  const activeDl = useTek((s) => s.downloads.filter((d) => d.state === 'progressing').length)
  const unseenDone = useTek((s) =>
    s.downloads.filter(
      (d) => d.state === 'completed' && d.finishedAt != null && d.finishedAt > s.downloadsSeenAt
    ).length
  )
  const badge = activeDl || unseenDone
  return (
    <button
      className={`tb-tool no-drag ${activeDl ? 'is-busy' : ''}`}
      data-tour="tools"
      title="Herramientas (historial, descargas, contraseñas, automatización…)"
      onClick={openToolsMenu}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
        <path
          d="M4 7h16M4 12h16M4 17h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      {badge > 0 && <span className="tb-tool-badge">{badge}</span>}
    </button>
  )
}

export function TopBar(): React.JSX.Element {
  const tabs = useTek((s) => s.tabs)
  const activeId = useTek((s) => s.activeId)
  const collapsed = useTek((s) => s.collapsedGroups)
  const toggleGroup = useTek((s) => s.toggleGroup)
  const openPalette = useTek((s) => s.openPalette)
  const openAutomation = useTek((s) => s.openAutomation)
  const recording = useTek((s) => s.recording)
  const active = useActiveTab()
  const host = active && !active.blank ? hostKey(active.url) : ''
  // En la nueva pestana la barra de direccion de arriba sobra (la del centro es
  // la protagonista): ocultamos toda la fila de navegacion. Reaparece al abrir
  // una web. Asi solo hay UNA barra de busqueda.
  const showNav = !!active && !active.blank

  const newTab = (): void => {
    void window.tek.tabs.create()
    openPalette()
  }
  const goHome = (): void => {
    void window.tek.tabs.home()
    openPalette()
  }

  // --- Arrastre de pestanas (reordenar) --------------------------------------
  // dragId = pestana en vuelo; dropMark = donde caeria (antes/despues de esa id).
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropMark, setDropMark] = useState<{ id: string; after: boolean } | null>(null)

  /** Antes o despues de una pestana, segun la mitad del rect donde va el puntero. */
  const markOf = (e: React.DragEvent, id: string): { id: string; after: boolean } => {
    const r = e.currentTarget.getBoundingClientRect()
    return { id, after: e.clientX > r.left + r.width / 2 }
  }
  /** Traduce el marcador a "insertar antes de": despues de X = antes del siguiente. */
  const beforeIdOf = (m: { id: string; after: boolean }): string | null => {
    if (!m.after) return m.id
    const i = tabs.findIndex((t) => t.id === m.id)
    return tabs[i + 1]?.id ?? null
  }
  const endDrag = (): void => {
    setDragId(null)
    setDropMark(null)
  }
  const dropOn = (m: { id: string; after: boolean } | null): void => {
    if (dragId) void window.tek.tabs.move(dragId, m ? beforeIdOf(m) : null)
    endDrag()
  }

  const runs = toRuns(tabs)

  const renderTab = (t: TabMeta): React.JSX.Element => (
    <button
      key={t.id}
      className={`tab ${t.id === activeId ? 'is-active' : ''} ${t.pip ? 'is-pip' : ''} ${
        t.id === dragId ? 'is-dragging' : ''
      } ${dropMark?.id === t.id ? (dropMark.after ? 'drop-after' : 'drop-before') : ''}`}
      tabIndex={-1}
      draggable
      onDragStart={(e) => {
        setDragId(t.id)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', t.id)
      }}
      onDragEnd={endDrag}
      onDragOver={(e) => {
        if (!dragId || dragId === t.id) return
        e.preventDefault() // sin esto el drop nunca dispara
        e.dataTransfer.dropEffect = 'move'
        const m = markOf(e, t.id)
        // set funcional con bail-out: no re-renderiza en cada pixel del dragover.
        setDropMark((cur) => (cur && cur.id === m.id && cur.after === m.after ? cur : m))
      }}
      onDrop={(e) => {
        if (!dragId) return
        e.preventDefault()
        e.stopPropagation()
        dropOn(markOf(e, t.id))
      }}
      onClick={() => window.tek.tabs.activate(t.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        void window.tek.tabs.contextMenu(t.id)
      }}
      title={t.pip ? `${t.title} — en el mini-player` : t.title}
    >
      <span className="tab-lead">
        {t.pip ? (
          <span className="tab-pip" title="En el mini-player">
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden>
              <rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <rect x="11.5" y="11" width="7.5" height="6" rx="1.2" fill="currentColor" />
            </svg>
          </span>
        ) : t.loading ? (
          <span className="tab-dot is-loading" />
        ) : t.favicon ? (
          <img className="tab-favicon" src={t.favicon} alt="" />
        ) : (
          <span className="tab-dot" />
        )}
      </span>
      <span className="tab-title">{t.title || 'Nueva pestaña'}</span>
      {(t.audible || t.muted) && <MuteButton tab={t} />}
      <span
        className="tab-close"
        role="button"
        aria-label="Cerrar pestaña"
        onClick={(e) => {
          e.stopPropagation()
          void window.tek.tabs.close(t.id)
        }}
      >
        ✕
      </span>
    </button>
  )

  return (
    <div className={`topbar ${showNav ? '' : 'is-min'}`}>
      {/* Fila 1: pestanas + controles de ventana */}
      <div className="tb-tabs drag">
        <div
          className="tb-tablist no-drag"
          data-tour="tabs"
          onDragOver={(e) => {
            // Zona vacia del contenedor: soltar = mover al final. Los dragover
            // que burbujean desde una pestana llegan con target != currentTarget
            // y se ignoran (cada pestana ya gestiona su propia mitad).
            if (!dragId || e.target !== e.currentTarget) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropMark(null)
          }}
          onDrop={(e) => {
            if (!dragId || e.target !== e.currentTarget) return
            e.preventDefault()
            dropOn(null)
          }}
        >
          {runs.map((run, i) => {
            if (run.group === '') return run.tabs.map(renderTab)
            const grouped = run.tabs.length > 1
            const style = { '--g': groupColor(run.group) } as CSSProperties
            if (!grouped) {
              return (
                <div key={`g${i}-${run.group}`} className="tab-group" style={style}>
                  {run.tabs.map(renderTab)}
                </div>
              )
            }
            // Grupo de >1 pestana: la etiqueta (rama central) pliega/despliega.
            const isCollapsed = !!collapsed[run.group]
            const hasActive = run.tabs.some((t) => t.id === activeId)
            return (
              <div
                key={`g${i}-${run.group}`}
                className={`tab-group is-grouped ${isCollapsed ? 'is-collapsed' : ''}`}
                style={style}
              >
                <button
                  className={`tab-group-label ${hasActive ? 'has-active' : ''}`}
                  onClick={() => toggleGroup(run.group)}
                  title={isCollapsed ? `Mostrar ${run.tabs.length} pestañas` : 'Ocultar grupo'}
                >
                  <span className={`tab-group-caret ${isCollapsed ? 'is-closed' : ''}`}>⌄</span>
                  <span className="tab-group-name" title={run.group}>
                    {prettyHost(run.group)}
                  </span>
                  {isCollapsed && <span className="tab-group-count">{run.tabs.length}</span>}
                </button>
                {!isCollapsed && run.tabs.map(renderTab)}
              </div>
            )
          })}
        </div>
        <button
          className="tab-new no-drag"
          data-tour="newtab"
          title="Nueva pestaña (Ctrl+T)"
          onClick={newTab}
        >
          +
        </button>
        <div className="tb-spacer" />

        {recording && (
          <button
            className="tb-rec no-drag"
            title="Grabando macro — clic para detener"
            onClick={openAutomation}
          >
            <span className="rec-dot" />
            REC
          </button>
        )}

        <ToolsButton />

        <div className="tb-win no-drag">
          <button className="tb-wbtn" title="Minimizar" onClick={() => window.tek.win.minimize()}>
            ─
          </button>
          <button
            className="tb-wbtn"
            title="Maximizar"
            onClick={() => window.tek.win.maximizeToggle()}
          >
            ▢
          </button>
          <button className="tb-wbtn tb-close" title="Cerrar" onClick={() => window.tek.win.close()}>
            ✕
          </button>
        </div>
      </div>

      {/* Fila 2: navegacion + direccion. Solo cuando hay pagina (en la nueva
          pestana, la busqueda del centro es la unica). Las flechas/recarga/inicio
          se auto-ocultan y aparecen al pasar el raton por la fila (estilo Zen). */}
      {showNav && (
      <div className="tb-nav drag">
        <div className="tb-actions no-drag">
          <button
            className="tb-icon"
            title="Atrás"
            disabled={!active?.canGoBack}
            onClick={() => window.tek.goBack()}
          >
            ‹
          </button>
          <button
            className="tb-icon"
            title="Adelante"
            disabled={!active?.canGoForward}
            onClick={() => window.tek.goForward()}
          >
            ›
          </button>
          <button className="tb-icon" title="Recargar" onClick={() => window.tek.reload()}>
            {active?.loading ? '✕' : '↻'}
          </button>
          <button className="tb-icon" title="Inicio" onClick={goHome}>
            ⌂
          </button>
        </div>

        <button
          className="tb-host no-drag"
          data-tour="address"
          onClick={() => openPalette()}
          title="Ir a… (⌘K)"
        >
          <span className={`tb-dot ${active?.loading ? 'is-loading' : ''}`} />
          <span className="tb-host-text">{host || 'Buscar o escribir una dirección'}</span>
          <span className="tb-k">⌘K</span>
        </button>

        <PipButton />
        <AdblockShield />
      </div>
      )}

      {/* Barra de carga minimalista: linea fina en la costura con la pagina. */}
      {active?.loading && <span className="load-bar" aria-hidden />}
    </div>
  )
}
