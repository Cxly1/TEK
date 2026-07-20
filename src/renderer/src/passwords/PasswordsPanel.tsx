import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { PasswordMeta, PwStatus } from '@shared/ipc'
import { useTek } from '@/store'
import { useArrowNav } from '@/lib/useArrowNav'
import { groupColor } from '@/lib/groupColor'
import '../brain/brain.css'
import './passwords.css'

/**
 * Panel de contrasenas. Las contrasenas viven cifradas con el cifrado del
 * sistema (DPAPI, atadas a tu cuenta de Windows); aqui solo se descifra UNA
 * cuando pulsas "ver", y nada mas.
 */
export function PasswordsPanel(): React.JSX.Element {
  const closePasswords = useTek((s) => s.closePasswords)
  const [status, setStatus] = useState<PwStatus | null>(null)
  const [list, setList] = useState<PasswordMeta[]>([])
  /** id -> contrasena descifrada visible ahora mismo. */
  const [shown, setShown] = useState<Record<string, string>>({})
  const panelRef = useRef<HTMLDivElement | null>(null)

  const refresh = (): void => {
    void window.tek.passwords.status().then(setStatus)
    void window.tek.passwords.list().then(setList)
  }
  useEffect(refresh, [])

  const toggleReveal = async (id: string): Promise<void> => {
    if (shown[id] !== undefined) {
      setShown((s) => {
        const next = { ...s }
        delete next[id]
        return next
      })
      return
    }
    const pw = await window.tek.passwords.reveal(id)
    if (pw !== null) setShown((s) => ({ ...s, [id]: pw }))
  }

  const remove = async (e: PasswordMeta): Promise<void> => {
    if (!confirm(`¿Borrar la contraseña de ${e.host} (${e.username || 'sin usuario'})?`)) return
    await window.tek.passwords.remove(e.id)
    refresh()
  }

  const removeNever = async (host: string): Promise<void> => {
    await window.tek.passwords.removeNever(host)
    refresh()
  }

  // ↑↓ recorre las contraseñas guardadas; Enter muestra/oculta la activa.
  const nav = useArrowNav({
    rowLengths: list.map(() => 1),
    onActivate: (i) => {
      const e = list[i]
      if (e) void toggleReveal(e.id)
    }
  })
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  return (
    <div className="brain-overlay" onMouseDown={closePasswords}>
      <motion.div
        className="brain-panel"
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={nav.onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <header className="brain-head">
          <div>
            <h1 className="brain-title">⚿ Contraseñas</h1>
            <p className="brain-sub">
              {status
                ? status.available
                  ? `${status.count} guardada${status.count === 1 ? '' : 's'} · cifradas con tu cuenta de Windows`
                  : 'cifrado del sistema NO disponible: no se guardará nada'
                : 'cargando…'}
            </p>
          </div>
          <button className="brain-x" onClick={closePasswords} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="brain-body">
          <section className="brain-sec">
            <h2>Guardadas</h2>
            {list.length === 0 && (
              <p className="brain-empty">
                Nada todavía. Cuando inicies sesión en un sitio, TEK ofrecerá guardarla.
              </p>
            )}
            <ul className="brain-list">
              {list.map((e, i) => (
                <li key={e.id} className="knav-item" {...nav.itemProps(i)}>
                  <span className="brain-dot" style={{ background: groupColor(e.host) }} />
                  <span className="brain-host" title={e.host}>
                    {e.host.replace(/^www\./, '')}
                    <span style={{ color: 'var(--text-lo)' }}> · {e.username || 'sin usuario'}</span>
                  </span>
                  {shown[e.id] !== undefined && <span className="pw-secret">{shown[e.id]}</span>}
                  <button className="brain-forget is-shown" onClick={() => void toggleReveal(e.id)}>
                    {shown[e.id] !== undefined ? 'ocultar' : 'ver'}
                  </button>
                  <button className="brain-forget" onClick={() => void remove(e)}>
                    borrar
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {status && status.never.length > 0 && (
            <section className="brain-sec">
              <h2>Sitios donde no ofrece guardar</h2>
              <ul className="brain-list">
                {status.never.map((host) => (
                  <li key={host}>
                    <span className="brain-dot" style={{ background: groupColor(host) }} />
                    <span className="brain-host">{host.replace(/^www\./, '')}</span>
                    <button className="brain-forget is-shown" onClick={() => void removeNever(host)}>
                      volver a ofrecer
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="pw-note-box">
            Cada contraseña se cifra con <strong>DPAPI</strong> (la bóveda de tu cuenta de
            Windows, lo mismo que usa Chrome). En disco jamás hay texto plano, el relleno es
            por host exacto y siempre con un clic tuyo — nada se rellena solo.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
