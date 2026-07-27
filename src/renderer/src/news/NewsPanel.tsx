import { useEffect, useMemo, useRef } from 'react'
import { motion } from 'motion/react'
import { NEWS, newsSince } from '@shared/news'
import { useTek } from '@/store'
import './news.css'

/** '2026-07-24' -> '24 jul 2026'. Sin Date: la cadena ya viene en orden. */
function prettyDate(iso: string): string {
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const [y, m, d] = iso.split('-')
  const mes = MESES[Number(m) - 1]
  return mes ? `${Number(d)} ${mes} ${y}` : iso
}

/**
 * Novedades: que cambio en cada version de TEK. El contenido viaja DENTRO de la
 * app (`@shared/news`), asi que esto se ve sin internet y siempre cuadra con la
 * version instalada.
 *
 * FORMA: una linea de tiempo. Un riel baja por el margen y cada version es un
 * nodo; lo nuevo va arriba y a plena luz, lo viejo debajo y atenuado. El riel es
 * la UNICA estructura — no hay pildoras, ni rayas, ni vinetas, que eran tres
 * adornos para la misma jerarquia. Oro: solo el nodo de lo que no habias visto,
 * un punto en todo el panel (patron del changelog de Linear + el nodo del
 * Timeline de Aceternity).
 *
 * TECLADO: el cuerpo toma el foco al abrir, asi que flechas, AvPag y Inicio/Fin
 * DESPLAZAN la lista — que es lo que pide una superficie de leer. (Antes colgaba
 * de `useArrowNav`, que resalta "el item activo": aqui no hay nada que activar,
 * y el resaltado se veia como un marco dorado gigante que ademas perseguia al
 * raton. Fuera.) Escape lo cierra desde App.
 *
 * Abrir el panel marca las novedades como vistas (lo hace `openNews` en el
 * store), asi que el punto del megafono se apaga solo.
 */
export function NewsPanel(): React.JSX.Element {
  const close = useTek((s) => s.closeNews)
  const openFeedback = useTek((s) => s.openFeedback)
  const version = useTek((s) => s.version)
  const body = useRef<HTMLDivElement>(null)

  // Lo que no habia visto al abrir: son las entradas "nuevas" de esta visita. Se
  // congela al montar (el store ya marco visto) para que no se vacie sola.
  //
  // Sin marca previa (`seen` vacio) NO se etiqueta todo: quien venia de una
  // version anterior a las novedades ya conocia lo suyo, y llamar "nuevo" a lo
  // de hace tres versiones seria mentirle. Solo la version actual.
  const fresh = useMemo(() => {
    const seen = useTek.getState().profile?.newsSeen ?? ''
    const list = !seen
      ? NEWS.filter((n) => n.version === version)
      : seen === version
        ? []
        : newsSince(seen)
    return new Set(list.map((n) => n.version))
  }, [])

  // La entrada que se lee a plena luz: la que tienes instalada. Si no hay
  // entrada para tu version (build de desarrollo, o publicar sin anotar), la
  // primera — antes que dejar el panel entero en gris, como si nada fuera tuyo.
  const hi = useMemo(() => {
    const i = NEWS.findIndex((n) => n.version === version)
    return i < 0 ? 0 : i
  }, [version])

  // El foco va al cuerpo, no al panel: es lo que hace que las flechas desplacen.
  useEffect(() => body.current?.focus({ preventScroll: true }), [])

  return (
    <div className="news-overlay" onMouseDown={close}>
      <motion.div
        className="news-panel is-reading"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <header className="news-head">
          <h1 className="news-title">Novedades</h1>
          <button className="news-x" onClick={close} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="news-body" ref={body} tabIndex={-1}>
          {NEWS.map((n, i) => (
            <section
              className={`news-ver ${i === hi ? 'is-current' : ''} ${fresh.has(n.version) ? 'is-new' : ''}`}
              key={n.version}
            >
              <span className="news-node" aria-hidden />
              <div className="news-meta">
                <span className="news-num">{n.version}</span>
                {fresh.has(n.version) ? <span className="news-tag">nuevo</span> : null}
                <span className="news-date">{prettyDate(n.date)}</span>
              </div>
              <h2 className="news-ver-title">{n.title}</h2>
              <ul className="news-items">
                {n.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="news-foot">
          <span className="news-hint">El megáfono de arriba se enciende cuando hay algo nuevo.</span>
          <button className="news-report" onClick={openFeedback}>
            ¿Algo se rompió?
          </button>
        </footer>
      </motion.div>
    </div>
  )
}
