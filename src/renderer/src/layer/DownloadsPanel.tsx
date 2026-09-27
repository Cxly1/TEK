import { useEffect, useRef, useState } from 'react'
import type { DownloadEntry, LayerAnchor } from '@shared/ipc'
import { formatBytes, relTime } from '@/lib/format'
import { Glyph, fileGlyph } from './icons'
import { dropdownPos, useViewportSize } from './position'
import './downloads.css'

const WIDTH = 348

const dl = (): typeof window.tek.downloads => window.tek.downloads

/** % de progreso de una descarga en curso. */
function pct(d: DownloadEntry): number {
  if (!d.total) return 0
  return Math.min(100, Math.round((d.received / d.total) * 100))
}

/** ¿Se puede abrir el archivo con un clic? */
const openable = (d: DownloadEntry): boolean => d.state === 'completed' && !d.missing

/** La segunda linea de cada fila: cuanto y cuando, o que le paso. */
function subline(d: DownloadEntry, now: number): string {
  if (d.state === 'progressing') {
    const size = d.total
      ? `${formatBytes(d.received)} de ${formatBytes(d.total)} · ${pct(d)} %`
      : formatBytes(d.received)
    return d.paused ? `En pausa · ${size}` : size
  }
  if (d.state === 'completed') {
    if (d.missing) return 'Ya no está en tu equipo'
    return `${formatBytes(d.received)} · ${relTime(d.finishedAt ?? d.startedAt, now)}`
  }
  return d.state === 'cancelled' ? 'Cancelada' : 'Interrumpida'
}

/**
 * Descargas, en la capa flotante: cuelga del ☰ sobre la pagina viva. Una sola
 * accion principal —clic en la fila abre el archivo— y lo demas (carpeta,
 * quitar) aparece al pasar el raton. El cepillo limpia la lista (no toca los
 * archivos). Se trae sus propios datos y se entera en vivo del progreso.
 */
export function DownloadsPanel({ anchor }: { anchor: LayerAnchor }): React.JSX.Element {
  const [list, setList] = useState<DownloadEntry[] | null>(null)
  const [active, setActive] = useState(-1)
  const [now, setNow] = useState(Date.now())
  const listRef = useRef<HTMLDivElement>(null)
  useViewportSize()

  useEffect(() => {
    let alive = true
    void dl()
      .list()
      .then((l) => alive && setList(l))
    const off = dl().onState(setList)
    // "hace 5 min" no se queda viejo con el panel abierto.
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      alive = false
      off()
      clearInterval(tick)
    }
  }, [])

  const items = list ?? []
  const clearable = items.some((d) => d.state !== 'progressing')

  const openRow = (d: DownloadEntry): void => {
    if (!openable(d)) return
    void dl().openFile(d.id)
    // Como la burbuja de descargas de Chrome: abrir el archivo cierra el panel.
    window.tek.layer.dismiss()
  }
  const dropRow = (d: DownloadEntry): void => {
    if (d.state === 'progressing') void dl().cancel(d.id)
    else void dl().remove(d.id)
  }

  // Teclado: flechas, Enter abre, Supr quita de la lista, Esc cierra.
  useEffect(() => {
    const n = items.length
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey) {
        if (!['Control', 'Alt', 'Meta', 'Shift'].includes(e.key)) {
          e.preventDefault()
          window.tek.layer.dismiss()
        }
        return
      }
      const d = items[active]
      switch (e.key) {
        case 'ArrowDown':
        case 'Tab':
          e.preventDefault()
          setActive((a) => (n ? (e.key === 'Tab' && e.shiftKey ? (a <= 0 ? n - 1 : a - 1) : (a + 1) % n) : -1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setActive((a) => (n ? (a <= 0 ? n - 1 : a - 1) : -1))
          break
        case 'Home':
          e.preventDefault()
          setActive(n ? 0 : -1)
          break
        case 'End':
          e.preventDefault()
          setActive(n - 1)
          break
        case 'Enter':
          e.preventDefault()
          if (d) openRow(d)
          break
        case 'Delete':
          // Quitar de la lista, nunca cancelar a ciegas una descarga en curso.
          if (d && d.state !== 'progressing') {
            e.preventDefault()
            dropRow(d)
          }
          break
        case 'Escape':
          e.preventDefault()
          window.tek.layer.dismiss()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // La fila resaltada con teclado siempre a la vista.
  useEffect(() => {
    if (active < 0) return
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pos = dropdownPos(anchor, WIDTH)

  return (
    <div
      className="ly-catcher"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) window.tek.layer.dismiss()
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="ly-panel lyd"
        role="dialog"
        aria-label="Descargas"
        style={{ ...pos, width: WIDTH, maxHeight: `min(468px, calc(100vh - ${pos.top + 16}px))` }}
        onPointerLeave={() => setActive(-1)}
      >
        <header className="ly-head">
          <span className="ly-title">Descargas</span>
          <button
            type="button"
            className="ly-iconbtn"
            title="Limpiar la lista (los archivos no se tocan)"
            aria-label="Limpiar la lista"
            disabled={!clearable}
            onClick={() => void dl().clear()}
          >
            <Glyph name="brush" />
          </button>
        </header>
        {list && items.length === 0 ? (
          <p className="ly-empty">Aún no has descargado nada.</p>
        ) : (
          <div className="ly-list" ref={listRef}>
            {items.map((d, i) => {
              const busy = d.state === 'progressing'
              const dead = d.state !== 'progressing' && !openable(d)
              return (
                <div
                  key={d.id}
                  data-idx={i}
                  data-active={i === active ? 'true' : undefined}
                  className={`ly-row lyd-row ${busy ? 'is-busy' : ''} ${dead ? 'is-dead' : ''}`}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={() => openRow(d)}
                >
                  <Glyph name={fileGlyph(d.filename)} className="lyd-lead" />
                  <div className="lyd-text">
                    <span className="lyd-name" title={d.filename}>
                      {d.filename}
                    </span>
                    <span className="lyd-sub">{subline(d, now)}</span>
                    {busy && (
                      <span className="lyd-prog">
                        <i style={{ width: `${pct(d)}%` }} />
                      </span>
                    )}
                  </div>
                  <div className="ly-acts">
                    {openable(d) && (
                      <button
                        type="button"
                        className="ly-iconbtn"
                        title="Mostrar en la carpeta"
                        aria-label="Mostrar en la carpeta"
                        onClick={(e) => {
                          e.stopPropagation()
                          void dl().showInFolder(d.id)
                        }}
                      >
                        <Glyph name="folder" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="ly-iconbtn is-danger"
                      title={busy ? 'Cancelar la descarga' : 'Quitar de la lista'}
                      aria-label={busy ? 'Cancelar la descarga' : 'Quitar de la lista'}
                      onClick={(e) => {
                        e.stopPropagation()
                        dropRow(d)
                      }}
                    >
                      <Glyph name="x" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
