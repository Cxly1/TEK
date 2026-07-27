import { useState } from 'react'
import { motion } from 'motion/react'
import { useTek } from '@/store'
import './news.css'

/** Tope del mensaje. Mismo numero que valida el main (Feedback.ts). */
const MAX = 2000

/**
 * "Reportar un fallo": lo que escribes le llega a quien mantiene TEK.
 *
 * Reglas de la casa: se ve ANTES de enviar todo lo que se envia (nada de
 * historial ni pestanas; el sitio donde estabas solo si lo marcas), y si el
 * envio falla no se pierde nada — queda el boton de copiar el reporte.
 *
 * Lo escrito NO se borra al cerrar el panel: vive en el store mientras TEK siga
 * abierta, porque cerrarlo sin querer y perder el texto es de lo mas molesto.
 */
export function FeedbackPanel(): React.JSX.Element {
  const close = useTek((s) => s.closeFeedback)
  const draft = useTek((s) => s.feedbackDraft)
  const setDraft = useTek((s) => s.setFeedbackDraft)
  const version = useTek((s) => s.version)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)
  const [copyText, setCopyText] = useState('')

  const send = async (): Promise<void> => {
    if (sending || !draft.message.trim()) return
    setSending(true)
    setNote('')
    const res = await window.tek.feedback.send(draft)
    setSending(false)
    setNote(res.note)
    setCopyText(res.ok ? '' : res.text)
    if (res.ok) {
      setDone(true)
      setDraft({ message: '', contact: '' })
    }
  }

  const copy = (): void => {
    void navigator.clipboard.writeText(copyText).then(() => setNote('Copiado. Pégamelo por donde quieras.'))
  }

  return (
    <div className="news-overlay" onMouseDown={close}>
      <motion.div
        className="news-panel is-narrow"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <header className="news-head">
          <h1 className="news-title">Reportar un fallo</h1>
          <button className="news-x" onClick={close} aria-label="Cerrar">
            ✕
          </button>
        </header>

        {done ? (
          <div className="fb-done">
            <span className="fb-done-mark">✓</span>
            <p>{note}</p>
            <button className="fb-send" onClick={close}>
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <div className="news-body">
              <label className="fb-label" htmlFor="fb-msg">
                ¿Qué pasó?
              </label>
              <textarea
                id="fb-msg"
                className="fb-text"
                placeholder="Cuéntamelo como se lo contarías a alguien: qué hacías y qué pasó en vez de lo que esperabas."
                value={draft.message}
                maxLength={MAX}
                onChange={(e) => setDraft({ message: e.target.value })}
                autoFocus
              />
              <span className="fb-count">
                {draft.message.length} / {MAX}
              </span>

              <label className="fb-label" htmlFor="fb-contact">
                Para responderte <span className="fb-opt">(opcional)</span>
              </label>
              <input
                id="fb-contact"
                className="fb-input"
                placeholder="Tu correo, si quieres que te conteste"
                value={draft.contact}
                maxLength={120}
                onChange={(e) => setDraft({ contact: e.target.value })}
                spellCheck={false}
                autoComplete="off"
              />

              <div className="fb-sends">
                <span className="fb-sends-title">Se envía esto y nada más:</span>
                <span className="fb-chip">tu mensaje</span>
                <span className="fb-chip">TEK {version || '—'}</span>
                <span className="fb-chip">tu versión de Windows</span>
                <label className="fb-check">
                  <input
                    type="checkbox"
                    checked={draft.includeSite}
                    onChange={(e) => setDraft({ includeSite: e.target.checked })}
                  />
                  <span>añadir la página donde estabas</span>
                </label>
              </div>
            </div>

            <footer className="news-foot">
              {note ? <span className="fb-note">{note}</span> : <span className="news-hint" />}
              {copyText ? (
                <button className="news-report" onClick={copy}>
                  Copiar el reporte
                </button>
              ) : null}
              <button className="fb-send" onClick={() => void send()} disabled={sending || !draft.message.trim()}>
                {sending ? 'Enviando…' : 'Enviar'}
              </button>
            </footer>
          </>
        )}
      </motion.div>
    </div>
  )
}
