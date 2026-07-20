import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { Routine } from '@shared/ipc'
import { useTek } from '@/store'
import './brain.css'

const BUCKET_LABEL: Record<string, string> = {
  manana: 'mañana',
  tarde: 'tarde',
  noche: 'noche',
  madrugada: 'madrugada'
}

/** Segundos antes de abrir la rutina sola. */
const COUNTDOWN = 6

/**
 * Automatizacion "de verdad": al arrancar, si TEK reconoce tu rutina de esta
 * franja, la abre sola tras una cuenta atras — con un boton bien visible para
 * cancelar. Tu mandas, pero por defecto te ahorra los clics.
 */
export function RoutineToast(): React.JSX.Element {
  const routine = useTek((s) => s.routine) as Routine
  const setRoutine = useTek((s) => s.setRoutine)
  const openPalette = useTek((s) => s.openPalette)
  const [left, setLeft] = useState(COUNTDOWN)
  const opened = useRef(false)

  const open = (): void => {
    if (opened.current) return
    opened.current = true
    // La primera pestana en blanco ya existe: reutilizala para el primer paso.
    routine.steps.forEach((st, i) => {
      if (i === 0) void window.tek.navigate(st.url)
      else void window.tek.tabs.create(st.url)
    })
    setRoutine(null)
  }

  const dismiss = (): void => {
    setRoutine(null)
    openPalette()
  }

  useEffect(() => {
    const t = setInterval(() => setLeft((n) => n - 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (left <= 0) open()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left])

  return (
    <motion.div
      className="routine-toast"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    >
      <div className="routine-info">
        <span className="routine-label">
          Tu rutina de la {BUCKET_LABEL[routine.bucket] ?? routine.bucket}
        </span>
        <span className="routine-steps">
          {routine.steps.map((st) => st.host.replace(/^www\./, '')).join('  ·  ')}
        </span>
      </div>
      <div className="routine-actions">
        <button className="routine-cancel" onClick={dismiss}>
          Ahora no
        </button>
        <button className="routine-open" onClick={open}>
          Abrir ya
          <span className="routine-count">{left}</span>
        </button>
      </div>
    </motion.div>
  )
}
