import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useTek } from '@/store'
import { useArrowNav } from '@/lib/useArrowNav'
import './session.css'

/**
 * Overlay de arranque: si habia una sesion previa, ofrece reanudarla.
 * "Si" recrea y carga todas las pestanas; "No" empieza limpio. Se recorre con
 * ←→ (o ↑↓) y se confirma con Enter; el raton sigue funcionando igual.
 */
export function SessionResume(): React.JSX.Element {
  const count = useTek((s) => s.resume) ?? 0
  const setResume = useTek((s) => s.setResume)
  const setRoutine = useTek((s) => s.setRoutine)
  const openPalette = useTek((s) => s.openPalette)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const openTour = useTek((s) => s.openTour)

  /** ¿Toca el tutorial guiado? (aun no lo ha visto: manda sobre todo lo demas). */
  const tourPending = (): boolean => !useTek.getState().profile?.tourDone

  const resume = async (): Promise<void> => {
    setResume(null)
    await window.tek.session.restore()
    if (tourPending()) openTour()
  }

  const fresh = async (): Promise<void> => {
    setResume(null)
    await window.tek.session.discard()
    if (tourPending()) {
      openTour()
      return
    }
    // Empezar limpio: ofrece la rutina de la franja si TEK la reconoce.
    const r = await window.tek.brain.routineForNow()
    if (r) setRoutine(r)
    else openPalette()
  }

  // Dos botones en fila: ←→/↑↓ mueven el resaltado, Enter confirma. La tarjeta
  // toma el foco al aparecer (el lienzo de atras ya no se lo roba, ver Shell).
  const nav = useArrowNav({
    rowLengths: [2],
    onActivate: (i) => {
      if (i === 0) void resume()
      else void fresh()
    }
  })
  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  return (
    <div className="resume-overlay">
      <motion.div
        className="resume-card"
        tabIndex={-1}
        ref={cardRef}
        onKeyDown={nav.onKeyDown}
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <span className="resume-mark">⊕</span>
        <h1 className="resume-title">Hola de nuevo</h1>
        <p className="resume-sub">
          ¿Continuamos la última sesión?
          <br />
          <span className="resume-count">
            {count} {count === 1 ? 'pestaña guardada' : 'pestañas guardadas'}
          </span>
        </p>
        <div className="resume-actions">
          <button className="resume-btn resume-yes knav-item" onClick={resume} {...nav.itemProps(0)}>
            Sí, continuar
          </button>
          <button className="resume-btn resume-no knav-item" onClick={fresh} {...nav.itemProps(1)}>
            Empezar limpio
          </button>
        </div>
      </motion.div>
    </div>
  )
}
