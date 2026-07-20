import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'

interface Spark {
  id: number
  angle: number
  dist: number
}

interface Props {
  onIgnite: () => void
}

/**
 * El "+" de Genesis: respira en idle, se imanta al cursor (Magnet), brilla con
 * halo dorado/fosforo al hover y dispara Click Spark al pulsar, lanzando el
 * apagado CRT (onIgnite).
 */
export function PlusButton({ onIgnite }: Props): React.JSX.Element {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [hot, setHot] = useState(false)
  const [sparks, setSparks] = useState<Spark[]>([])
  const firedRef = useRef(false)

  const FIELD = 140 // radio del campo magnetico

  const onMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    const d = Math.hypot(dx, dy)
    if (d < FIELD) {
      setOffset({ x: dx * 0.22, y: dy * 0.22 })
    }
  }

  const reset = (): void => {
    setOffset({ x: 0, y: 0 })
    setHot(false)
  }

  const fire = useCallback((): void => {
    if (firedRef.current) return
    firedRef.current = true
    // Genera el burst de chispas.
    const next: Spark[] = Array.from({ length: 14 }, (_, i) => ({
      id: Date.now() + i,
      angle: (Math.PI * 2 * i) / 14 + Math.random() * 0.3,
      dist: 60 + Math.random() * 40
    }))
    setSparks(next)
    // Da un respiro para que se vean las chispas y arranca el apagado.
    window.setTimeout(onIgnite, 180)
  }, [onIgnite])

  // Enter / Espacio encienden TEK sin tocar el raton: mismo arranque (con las
  // chispas) que pulsar el "+". El listener vive solo mientras Genesis esta en
  // pantalla, porque este componente solo se monta ahi.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        fire()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fire])

  return (
    <div
      className="plus-field"
      onPointerMove={onMove}
      onPointerLeave={reset}
      onPointerEnter={() => setHot(true)}
    >
      <motion.button
        className="plus-btn no-drag"
        aria-label="Abrir TEK"
        onClick={fire}
        animate={{ x: offset.x, y: offset.y }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        data-hot={hot}
      >
        {/* respiracion en idle */}
        <motion.span
          className="plus-glyph"
          animate={{ scale: hot ? 1.06 : [1, 1.03, 1] }}
          transition={
            hot
              ? { type: 'spring', stiffness: 300, damping: 20 }
              : { duration: 3.4, repeat: Infinity, ease: 'easeInOut' }
          }
        >
          +
        </motion.span>

        <AnimatePresence>
          {sparks.map((s) => (
            <motion.span
              key={s.id}
              className="spark"
              initial={{ x: 0, y: 0, opacity: 1 }}
              animate={{
                x: Math.cos(s.angle) * s.dist,
                y: Math.sin(s.angle) * s.dist,
                opacity: 0
              }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          ))}
        </AnimatePresence>
      </motion.button>
    </div>
  )
}
