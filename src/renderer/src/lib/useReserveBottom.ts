import { useEffect } from 'react'

/**
 * Reserva una franja inferior (encoge la vista nativa de la pagina) del alto de
 * un toast del renderer, para que el toast sea VISIBLE sobre la pagina: la vista
 * nativa siempre pinta por ENCIMA del renderer, asi que sin franja el toast
 * queda detras y nunca se ve.
 *
 * Cada superficie usa su propia `key` (p. ej. 'pw', 'dl'): el main toma el MAYOR
 * inset reservado, asi dos toasts a la vez no se pisan la reserva. Al desmontar
 * (o si `el` es null) libera la franja de esa key.
 *
 * `extra` = el `bottom` del toast en CSS + un respiro, para que no quede pegado
 * al borde inferior de la ventana.
 */
export function useReserveBottom(key: string, el: HTMLElement | null, extra: number): void {
  useEffect(() => {
    if (!el) {
      window.tek.setBottomInset(key, 0)
      return
    }
    const report = (): void => window.tek.setBottomInset(key, el.offsetHeight + extra)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => {
      ro.disconnect()
      window.tek.setBottomInset(key, 0)
    }
  }, [key, el, extra])
}
