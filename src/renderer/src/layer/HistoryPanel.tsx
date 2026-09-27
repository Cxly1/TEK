import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { HistoryEntry } from '@shared/ipc'
import { clockTime, dayLabel } from '@/lib/format'
import { Glyph } from './icons'
import { buildRows, type HistoryRow } from './historyRows'
import './history.css'

/** Medianoche de hoy en ms epoch (para "borrar lo de hoy"). */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** "jueves, 24 de septiembre" -> "Jueves, 24 de septiembre". */
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** Monograma cuando TEK aun no tiene el icono del sitio. */
function Favicon({ row }: { row: HistoryRow }): React.JSX.Element {
  if (row.search) return <Glyph name="search" className="lyh-lead" />
  if (row.favicon) return <img className="lyh-fav" src={row.favicon} alt="" />
  return <span className="lyh-mono">{(row.host[0] ?? '?').toUpperCase()}</span>
}

type ClearWhat = 'hour' | 'today' | 'all'

/**
 * Historial, en la capa flotante: centrado sobre la pagina, que sigue viva
 * detras (solo atenuada). Una fila por pagina y dia (las recargas se funden),
 * con el icono del sitio, el titulo limpio y las busquedas contadas como
 * busquedas (ver historyRows). El cepillo abre un mini menu para borrar; "Todo"
 * pide un segundo toque en el propio panel, sin ventanas de Windows.
 *
 * Teclado (el buscador se queda con el foco, como la paleta): ↑↓ recorren,
 * Enter abre (Ctrl+Enter en pestaña nueva), Mayús+Supr borra la fila, Esc borra
 * lo escrito y un segundo Esc cierra.
 */
export function HistoryPanel(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [active, setActive] = useState(-1)
  const [clearOpen, setClearOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = (q: string): void => {
    void window.tek.brain.history({ query: q, limit: 500 }).then(setEntries)
  }
  // Carga inicial + busqueda con un pequeño respiro al teclear.
  useEffect(() => {
    const t = setTimeout(() => load(query), entries === null ? 0 : 120)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const rows = useMemo(() => buildRows(entries ?? [], dayLabel), [entries])

  const open = (row: HistoryRow, newTab: boolean): void => {
    if (newTab) {
      // En pestaña nueva el panel se queda: se pueden abrir varias seguidas.
      void window.tek.tabs.create(row.url)
      return
    }
    void window.tek.navigate(row.url)
    window.tek.layer.dismiss()
  }
  const remove = async (row: HistoryRow): Promise<void> => {
    await Promise.all(row.ids.map((id) => window.tek.brain.deleteVisit(id)))
    const gone = new Set(row.ids)
    setEntries((es) => (es ?? []).filter((e) => !gone.has(e.id)))
  }
  const clear = async (what: ClearWhat): Promise<void> => {
    if (what === 'all' && !armed) {
      setArmed(true)
      return
    }
    await window.tek.brain.clearHistory(
      what === 'hour' ? Date.now() - 3600_000 : what === 'today' ? startOfToday() : undefined
    )
    setClearOpen(false)
    setArmed(false)
    setActive(-1)
    load(query)
    inputRef.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const n = rows.length
    const row = rows[active]
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (n ? (a + 1) % n : -1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (n ? (a <= 0 ? n - 1 : a - 1) : -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (row) open(row, e.ctrlKey || e.metaKey)
    } else if (e.key === 'Delete' && e.shiftKey) {
      // Mayús+Supr, como en la barra de Chrome: Supr solo seguiria borrando texto.
      e.preventDefault()
      if (row) void remove(row)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (clearOpen) {
        setClearOpen(false)
        setArmed(false)
      } else if (query) {
        setQuery('')
        setActive(-1)
      } else window.tek.layer.dismiss()
    }
  }

  // La fila resaltada con teclado siempre a la vista.
  useEffect(() => {
    if (active < 0) return
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let day = ''
  return (
    <div
      className="lyh-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) window.tek.layer.dismiss()
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ly-panel lyh" role="dialog" aria-label="Historial" onPointerLeave={() => setActive(-1)}>
        <header className="ly-head lyh-head">
          <span className="ly-title">Historial</span>
          <button
            type="button"
            className={`ly-iconbtn ${clearOpen ? 'is-on' : ''}`}
            title="Borrar historial…"
            aria-label="Borrar historial"
            aria-expanded={clearOpen}
            onClick={() => {
              setClearOpen((o) => !o)
              setArmed(false)
            }}
          >
            <Glyph name="brush" />
          </button>
          <button
            type="button"
            className="ly-iconbtn"
            title="Cerrar (Esc)"
            aria-label="Cerrar"
            onClick={() => window.tek.layer.dismiss()}
          >
            <Glyph name="x" />
          </button>
        </header>

        {clearOpen && (
          <div className="lyh-clear" role="menu">
            <button type="button" role="menuitem" onClick={() => void clear('hour')}>
              La última hora
            </button>
            <button type="button" role="menuitem" onClick={() => void clear('today')}>
              Hoy
            </button>
            <div className="ly-sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className={`is-danger ${armed ? 'is-armed' : ''}`}
              onClick={() => void clear('all')}
            >
              {armed ? '¿Seguro? Toca otra vez' : 'Todo el historial'}
            </button>
          </div>
        )}

        <label className="lyh-search">
          <Glyph name="search" />
          <input
            ref={inputRef}
            placeholder="Buscar en el historial"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(-1)
            }}
            onKeyDown={onKey}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <div className="ly-list lyh-list" ref={listRef}>
          {entries !== null && rows.length === 0 && (
            <p className="ly-empty">{query ? `Nada con «${query}».` : 'Tu historial está vacío.'}</p>
          )}
          {rows.map((row, i) => {
            const header = row.day !== day ? capital((day = row.day)) : null
            return (
              <Fragment key={row.key}>
                {header && <div className="lyh-day">{header}</div>}
                <div
                  data-idx={i}
                  data-active={i === active ? 'true' : undefined}
                  className="ly-row lyh-row"
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={(e) => open(row, e.ctrlKey || e.metaKey)}
                  onAuxClick={(e) => {
                    // Clic con la rueda = pestaña nueva, como en cualquier navegador.
                    if (e.button === 1) open(row, true)
                  }}
                >
                  <Favicon row={row} />
                  <span className="lyh-name">
                    {row.search ? (
                      <>
                        <em>Buscaste</em> {row.search}
                      </>
                    ) : (
                      row.title
                    )}
                  </span>
                  {row.ids.length > 1 && (
                    <span className="lyh-count" title={`${row.ids.length} visitas a esta página ese día`}>
                      ×{row.ids.length}
                    </span>
                  )}
                  <span className="lyh-host">{row.host}</span>
                  <span className="lyh-time">{clockTime(row.at)}</span>
                  <div className="ly-acts">
                    <button
                      type="button"
                      className="ly-iconbtn is-danger"
                      title="Borrar del historial"
                      aria-label="Borrar del historial"
                      onClick={(e) => {
                        e.stopPropagation()
                        void remove(row)
                      }}
                    >
                      <Glyph name="x" />
                    </button>
                  </div>
                </div>
              </Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
