import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useTek } from '@/store'
import './find.css'

/**
 * Barra "buscar en pagina" (Ctrl+F). Vive en la franja que el main libera al
 * bajar la WebContentsView FINDBAR_HEIGHT px, asi se sigue viendo la pagina
 * mientras buscas (no se puede flotar un overlay sobre la vista nativa).
 *
 * Al teclear busca con debounce resaltando todo y saltando a la primera
 * coincidencia; Enter avanza, Shift+Enter retrocede.
 */
export function FindBar(): React.JSX.Element {
  const findResult = useTek((s) => s.findResult)
  const closeFind = useTek((s) => s.closeFind)
  const inputRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')

  // Autofocus al abrir.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounce al teclear: resalta todas las coincidencias y salta a la primera.
  useEffect(() => {
    const id = setTimeout(() => {
      void window.tek.find.start(text, { findNext: false })
    }, 130)
    return () => clearTimeout(id)
  }, [text])

  const step = (forward: boolean): void => {
    if (text) void window.tek.find.start(text, { findNext: true, forward })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      step(!e.shiftKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeFind()
    }
  }

  const has = text.length > 0
  const none = has && findResult.total === 0

  return (
    <motion.div
      className="findbar"
      initial={{ y: -10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -10, opacity: 0 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
    >
      <span className="findbar-icon" aria-hidden>
        ⌕
      </span>
      <input
        ref={inputRef}
        className="findbar-input"
        type="text"
        placeholder="Buscar en la página"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className={`findbar-count ${none ? 'is-none' : ''}`}>
        {has ? (none ? 'Sin resultados' : `${findResult.active}/${findResult.total}`) : ''}
      </span>
      <span className="findbar-sep" aria-hidden />
      <button
        className="findbar-btn"
        title="Anterior (Shift+Enter)"
        disabled={!has}
        onClick={() => step(false)}
      >
        ↑
      </button>
      <button
        className="findbar-btn"
        title="Siguiente (Enter)"
        disabled={!has}
        onClick={() => step(true)}
      >
        ↓
      </button>
      <button className="findbar-btn findbar-close" title="Cerrar (Esc)" onClick={closeFind}>
        ✕
      </button>
    </motion.div>
  )
}
