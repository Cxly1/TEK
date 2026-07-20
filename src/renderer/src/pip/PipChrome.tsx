import { useEffect, useRef, useState, type PointerEvent } from 'react'
import type { PipState } from '@shared/ipc'
import { prettyHost } from '@shared/ipc'
import './pip.css'

/**
 * Barra de control del mini-player (Picture-in-Picture). Vive en su PROPIA
 * WebContentsView nativa, por encima del video (un overlay de React jamas se
 * veria sobre una vista nativa). Se monta cuando el renderer se carga con
 * `?surface=pip` (ver main.tsx). Habla con el main por `window.tek.pip`.
 *
 * Arrastre: en modo flotante lo mueve el SO (region -webkit-app-region: drag);
 * en modo acoplado no hay ventana nativa que arrastrar, asi que capturamos el
 * puntero y desplazamos el mini por IPC (pip.moveBy).
 */
export function PipChrome(): React.JSX.Element | null {
  const [state, setState] = useState<PipState | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)
  const lastDown = useRef(0)

  useEffect(() => {
    let alive = true
    void window.tek.pip.state().then((s) => {
      if (alive) setState(s)
    })
    const off = window.tek.pip.onState(setState)
    return () => {
      alive = false
      off()
    }
  }, [])

  if (!state || !state.active) return null
  const floating = state.mode === 'floating'
  const label = state.title || prettyHost(state.host) || 'Mini-player'

  // Arrastre manual de la barra, igual en acoplado y flotante (asi el doble-clic
  // tambien funciona flotando, donde la region de arrastre nativa se comeria los
  // eventos). Un doble-clic rapido sobre la barra = volver a la pestaña a pantalla
  // completa. El main decide que hace cada moveBy segun el modo.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest('button')) return // no robar el clic a un boton
    const now = Date.now()
    if (now - lastDown.current < 350) {
      lastDown.current = 0
      drag.current = null
      void window.tek.pip.backToTab()
      return
    }
    lastDown.current = now
    drag.current = { x: e.screenX, y: e.screenY }
    moved.current = false
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    const dx = e.screenX - drag.current.x
    const dy = e.screenY - drag.current.y
    if (dx || dy) {
      moved.current = true
      void window.tek.pip.moveBy(dx, dy)
      drag.current = { x: e.screenX, y: e.screenY }
    }
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    const wasDragging = drag.current !== null
    drag.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ya liberado */
    }
    // Al soltar un arrastre real, el mini acoplado se imanta a la esquina mas cercana.
    if (wasDragging && moved.current) void window.tek.pip.snap()
  }

  return (
    <div
      className="pipbar"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="pip-id">
        {state.favicon ? (
          <img className="pip-favicon" src={state.favicon} alt="" />
        ) : (
          <span className="pip-dot" />
        )}
        <span className="pip-title" title={label}>
          {label}
        </span>
      </div>

      <div className="pip-controls no-drag">
        <button
          className="pip-btn"
          title={state.muted ? 'Reactivar audio' : 'Silenciar'}
          onClick={() => void window.tek.pip.setMuted(!state.muted)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
            <path
              d="M4 9v6h3.5L13 19.5V4.5L7.5 9H4z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            {state.muted ? (
              <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            ) : (
              <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M16.2 9.2a4 4 0 010 5.6" />
                <path d="M18.6 7a7.2 7.2 0 010 10" />
              </g>
            )}
          </svg>
        </button>

        <button
          className="pip-btn"
          title={state.minimized ? 'Restaurar' : 'Minimizar (sigue el audio)'}
          onClick={() => void window.tek.pip.toggleMinimize()}
        >
          {state.minimized ? (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path
                d="M7 14l5-5 5 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
              <path d="M6 17h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          )}
        </button>

        <button
          className="pip-btn"
          title={floating ? 'Acoplar a TEK' : 'Soltar (ventana flotante)'}
          onClick={() => void window.tek.pip.toggleFloat()}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <rect x="11.5" y="11" width="7.5" height="6" rx="1.2" fill="currentColor" />
          </svg>
        </button>

        <button
          className="pip-btn"
          title="Volver a la pestaña"
          onClick={() => void window.tek.pip.backToTab()}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
            <path
              d="M9 5H5v4M15 5h4v4M15 19h4v-4M9 19H5v-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button className="pip-btn pip-close" title="Cerrar mini-player" onClick={() => void window.tek.pip.exit()}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
            <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
