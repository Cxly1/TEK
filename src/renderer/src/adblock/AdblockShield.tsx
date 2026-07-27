import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { hostKey, type AdblockSource } from '@shared/ipc'
import { useActiveTab } from '@/store'
import './adblock.css'

/** Texto humano de "de donde salen las listas y de que fecha son". */
function listsLabel(source: AdblockSource, updatedAt: number | null): { text: string; warn: boolean } {
  if (source === 'baseline') return { text: 'Protección básica — cargando listas…', warn: true }
  if (!updatedAt) return { text: 'Listas activas', warn: false }
  const days = Math.floor((Date.now() - updatedAt) / 86_400_000)
  const when = days <= 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`
  // 'snapshot' = las que vinieron con la app; 'cache'/'live' = refrescadas.
  return { text: source === 'snapshot' ? `Listas incluidas · ${when}` : `Listas al día · ${when}`, warn: false }
}

/**
 * Escudo del adblock en la TopBar: muestra cuantos anuncios/trackers se han
 * bloqueado en la pestana activa y abre un popover con el control global
 * (on/off) y el "permitir en este sitio" (allowlist por dominio).
 *
 * El popover cae bajo la TopBar, donde la WebContentsView lo taparia: por eso,
 * como el palette, ocultamos la vista nativa mientras esta abierto.
 */
export function AdblockShield(): React.JSX.Element {
  const active = useActiveTab()
  const host = active && !active.blank ? hostKey(active.url) : ''
  const blocked = active?.blocked ?? 0

  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [lists, setLists] = useState<{ source: AdblockSource; updatedAt: number | null } | null>(null)
  const [allowed, setAllowed] = useState(false)

  // Refresca el estado al abrir o al cambiar de sitio.
  useEffect(() => {
    if (!open) return
    let alive = true
    void window.tek.adblock.status().then((s) => {
      if (!alive) return
      setEnabled(s.enabled)
      setLists({ source: s.source, updatedAt: s.updatedAt })
    })
    if (host) void window.tek.adblock.siteAllowed(host).then((a) => alive && setAllowed(a))
    else setAllowed(false)
    return () => {
      alive = false
    }
  }, [open, host])

  const openPop = (): void => {
    void window.tek.setVisible(false)
    setOpen(true)
  }
  const closePop = (): void => {
    void window.tek.setVisible(true)
    setOpen(false)
  }

  const toggleGlobal = async (): Promise<void> => {
    const next = await window.tek.adblock.toggle(!enabled)
    setEnabled(next)
  }
  const toggleSite = async (): Promise<void> => {
    if (!host) return
    await window.tek.adblock.allowSite(host, !allowed)
    setAllowed(!allowed)
  }

  return (
    <div className="shield-wrap no-drag">
      <button
        className={`shield ${enabled ? 'is-on' : 'is-off'}`}
        title={enabled ? 'Adblock activo' : 'Adblock desactivado'}
        onClick={() => (open ? closePop() : openPop())}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <path
            d="M12 2.5l7 2.6v5.4c0 4.6-3 8.4-7 9.5-4-1.1-7-4.9-7-9.5V5.1l7-2.6z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          {enabled && (
            <path
              d="M8.5 12l2.3 2.3 4.7-4.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
        {enabled && blocked > 0 && <span className="shield-count">{blocked > 999 ? '999+' : blocked}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="shield-backdrop" onClick={closePop} />
            <motion.div
              className="shield-pop"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            >
              <div className="shield-pop-head">
                <span className="shield-pop-title">Adblock</span>
                <span className="shield-pop-count">
                  {blocked} bloqueado{blocked === 1 ? '' : 's'} aquí
                </span>
              </div>

              <button className="shield-row" onClick={toggleGlobal}>
                <span>Bloqueo global</span>
                <span className={`shield-toggle ${enabled ? 'is-on' : 'is-off'}`}>
                  {enabled ? 'Activo' : 'Apagado'}
                </span>
              </button>

              {host && (
                <button className="shield-row" onClick={toggleSite}>
                  <span className="shield-row-host">
                    Permitir en <b>{host}</b>
                  </span>
                  <span className={`shield-toggle ${allowed ? 'is-on' : 'is-off'}`}>
                    {allowed ? 'Permitido' : 'Bloqueado'}
                  </span>
                </button>
              )}

              {lists &&
                (() => {
                  const { text, warn } = listsLabel(lists.source, lists.updatedAt)
                  return (
                    <div className={`shield-lists ${warn ? 'is-warn' : ''}`}>
                      <span className="dot" />
                      <span>{text}</span>
                    </div>
                  )
                })()}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
