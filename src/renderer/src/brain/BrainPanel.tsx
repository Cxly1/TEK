import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import type { BrainProfile } from '@shared/ipc'
import { useTek } from '@/store'
import { useArrowNav } from '@/lib/useArrowNav'
import { groupColor } from '@/lib/groupColor'
import './brain.css'

const BUCKET_LABEL: Record<string, string> = {
  manana: 'mañana',
  tarde: 'tarde',
  noche: 'noche',
  madrugada: 'madrugada'
}

/**
 * Panel "Lo que TEK sabe de ti": transparencia total. Muestra el perfil que el
 * cerebro ha aprendido y da control — pausar el aprendizaje, olvidar un sitio,
 * o borrarlo todo. Todo es local; aqui se ve y se manda.
 */
export function BrainPanel(): React.JSX.Element {
  const closeBrain = useTek((s) => s.closeBrain)
  const [profile, setProfile] = useState<BrainProfile | null>(null)
  const [ignored, setIgnored] = useState<string[]>([])
  const [cleared, setCleared] = useState<'all' | 'cookies' | 'cache' | null>(null)

  const refresh = (): void => {
    void window.tek.brain.profile().then(setProfile)
    void window.tek.brain.ignored().then(setIgnored)
  }
  useEffect(refresh, [])

  const togglePause = async (): Promise<void> => {
    if (!profile) return
    await window.tek.brain.setPaused(!profile.paused)
    refresh()
  }
  const forget = async (host: string): Promise<void> => {
    await window.tek.brain.forget(host)
    refresh()
  }
  const ignore = async (host: string): Promise<void> => {
    await window.tek.brain.ignore(host)
    refresh()
  }
  const unignore = async (host: string): Promise<void> => {
    await window.tek.brain.unignore(host)
    refresh()
  }
  const wipe = async (): Promise<void> => {
    if (!confirm('¿Borrar TODO lo que TEK ha aprendido? No se puede deshacer.')) return
    await window.tek.brain.wipe()
    refresh()
  }
  const clearData = async (scope: 'all' | 'cookies' | 'cache'): Promise<void> => {
    const what = {
      cache: 'la caché de los sitios',
      cookies: 'todas las cookies (cerrarás sesión en los sitios)',
      all: 'TODOS los datos de navegación: cookies, caché y almacenamiento'
    }[scope]
    if (!confirm(`¿Borrar ${what}? No se puede deshacer.`)) return
    await window.tek.privacy.clear(scope)
    setCleared(scope)
    window.setTimeout(() => setCleared(null), 2600)
  }

  // ↑↓ recorre "Tus sitios"; Enter abre el sitio (accion segura, no destructiva;
  // olvidar/no-aprender siguen con el raton para evitar borrados accidentales).
  const sites = profile?.topSites ?? []
  const panelRef = useRef<HTMLDivElement | null>(null)
  const nav = useArrowNav({
    rowLengths: sites.map(() => 1),
    onActivate: (i) => {
      const s = sites[i]
      if (!s) return
      void window.tek.navigate(`https://${s.host}`)
      closeBrain()
    }
  })
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  return (
    <div className="brain-overlay" onMouseDown={closeBrain}>
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
            <h1 className="brain-title">✦ Lo que TEK sabe de ti</h1>
            <p className="brain-sub">
              {profile
                ? `${profile.totalVisits} visitas aprendidas · franja: ${BUCKET_LABEL[profile.bucket] ?? profile.bucket}`
                : 'cargando…'}
            </p>
          </div>
          <button className="brain-x" onClick={closeBrain} aria-label="Cerrar">
            ✕
          </button>
        </header>

        {profile && (
          <div className="brain-body">
            <section className="brain-sec">
              <div className="brain-sec-head">
                <h2>Aprendizaje</h2>
                <button
                  className={`brain-toggle ${profile.paused ? 'is-off' : 'is-on'}`}
                  onClick={togglePause}
                >
                  {profile.paused ? 'Pausado' : 'Activo'}
                </button>
              </div>
              <p className="brain-note">
                {profile.paused
                  ? 'TEK no está registrando nada nuevo.'
                  : 'TEK está aprendiendo de tu navegación (todo local).'}
              </p>
            </section>

            <section className="brain-sec">
              <h2>Tus sitios</h2>
              {profile.topSites.length === 0 && <p className="brain-empty">Aún nada por aquí.</p>}
              <ul className="brain-list">
                {profile.topSites.map((s, i) => (
                  <li key={s.host} className="knav-item" {...nav.itemProps(i)}>
                    <span className="brain-dot" style={{ background: groupColor(s.host) }} />
                    <span className="brain-host">{s.host.replace(/^www\./, '')}</span>
                    <span className="brain-score">{s.score}</span>
                    <button
                      className="brain-forget"
                      title="No volver a aprender de este sitio"
                      onClick={() => ignore(s.host)}
                    >
                      no aprender
                    </button>
                    <button className="brain-forget" onClick={() => forget(s.host)}>
                      olvidar
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {profile.topMusic.length > 0 && (
              <section className="brain-sec">
                <h2>Tu música</h2>
                <ul className="brain-list">
                  {profile.topMusic.map((m) => (
                    <li key={m.title}>
                      <span className="brain-eq" aria-hidden>
                        ♪
                      </span>
                      <span className="brain-host">{m.title}</span>
                      <span className="brain-score">×{m.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {profile.routines.length > 0 && (
              <section className="brain-sec">
                <h2>Tus rutinas</h2>
                <ul className="brain-routines">
                  {profile.routines.map((r) => (
                    <li key={r.bucket}>
                      <span className="brain-bucket">{BUCKET_LABEL[r.bucket] ?? r.bucket}</span>
                      <span className="brain-route">
                        {r.steps.map((st) => st.host.replace(/^www\./, '')).join('  ·  ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {ignored.length > 0 && (
              <section className="brain-sec">
                <h2>Sitios que no aprende</h2>
                <ul className="brain-list">
                  {ignored.map((host) => (
                    <li key={host}>
                      <span className="brain-dot" style={{ background: groupColor(host) }} />
                      <span className="brain-host">{host.replace(/^www\./, '')}</span>
                      <button className="brain-forget is-shown" onClick={() => unignore(host)}>
                        volver a aprender
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="brain-sec">
              <h2>Datos de navegación</h2>
              <p className="brain-note">
                Cookies, caché y almacenamiento de Chromium (tu sesión real). Distinto de
                lo aprendido: esto cierra sesiones y vacía la caché.
                {cleared && <strong className="brain-cleared"> · listo ✓</strong>}
              </p>
              <div className="brain-data-actions">
                <button className="brain-forget is-shown" onClick={() => clearData('cache')}>
                  vaciar caché
                </button>
                <button className="brain-forget is-shown" onClick={() => clearData('cookies')}>
                  cerrar sesiones
                </button>
                <button className="brain-data-wipe" onClick={() => clearData('all')}>
                  borrar todo
                </button>
              </div>
            </section>

            <footer className="brain-foot">
              <button className="brain-wipe" onClick={wipe}>
                Borrar todo lo aprendido
              </button>
            </footer>
          </div>
        )}
      </motion.div>
    </div>
  )
}
