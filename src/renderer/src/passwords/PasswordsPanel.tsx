import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { PasswordMeta, PwStatus } from '@shared/ipc'
import { useTek } from '@/store'
import { useArrowNav } from '@/lib/useArrowNav'
import { groupColor } from '@/lib/groupColor'
import '../brain/brain.css'
import './passwords.css'

/** Formulario de desbloqueo: la bóveda está protegida y no hay clave en memoria. */
function LockScreen({ onUnlocked }: { onUnlocked: () => void }): React.JSX.Element {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => ref.current?.focus(), [])

  const submit = async (): Promise<void> => {
    if (!pw || busy) return
    setBusy(true)
    setError('')
    const ok = await window.tek.passwords.unlock(pw)
    setBusy(false)
    if (!ok) {
      setError('Contraseña incorrecta.')
      setPw('')
      return
    }
    onUnlocked()
  }

  return (
    <div className="pw-lock">
      <span className="pw-lock-mark">⚿</span>
      <p className="pw-lock-text">
        Tu bóveda está protegida con contraseña maestra. Escríbela para ver, rellenar o
        guardar credenciales en esta sesión.
      </p>
      <div className="pw-form" style={{ maxWidth: 380 }}>
        <input
          ref={ref}
          className="pw-input"
          type="password"
          value={pw}
          placeholder="contraseña maestra"
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            e.stopPropagation()
            void submit()
          }}
        />
        <button className="pw-btn is-primary" disabled={!pw || busy} onClick={() => void submit()}>
          Desbloquear
        </button>
        {error && <span className="pw-error">{error}</span>}
      </div>
    </div>
  )
}

/** Poner, cambiar o quitar la contraseña maestra. Re-cifra toda la bóveda. */
function MasterSection({
  status,
  onDone
}: {
  status: PwStatus
  onDone: () => void
}): React.JSX.Element {
  const [mode, setMode] = useState<'set' | 'change' | 'remove' | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = (): void => {
    setMode(null)
    setCurrent('')
    setNext('')
    setRepeat('')
    setError('')
  }

  const apply = async (): Promise<void> => {
    if (busy) return
    if (mode !== 'remove' && next !== repeat) {
      setError('Las dos contraseñas no coinciden.')
      return
    }
    setBusy(true)
    setError('')
    const res = await window.tek.passwords.setMaster(
      mode === 'remove' ? null : next,
      status.protected ? current : undefined
    )
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? 'No se pudo aplicar.')
      return
    }
    reset()
    onDone()
  }

  return (
    <section className="brain-sec">
      <h2>Contraseña maestra</h2>
      <p className="brain-sub" style={{ margin: '0 0 6px' }}>
        {status.protected ? (
          <span className="pw-state">● activa · se bloquea sola a los 15 min</span>
        ) : (
          'Capa extra: sin ella, cualquier programa que ya corra como tú podría leer la bóveda. Con ella hace falta algo que solo está en tu cabeza.'
        )}
      </p>

      {mode === null ? (
        <div className="pw-form">
          {status.protected ? (
            <>
              <button className="pw-btn" onClick={() => setMode('change')}>
                Cambiarla
              </button>
              <button className="pw-btn" onClick={() => setMode('remove')}>
                Quitarla
              </button>
              <button
                className="pw-btn"
                onClick={() => {
                  void window.tek.passwords.lock().then(onDone)
                }}
              >
                Bloquear ahora
              </button>
            </>
          ) : (
            <button className="pw-btn is-primary" onClick={() => setMode('set')}>
              Proteger con contraseña maestra
            </button>
          )}
        </div>
      ) : (
        <div className="pw-form">
          {status.protected && (
            <input
              className="pw-input"
              type="password"
              value={current}
              placeholder="contraseña actual"
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
          {mode !== 'remove' && (
            <>
              <input
                className="pw-input"
                type="password"
                value={next}
                placeholder="nueva (mínimo 8)"
                onChange={(e) => setNext(e.target.value)}
              />
              <input
                className="pw-input"
                type="password"
                value={repeat}
                placeholder="repítela"
                onChange={(e) => setRepeat(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  e.stopPropagation()
                  void apply()
                }}
              />
            </>
          )}
          <button
            className="pw-btn is-primary"
            disabled={busy || (mode !== 'remove' && next.length < 8)}
            onClick={() => void apply()}
          >
            {busy ? 'cifrando…' : mode === 'remove' ? 'Quitar' : 'Guardar'}
          </button>
          <button className="pw-btn" onClick={reset}>
            Cancelar
          </button>
          {error && <span className="pw-error">{error}</span>}
        </div>
      )}
    </section>
  )
}

/**
 * Panel de contrasenas. Todo se guarda cifrado con el cifrado del sistema y,
 * si la activas, bajo una contrasena maestra (AES-256-GCM con clave derivada
 * por scrypt). Aqui solo se descifra UNA cuando pulsas "ver", y nada mas.
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
    setShown({})
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
    else refresh() // se bloqueo sola por inactividad
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

  const locked = !!status?.locked

  // ↑↓ recorre las contraseñas guardadas; Enter muestra/oculta la activa.
  const nav = useArrowNav({
    rowLengths: locked ? [] : list.map(() => 1),
    onActivate: (i) => {
      const e = list[i]
      if (e) void toggleReveal(e.id)
    }
  })
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const headSub = (): string => {
    if (!status) return 'cargando…'
    if (!status.available) return 'cifrado del sistema NO disponible: no se guardará nada'
    if (status.locked) return 'bóveda bloqueada'
    const n = `${status.count} guardada${status.count === 1 ? '' : 's'}`
    return status.protected ? `${n} · protegidas con contraseña maestra` : n
  }

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
            <p className="brain-sub">{headSub()}</p>
          </div>
          <button className="brain-x" onClick={closePasswords} aria-label="Cerrar">
            ✕
          </button>
        </header>

        <div className="brain-body">
          {locked ? (
            <LockScreen onUnlocked={refresh} />
          ) : (
            <>
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

              {status && <MasterSection status={status} onDone={refresh} />}

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
                En disco jamás hay texto plano. El relleno es por host exacto y siempre con un
                clic tuyo — nada se rellena solo, y el aviso solo aparece si la página tiene de
                verdad un campo donde escribir.
              </p>
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}
