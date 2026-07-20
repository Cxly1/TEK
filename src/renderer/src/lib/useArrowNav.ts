import { useCallback, useEffect, useRef, useState } from 'react'

/** (fila, columna) del índice lineal según la geometría de filas. */
function toRowCol(index: number, rows: number[]): [number, number] {
  let i = index
  for (let r = 0; r < rows.length; r++) {
    if (i < rows[r]) return [r, i]
    i -= rows[r]
  }
  const last = Math.max(0, rows.length - 1)
  return [last, Math.max(0, (rows[last] ?? 1) - 1)]
}

/** Índice lineal desde (fila, columna), con clamp a la geometría. */
function fromRowCol(row: number, col: number, rows: number[]): number {
  const r = Math.max(0, Math.min(row, rows.length - 1))
  const c = Math.max(0, Math.min(col, (rows[r] ?? 1) - 1))
  let base = 0
  for (let k = 0; k < r; k++) base += rows[k]
  return base + c
}

/** Props que el hook inyecta a cada item navegable (spread en el elemento). */
export type NavItemProps = {
  'data-active': boolean
  onMouseEnter: () => void
  ref: (el: HTMLElement | null) => void
}

export interface ArrowNav {
  /** Índice del elemento activo (resaltado por teclado/ratón). */
  index: number
  setIndex: (i: number) => void
  /** Engánchalo al onKeyDown del contenedor con foco (input o div con tabIndex). */
  onKeyDown: (e: React.KeyboardEvent) => void
  /** Props para cada item: data-active + sincroniza con el ratón + ref para scroll. */
  itemProps: (i: number) => NavItemProps
}

/**
 * Navegación por flechas + Enter reutilizable — hermano del patrón que ya usa la
 * paleta (`sel` + onKey). NO toca el foco del DOM de los items: marca el activo
 * con `data-active` y lo resalta por CSS (.knav-item, como .cmd-row.is-active).
 * El contenedor que tenga el foco real (un input autoFocus o un div con tabIndex)
 * engancha `onKeyDown`.
 *
 * Geometría por FILAS (`rowLengths`): ←→ recorren el índice lineal (flujo natural
 * en grids y filas horizontales), ↑↓ saltan de fila conservando la columna. Para
 * una lista vertical basta `rowLengths` todo 1; para el grid de tiles, filas de 4;
 * para la nueva pestaña, filas de longitud variable.
 */
export function useArrowNav(opts: {
  rowLengths: number[]
  onActivate?: (i: number) => void
  onEscape?: () => void
  initial?: number
  loop?: boolean
}): ArrowNav {
  const { rowLengths, onActivate, onEscape, initial = 0, loop = false } = opts
  const total = rowLengths.reduce((a, b) => a + b, 0)
  const [index, setIndex] = useState(initial)
  const items = useRef<(HTMLElement | null)[]>([])

  // Si la lista encoge, no dejes el índice fuera de rango.
  useEffect(() => {
    if (index > total - 1) setIndex(Math.max(0, total - 1))
  }, [total, index])

  // El activo, siempre a la vista.
  useEffect(() => {
    items.current[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const move = useCallback(
    (dx: number, dy: number): void => {
      setIndex((cur) => {
        if (total === 0) return 0
        if (dy !== 0) {
          const [r, c] = toRowCol(cur, rowLengths)
          let nr = r + dy
          if (loop) nr = (nr + rowLengths.length) % rowLengths.length
          else nr = Math.max(0, Math.min(nr, rowLengths.length - 1))
          return fromRowCol(nr, c, rowLengths)
        }
        let ni = cur + dx
        if (loop) ni = (ni + total) % total
        else ni = Math.max(0, Math.min(ni, total - 1))
        return ni
      })
    },
    [rowLengths, total, loop]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          move(0, 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          move(0, -1)
          break
        case 'ArrowRight':
          e.preventDefault()
          move(1, 0)
          break
        case 'ArrowLeft':
          e.preventDefault()
          move(-1, 0)
          break
        case 'Home':
          e.preventDefault()
          setIndex(0)
          break
        case 'End':
          e.preventDefault()
          setIndex(Math.max(0, total - 1))
          break
        case 'Enter':
          if (onActivate) {
            e.preventDefault()
            onActivate(index)
          }
          break
        case 'Escape':
          // Solo lo consumimos si hay handler; si no, dejamos que burbujee
          // (p. ej. la nueva pestaña no cierra nada con Escape).
          if (onEscape) {
            e.preventDefault()
            onEscape()
          }
          break
      }
    },
    [move, index, onActivate, onEscape, total]
  )

  const itemProps = useCallback(
    (i: number) => ({
      'data-active': i === index,
      onMouseEnter: (): void => setIndex(i),
      ref: (el: HTMLElement | null): void => {
        items.current[i] = el
      }
    }),
    [index]
  )

  return { index, setIndex, onKeyDown, itemProps }
}
