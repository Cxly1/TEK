import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useTek } from '@/store'
import { greetingForUser } from '@/lib/greeting'
import './onboarding.css'

/**
 * Primera pantalla de TEK: pregunta como quieres que te llame. Solo aparece una
 * vez (el perfil guarda `greeted`), y se puede volver a abrir desde el final del
 * tutorial para cambiar el nombre.
 *
 * El nombre se queda en tu equipo (userData/tek-profile.json) y solo sirve para
 * el saludo: por eso "prefiero no decirlo" es una salida de primera clase, no
 * letra pequena.
 */
export function Welcome(): React.JSX.Element {
  const profile = useTek((s) => s.profile)
  const setProfile = useTek((s) => s.setProfile)
  const closeWelcome = useTek((s) => s.closeWelcome)
  const [name, setName] = useState(profile?.name ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const save = async (value: string): Promise<void> => {
    if (saving) return
    setSaving(true)
    // `greeted` cierra la pregunta para siempre, aunque el nombre quede vacio.
    const p = await window.tek.profile.set({ name: value, greeted: true })
    setProfile(p)
    closeWelcome()
  }

  const clean = name.trim()

  return (
    <div className="wel-overlay">
      <motion.div
        className="wel-card"
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 340, damping: 28 }}
      >
        <span className="wel-mark">⊕</span>
        <h1 className="wel-title">Esto es TEK</h1>
        <p className="wel-sub">
          Tu navegador. Antes de encenderlo:
          <br />
          ¿cómo quieres que te llame?
        </p>

        <input
          ref={inputRef}
          className="wel-input"
          value={name}
          maxLength={24}
          spellCheck={false}
          autoComplete="off"
          placeholder="tu nombre"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            // Enter guarda. stopPropagation porque en el arranque hay listeners
            // globales de teclado (encender TEK) que no deben verlo.
            if (e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              void save(name)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              void save('')
            }
          }}
        />

        {/* Vista previa viva: se entiende de un vistazo para que sirve el nombre. */}
        <span className="wel-preview">
          {clean ? `«${greetingForUser(clean)}»` : 'te saludaré cada vez que abras TEK'}
        </span>

        <div className="wel-actions">
          <button
            className="wel-btn wel-yes"
            disabled={clean === '' || saving}
            onClick={() => void save(name)}
          >
            Encantado
          </button>
          <button className="wel-btn wel-no" disabled={saving} onClick={() => void save('')}>
            Prefiero no decirlo
          </button>
        </div>

        <span className="wel-foot">se queda en este equipo · nada sale a internet</span>
      </motion.div>
    </div>
  )
}
