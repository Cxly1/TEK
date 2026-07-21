import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTek } from '@/store'
import { useReserveBottom } from '@/lib/useReserveBottom'
import './update.css'

/**
 * Aviso de actualizacion de TEK. NADA se descarga sin tocar "Descargar": el main
 * se queda esperando en la fase `available` (ver Updater.ts).
 *
 * Igual que los toasts de contrasenas, reserva franja inferior con su propia
 * clave ('up'): la vista nativa de la pagina pinta SIEMPRE por encima del
 * renderer, asi que sin franja este aviso quedaria invisible sobre una web.
 */
export function UpdateToast(): React.JSX.Element {
  const update = useTek((s) => s.update)
  const note = useTek((s) => s.updateNote)
  const setUpdateNote = useTek((s) => s.setUpdateNote)

  const [el, setEl] = useState<HTMLDivElement | null>(null)
  // 28 + 16 = el `bottom` del .up-toast en CSS + un respiro.
  useReserveBottom('up', el, 28 + 16)

  // El aviso pasajero ("ya estas al dia") se retira solo.
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setUpdateNote(''), 5000)
    return () => clearTimeout(t)
  }, [note, setUpdateNote])

  const p = update.phase
  const show = p === 'available' || p === 'downloading' || p === 'ready' || p === 'error' || !!note

  const close = (): void => {
    setUpdateNote('')
    // Tambien en 'ready': sin el dismiss la fase se queda en ready y el toast
    // no se iria NUNCA. "Al cerrar" solo apaga el aviso; instalar al salir ya
    // esta armado en el main (autoInstallOnAppQuit).
    if (p === 'available' || p === 'error' || p === 'ready') void window.tek.update.dismiss()
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="up-toast"
          ref={setEl}
          className="up-toast"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        >
          {p === 'available' && (
            <>
              <div className="up-body">
                <div className="up-title">TEK {update.version} ya está disponible</div>
                {update.notes && <div className="up-notes">{update.notes}</div>}
              </div>
              <div className="up-actions">
                <button className="up-btn is-primary" onClick={() => void window.tek.update.download()}>
                  Descargar
                </button>
                <button className="up-btn" onClick={close}>
                  Ahora no
                </button>
              </div>
            </>
          )}

          {p === 'downloading' && (
            <div className="up-body">
              <div className="up-title">Descargando TEK {update.version}… {update.percent}%</div>
              <div className="up-bar">
                <div className="up-bar-fill" style={{ width: `${update.percent}%` }} />
              </div>
              <div className="up-notes">Puedes seguir navegando, se baja de fondo.</div>
            </div>
          )}

          {p === 'ready' && (
            <>
              <div className="up-body">
                <div className="up-title">TEK {update.version} está lista</div>
                <div className="up-notes">
                  Se instala sola al cerrar TEK. Tus pestañas y tu sesión se conservan.
                </div>
              </div>
              <div className="up-actions">
                <button className="up-btn is-primary" onClick={() => void window.tek.update.install()}>
                  Reiniciar ahora
                </button>
                <button className="up-btn" onClick={close}>
                  Al cerrar
                </button>
              </div>
            </>
          )}

          {p === 'error' && (
            <>
              <div className="up-body">
                <div className="up-title">No se pudo actualizar</div>
                <div className="up-notes">{update.error}</div>
              </div>
              <div className="up-actions">
                <button className="up-btn" onClick={close}>
                  Cerrar
                </button>
              </div>
            </>
          )}

          {/* Aviso suelto (buscar a mano y no haber nada). Solo si no hay fase que enseñar. */}
          {p !== 'available' && p !== 'downloading' && p !== 'ready' && p !== 'error' && note && (
            <>
              <div className="up-body">
                <div className="up-title">{note}</div>
              </div>
              <div className="up-actions">
                <button className="up-btn" onClick={close}>
                  Cerrar
                </button>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
