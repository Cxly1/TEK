import { useEffect, useMemo, useRef } from 'react'
import type { LayerAnchor, LayerContent, LayerKind } from '@shared/ipc'
import { useTek } from '@/store'
import { useTheme } from '@/lib/theme'
import { buildToolsModel, runToolsPick } from './ToolsMenu'

/** El ☰ de la barra: de el cuelgan el menu y Descargas. */
function toolsAnchor(): LayerAnchor {
  const el = document.querySelector<HTMLElement>('[data-anchor="tools"]')
  if (!el) return { x: window.innerWidth - 150, y: 5, width: 30, height: 28 }
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

/**
 * Controla la capa flotante (menu ☰, Descargas, Historial), que se pinta en su
 * propia vista nativa encima de la pagina viva (FloatingLayer + LayerSurface).
 * El estado sigue viviendo en el store (toolsMenuOpen / downloadsOpen /
 * historyOpen): este componente lo traduce a abrir, repintar o cerrar la capa,
 * y devuelve al store lo que pasa alli (se eligio algo, o se cerro sola).
 */
export function LayerController(): null {
  const menuOpen = useTek((s) => s.toolsMenuOpen)
  const downloadsOpen = useTek((s) => s.downloadsOpen)
  const historyOpen = useTek((s) => s.historyOpen)
  const pending = useTek((s) => s.update.pending)
  const exclusive = useTek((s) => s.media.exclusive)
  const activeDl = useTek((s) => s.downloads.filter((d) => d.state === 'progressing').length)
  const unseenDone = useTek(
    (s) =>
      s.downloads.filter(
        (d) => d.state === 'completed' && d.finishedAt != null && d.finishedAt > s.downloadsSeenAt
      ).length
  )
  const dlBadge = activeDl || unseenDone
  const theme = useTheme()

  const kind: LayerKind | null = menuOpen
    ? 'menu'
    : downloadsOpen
      ? 'downloads'
      : historyOpen
        ? 'history'
        : null

  const content = useMemo<LayerContent | null>(() => {
    if (kind === 'history') return { kind }
    if (kind === 'downloads') return { kind, anchor: toolsAnchor() }
    if (kind === 'menu') {
      return {
        kind,
        model: buildToolsModel(toolsAnchor(), { pending, exclusive, dlBadge, theme })
      }
    }
    return null
  }, [kind, pending, exclusive, dlBadge, theme])

  // Que esta abierto en la capa ahora mismo (segun lo que le pedimos).
  const shown = useRef<LayerKind | null>(null)
  useEffect(() => {
    if (!content) {
      if (shown.current) {
        shown.current = null
        window.tek.layer.close()
      }
      return
    }
    if (shown.current !== content.kind) {
      shown.current = content.kind
      void window.tek.layer.open(content)
    } else {
      window.tek.layer.update(content)
    }
  }, [content])

  useEffect(
    () =>
      window.tek.layer.onEvent((e) => {
        if (e.type === 'pick') {
          runToolsPick(e.id)
          return
        }
        // Se cerro sola (clic fuera, Esc, Alt+Tab, abrir un archivo...): el
        // shell se pone al dia.
        shown.current = null
        const st = useTek.getState()
        if (st.toolsMenuOpen) st.closeToolsMenu()
        if (st.downloadsOpen) st.closeDownloads()
        if (st.historyOpen) st.closeHistory()
      }),
    []
  )

  return null
}
