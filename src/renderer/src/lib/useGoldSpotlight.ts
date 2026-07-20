import { useCallback, useRef } from 'react'

/**
 * Spotlight dorado que sigue al cursor. Devuelve handlers para enganchar a un
 * elemento con la clase .gold-spot. Actualiza --x/--y por estilo (sin re-render)
 * y marca data-hot mientras el puntero esta dentro. FPS-safe.
 */
export function useGoldSpotlight<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T | null>(null)

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--x', `${e.clientX - rect.left}px`)
    el.style.setProperty('--y', `${e.clientY - rect.top}px`)
  }, [])

  const onPointerEnter = useCallback((e: React.PointerEvent<T>) => {
    e.currentTarget.setAttribute('data-hot', 'true')
  }, [])

  const onPointerLeave = useCallback((e: React.PointerEvent<T>) => {
    e.currentTarget.setAttribute('data-hot', 'false')
  }, [])

  return { ref, onPointerMove, onPointerEnter, onPointerLeave }
}
