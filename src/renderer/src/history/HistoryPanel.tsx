import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { prettyHost, type HistoryEntry } from '@shared/ipc'
import { useTek } from '@/store'
import { useArrowNav } from '@/lib/useArrowNav'
import { groupColor } from '@/lib/groupColor'
import { clockTime, dayLabel } from '@/lib/format'
import './history.css'

/** Medianoche de hoy en ms epoch (para "borrar lo de hoy"). */
function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Panel de historial: lo que el cerebro ya guardaba en `visits` pero no se podia
 * ver. Buscador, agrupado por dia, clic para abrir, borrar una entrada o limpiar
 * por rango. La vista nativa esta oculta mientras esta abierto (como el palette).
 */
export function HistoryPanel(): React.JSX.Element {
  const close = useTek((s) => s.closeHistory)
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<HistoryEntry[]>([])

  const load = (q: string): void => {
    void window.tek.brain.history({ query: q, limit: 500 }).then(setEntries)
  }
  // Carga inicial + busqueda con un pequeno debounce.
  useEffect(() => {
    const t = setTimeout(() => load(query), 120)
    return () => clearTimeout(t)
  }, [query])

  const go = (url: string): void => {
    void window.tek.navigate(url)
    close()
  }
  const del = async (id: number): Promise<void> => {
    await window.tek.brain.deleteVisit(id)
    setEntries((es) => es.filter((e) => e.id !== id))
  }
  const clear = async (sinceMs?: number): Promise<void> => {
    await window.tek.brain.clearHistory(sinceMs)
    load(query)
  }

  // Agrupa por dia conservando el orden (ya viene mas reciente primero del main).
  const groups = useMemo(() => {
    const out: { label: string; items: HistoryEntry[] }[] = []
    for (const e of entries) {
      const label = dayLabel(e.at)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(e)
      else out.push({ label, items: [e] })
    }
    return out
  }, [entries])

  // Indice plano (por id) para casar cada fila —agrupada por dia— con el orden
  // real de `entries`, que es lo que recorre la navegacion por teclado.
  const indexById = useMemo(() => new Map(entries.map((e, i) => [e.id, i])), [entries])

  // El input mantiene el foco (como la paleta): solo ↑↓ y Enter van a la lista;
  // ←→/Inicio/Fin siguen editando el texto del buscador.
  const nav = useArrowNav({
    rowLengths: entries.map(() => 1),
    onActivate: (i) => {
      const e = entries[i]
      if (e) go(e.url)
    }
  })
  const onInputKey = (ev: React.KeyboardEvent): void => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Enter') nav.onKeyDown(ev)
  }

  return (
    <div className="hist-overlay" onMouseDown={close}>
      <motion.div
        className="hist-panel"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <header className="hist-head">
          <div className="hist-head-top">
            <h1 className="hist-title">Historial</h1>
            <button className="hist-x" onClick={close} aria-label="Cerrar">
              ✕
            </button>
          </div>
          <input
            className="hist-search"
            placeholder="Buscar en el historial…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
        </header>

        <div className="hist-body">
          {entries.length === 0 ? (
            <p className="hist-empty">{query ? 'Sin resultados.' : 'Tu historial está vacío.'}</p>
          ) : (
            groups.map((g) => (
              <section className="hist-day" key={g.label}>
                <h2 className="hist-day-label">{g.label}</h2>
                <ul className="hist-list">
                  {g.items.map((e) => (
                    <li className="hist-row knav-item" key={e.id} {...nav.itemProps(indexById.get(e.id) ?? 0)}>
                      <button className="hist-open" onClick={() => go(e.url)} title={e.url}>
                        <span className="hist-dot" style={{ background: groupColor(e.host) }} />
                        <span className="hist-text">
                          <span className="hist-name">{e.title || e.host}</span>
                          <span className="hist-host">{prettyHost(e.host)}</span>
                        </span>
                        <span className="hist-time">{clockTime(e.at)}</span>
                      </button>
                      <button
                        className="hist-del"
                        title="Borrar del historial"
                        onClick={() => del(e.id)}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>

        <footer className="hist-foot">
          <span className="hist-foot-label">Borrar:</span>
          <button className="hist-clear" onClick={() => clear(Date.now() - 3600_000)}>
            Última hora
          </button>
          <button className="hist-clear" onClick={() => clear(startOfToday())}>
            Hoy
          </button>
          <button
            className="hist-clear danger"
            onClick={() => {
              if (confirm('¿Borrar TODO el historial? No se puede deshacer.')) void clear()
            }}
          >
            Todo
          </button>
        </footer>
      </motion.div>
    </div>
  )
}
