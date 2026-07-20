import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTek } from '@/store'
import { useReserveBottom } from '@/lib/useReserveBottom'
import '../brain/brain.css'
import './passwords.css'

/**
 * Dos toasts del gestor de contrasenas:
 *  - OFERTA: el main capturo un login y pregunta si guardar. La contrasena
 *    NUNCA esta aqui: espera en memoria del main hasta que decides.
 *  - RELLENO: el sitio cargado tiene credenciales guardadas; un clic rellena.
 *    Nada se rellena solo (anti-cosecha por XSS).
 */
export function PasswordToasts(): React.JSX.Element {
  const pwOffer = useTek((s) => s.pwOffer)
  const setPwOffer = useTek((s) => s.setPwOffer)
  const fillAvail = useTek((s) => s.fillAvail)
  const setFillAvail = useTek((s) => s.setFillAvail)
  const activeId = useTek((s) => s.activeId)

  // El aviso de relleno solo tiene sentido sobre SU pestana; y caduca solo.
  const showFill = !!fillAvail && fillAvail.tabId === activeId && !pwOffer
  useEffect(() => {
    if (!fillAvail) return
    const t = setTimeout(() => setFillAvail(null), 15_000)
    return () => clearTimeout(t)
  }, [fillAvail, setFillAvail])

  // La vista nativa de la pagina tapa el renderer, asi que un toast a secas
  // quedaria invisible sobre una web cargada. Reservamos una franja inferior
  // (key 'pw') del alto del toast; 28+16 = `bottom` del .pw-toast + respiro.
  const [toastEl, setToastEl] = useState<HTMLDivElement | null>(null)
  useReserveBottom('pw', toastEl, 28 + 16)

  const decide = (action: 'save' | 'never' | 'dismiss'): void => {
    if (!pwOffer) return
    void window.tek.passwords.decision(pwOffer.offerId, action)
    setPwOffer(null)
  }

  const fill = (credId: string): void => {
    if (!fillAvail) return
    void window.tek.passwords.fill(fillAvail.tabId, credId)
    setFillAvail(null)
  }

  return (
    <>
      <AnimatePresence>
        {pwOffer && (
          <motion.div
            key="pw-offer"
            ref={setToastEl}
            className="pw-toast"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <div className="pw-toast-info">
              <span className="pw-toast-label">
                ⚿ {pwOffer.update ? 'Actualizar contraseña' : 'Guardar contraseña'}
              </span>
              <span className="pw-toast-text">
                {pwOffer.host}
                {pwOffer.username ? ` · ${pwOffer.username}` : ''}
              </span>
            </div>
            <div className="pw-toast-actions">
              <button className="routine-cancel" onClick={() => decide('never')}>
                Nunca aquí
              </button>
              <button className="routine-cancel" onClick={() => decide('dismiss')}>
                Ahora no
              </button>
              <button className="routine-open" onClick={() => decide('save')}>
                {pwOffer.update ? 'Actualizar' : 'Guardar'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showFill && fillAvail && (
          <motion.div
            key="pw-fill"
            ref={setToastEl}
            className="pw-toast"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <div className="pw-toast-info">
              <span className="pw-toast-label">⚿ Credenciales guardadas</span>
              <span className="pw-toast-text">{fillAvail.host}</span>
            </div>
            <div className="pw-toast-actions">
              <button className="routine-cancel" onClick={() => setFillAvail(null)}>
                ✕
              </button>
              {fillAvail.creds.slice(0, 3).map((c) => (
                <button key={c.id} className="routine-open" onClick={() => fill(c.id)}>
                  Rellenar {c.username || 'usuario'}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
