// La base (layer.css) va ANTES que los paneles: sus hojas la afinan encima.
import './layer.css'
import { useEffect, useRef, useState } from 'react'
import type { LayerContent, LayerKind } from '@shared/ipc'
import { MenuPanel } from './MenuPanel'
import { DownloadsPanel } from './DownloadsPanel'
import { HistoryPanel } from './HistoryPanel'

/**
 * La capa flotante: una vista nativa TRANSPARENTE encima de la pagina (ver
 * FloatingLayer en el main), donde viven el menu ☰, Descargas e Historial. Por
 * eso la pagina sigue viva detras en vez de quedarse en negro. Se monta con
 * `?surface=layer` (ver main.tsx).
 *
 * Una cosa a la vez. Cada apertura (o cambio de panel) REMONTA el panel, que
 * nace limpio; un repintado con el mismo panel abierto (cambio un interruptor,
 * llego una descarga) solo le pasa los datos nuevos.
 */
export function LayerSurface(): React.JSX.Element | null {
  const [content, setContent] = useState<LayerContent | null>(null)
  const [openKey, setOpenKey] = useState(0)
  const openRef = useRef<LayerKind | null>(null)

  useEffect(() => {
    const apply = (c: LayerContent | null): void => {
      if (!c) {
        openRef.current = null
        setContent(null)
        return
      }
      if (openRef.current !== c.kind) {
        openRef.current = c.kind
        setOpenKey((k) => k + 1)
      }
      setContent(c)
    }
    let alive = true
    // La capa puede terminar de cargar DESPUES del primer open: pregunta al montar
    // (y esa pregunta es tambien su forma de decirle al main "ya estoy").
    void window.tek.layer.current().then((c) => {
      if (alive && c && !openRef.current) apply(c)
    })
    const off = window.tek.layer.onShow(apply)
    return () => {
      alive = false
      off()
    }
  }, [])

  if (!content) return null
  if (content.kind === 'menu') return <MenuPanel key={openKey} model={content.model} />
  if (content.kind === 'downloads') return <DownloadsPanel key={openKey} anchor={content.anchor} />
  return <HistoryPanel key={openKey} />
}
