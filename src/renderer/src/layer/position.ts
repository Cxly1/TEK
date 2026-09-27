import { useEffect, useReducer } from 'react'
import type { LayerAnchor } from '@shared/ipc'

/**
 * Repinta el panel si la capa cambia de tamaño: su sitio se calcula con
 * window.innerWidth y, sin esto, un ancho viejo (p. ej. el de una capa que aun
 * no se habia enterado de su tamaño) lo dejaba en el lugar equivocado.
 */
export function useViewportSize(): void {
  const [, repaint] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    window.addEventListener('resize', repaint)
    return () => window.removeEventListener('resize', repaint)
  }, [])
}

/** Aire minimo con el borde de la ventana. */
const EDGE = 8
/** Separacion entre el boton y el panel. */
const GAP = 6

/**
 * Panel que cuelga de un boton de la barra (el menu ☰, Descargas): debajo,
 * con el borde derecho alineado al del boton y sin salirse de la ventana.
 */
export function dropdownPos(a: LayerAnchor, width: number): { top: number; right: number } {
  const vw = window.innerWidth
  const right = Math.min(
    Math.max(EDGE, Math.round(vw - (a.x + a.width))),
    Math.max(EDGE, vw - width - EDGE)
  )
  return { top: Math.round(a.y + a.height + GAP), right }
}
