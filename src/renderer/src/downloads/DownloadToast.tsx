import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTek } from '@/store'
import { formatBytes } from '@/lib/format'
import { useReserveBottom } from '@/lib/useReserveBottom'
import './downloads.css'

/** Ventana (ms) que un "terminado" sigue visible en el toast antes de irse solo. */
const LINGER = 9000

const dl = (): typeof window.tek.downloads => window.tek.downloads

/**
 * Toast de descargas (abajo a la derecha): aparece al empezar una descarga con
 * su progreso, y al terminar muestra "Descarga completa" con Abrir / Ver en
 * carpeta; se va solo a los pocos segundos. El usuario eligio este flujo
 * (guardar directo + aviso, estilo Chrome).
 */
export function DownloadToast(): React.JSX.Element {
  const downloads = useTek((s) => s.downloads)
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  // La vista nativa tapa el renderer: sin reservar franja, el toast queda DETRAS
  // de la pagina y nunca se ve. Reservamos (key 'dl') el alto del toast; 24 = su
  // `bottom` en CSS, +16 de respiro. Se libera solo cuando no hay toast (el=null).
  const [toastEl, setToastEl] = useState<HTMLDivElement | null>(null)
  useReserveBottom('dl', toastEl, 24 + 16)

  // La descarga "del momento": la mas reciente activa, o una recien terminada
  // dentro de su ventana de cortesia, que no se haya descartado a mano.
  const current = downloads.find(
    (d) =>
      !dismissed[d.id] &&
      (d.state === 'progressing' || (d.finishedAt != null && Date.now() - d.finishedAt < LINGER))
  )

  // Auto-descartar cuando termina (pasada la ventana de cortesia).
  useEffect(() => {
    if (!current || current.state === 'progressing' || current.finishedAt == null) return
    const ms = LINGER - (Date.now() - current.finishedAt)
    const id = current.id
    const t = setTimeout(() => setDismissed((m) => ({ ...m, [id]: true })), Math.max(0, ms))
    return () => clearTimeout(t)
  }, [current?.id, current?.state, current?.finishedAt])

  const p = current && current.total ? Math.min(100, Math.round((current.received / current.total) * 100)) : 0

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          ref={setToastEl}
          className={`dl-toast is-${current.state}`}
          initial={{ opacity: 0, y: 22, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 22, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        >
          <span className={`dlt-icon ${current.state === 'completed' ? 'is-done' : ''}`}>
            {current.state === 'completed' ? '✓' : '↓'}
          </span>
          <div className="dlt-body">
            <span className="dlt-name" title={current.filename}>
              {current.filename}
            </span>
            <span className="dlt-meta">
              {current.state === 'progressing'
                ? current.total
                  ? `${p}% · ${formatBytes(current.received)} / ${formatBytes(current.total)}`
                  : formatBytes(current.received)
                : current.state === 'completed'
                  ? 'Descarga completa'
                  : current.state === 'cancelled'
                    ? 'Cancelada'
                    : 'Interrumpida'}
            </span>
            {current.state === 'progressing' && (
              <span className="dlt-bar">
                <span className="dlt-bar-fill" style={{ width: `${p}%` }} />
              </span>
            )}
          </div>
          <div className="dlt-actions">
            {current.state === 'completed' ? (
              <>
                <button className="dlt-btn" onClick={() => dl().openFile(current.id)}>
                  Abrir
                </button>
                <button className="dlt-btn ghost" onClick={() => dl().showInFolder(current.id)}>
                  Carpeta
                </button>
              </>
            ) : current.state === 'progressing' ? (
              <button className="dlt-btn ghost" onClick={() => dl().cancel(current.id)}>
                Cancelar
              </button>
            ) : null}
            <button
              className="dlt-close"
              title="Cerrar"
              onClick={() => setDismissed((m) => ({ ...m, [current.id]: true }))}
            >
              ✕
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
