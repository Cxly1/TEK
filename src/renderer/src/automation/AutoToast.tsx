import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { RecipeToastInfo } from '@shared/ipc'
import { useTek } from '@/store'
import '../brain/brain.css'

/** Segundos antes de ejecutar la receta sola. */
const COUNTDOWN = 5

/**
 * Una receta se disparo (arranque, hora, visita o server detectado): TEK la
 * ejecuta sola tras la cuenta atras, con cancelacion bien visible. Mismo patron
 * que la auto-rutina del cerebro — tu mandas, TEK te ahorra los clics.
 */
export function AutoToast(): React.JSX.Element {
  const toast = useTek((s) => s.recipeToast) as RecipeToastInfo
  const setRecipeToast = useTek((s) => s.setRecipeToast)
  const [left, setLeft] = useState(COUNTDOWN)
  const ran = useRef(false)

  const run = (): void => {
    if (ran.current) return
    ran.current = true
    void window.tek.auto.runRecipe(toast.recipeId)
    setRecipeToast(null)
  }
  const dismiss = (): void => setRecipeToast(null)

  useEffect(() => {
    const t = setInterval(() => setLeft((n) => n - 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (left <= 0) run()
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
        <span className="routine-label">⚡ Receta · {toast.name}</span>
        <span className="routine-steps">{toast.summary}</span>
      </div>
      <div className="routine-actions">
        <button className="routine-cancel" onClick={dismiss}>
          Ahora no
        </button>
        <button className="routine-open" onClick={run}>
          Ejecutar
          <span className="routine-count">{left}</span>
        </button>
      </div>
    </motion.div>
  )
}
