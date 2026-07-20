import { useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useTek } from '@/store'
import type { DownloadEntry } from '@shared/ipc'
import { useArrowNav, type NavItemProps } from '@/lib/useArrowNav'
import { formatBytes } from '@/lib/format'
import './downloads.css'

/** % de progreso de una descarga (100 si ya termino). */
function pct(d: DownloadEntry): number {
  if (d.state === 'completed') return 100
  if (!d.total) return 0
  return Math.min(100, Math.round((d.received / d.total) * 100))
}

const dl = (): typeof window.tek.downloads => window.tek.downloads

function Row({ d, navProps }: { d: DownloadEntry; navProps: NavItemProps }): React.JSX.Element {
  const active = d.state === 'progressing'
  const done = d.state === 'completed'
  const meta = active
    ? `${formatBytes(d.received)}${d.total ? ' / ' + formatBytes(d.total) : ''}`
    : done
      ? formatBytes(d.received)
      : d.state === 'cancelled'
        ? 'Cancelada'
        : 'Interrumpida'
  return (
    <div className={`dl-row knav-item is-${d.state}`} {...navProps}>
      <div className="dl-main">
        <span className="dl-name" title={d.filename}>
          {d.filename}
        </span>
        <span className="dl-meta">{meta}</span>
        {active && (
          <span className="dl-bar">
            <span className="dl-bar-fill" style={{ width: `${pct(d)}%` }} />
          </span>
        )}
      </div>
      <div className="dl-actions">
        {active ? (
          <button className="dl-act dl-x" title="Cancelar" onClick={() => dl().cancel(d.id)}>
            ✕
          </button>
        ) : (
          <>
            {done && (
              <button className="dl-act" title="Abrir archivo" onClick={() => dl().openFile(d.id)}>
                Abrir
              </button>
            )}
            <button className="dl-act" title="Ver en carpeta" onClick={() => dl().showInFolder(d.id)}>
              Carpeta
            </button>
            <button className="dl-act dl-x" title="Quitar de la lista" onClick={() => dl().remove(d.id)}>
              ✕
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Panel de descargas: se abre desde el boton ⬇ de la barra. Lista las descargas
 * activas (con barra de progreso) y el historial, con Abrir / Ver en carpeta /
 * quitar. La vista nativa esta oculta mientras esta abierto (como el palette).
 */
export function DownloadsPanel(): React.JSX.Element {
  const close = useTek((s) => s.closeDownloads)
  const downloads = useTek((s) => s.downloads)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // ↑↓ recorre las descargas; Enter abre el archivo (o lo muestra en la carpeta).
  const nav = useArrowNav({
    rowLengths: downloads.map(() => 1),
    onActivate: (i) => {
      const d = downloads[i]
      if (!d) return
      if (d.state === 'completed') void dl().openFile(d.id)
      else void dl().showInFolder(d.id)
    }
  })
  useEffect(() => {
    panelRef.current?.focus()
  }, [])
  return (
    <div className="dl-overlay" onMouseDown={close}>
      <motion.div
        className="dl-panel"
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={nav.onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      >
        <header className="dl-head">
          <span className="dl-title">Descargas</span>
          {downloads.length > 0 && (
            <button className="dl-clear" onClick={() => dl().clear()}>
              Limpiar
            </button>
          )}
        </header>
        {downloads.length === 0 ? (
          <p className="dl-empty">Aún no has descargado nada.</p>
        ) : (
          <div className="dl-list">
            {downloads.map((d, i) => (
              <Row key={d.id} d={d} navProps={nav.itemProps(i)} />
            ))}
          </div>
        )}
      </motion.div>
    </div>
  )
}
