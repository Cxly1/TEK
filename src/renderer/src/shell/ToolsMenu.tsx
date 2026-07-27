import { useEffect } from 'react'
import { motion } from 'motion/react'
import { useTek } from '@/store'
import './toolsmenu.css'

/**
 * Menu unico de herramientas del navegador (☰ de la barra). Reune lo que antes
 * vivia disperso (botones sueltos ⚡/✦ + Historial/Descargas de la 2a fila + la
 * paleta): Historial, Descargas, Contrasenas, Automatizacion y "Lo que TEK sabe
 * de ti". La vista se oculta mientras esta abierto (lo hace el store) para que el
 * desplegable no quede tapado por el WebContentsView nativo.
 */
export function ToolsMenu(): React.JSX.Element {
  const closeToolsMenu = useTek((s) => s.closeToolsMenu)
  const openHistory = useTek((s) => s.openHistory)
  const openDownloads = useTek((s) => s.openDownloads)
  const openPasswords = useTek((s) => s.openPasswords)
  const openAutomation = useTek((s) => s.openAutomation)
  const openBrain = useTek((s) => s.openBrain)
  const openTour = useTek((s) => s.openTour)
  const openNews = useTek((s) => s.openNews)
  const pending = useTek((s) => s.update.pending)
  const setUpdateNote = useTek((s) => s.setUpdateNote)
  const exclusive = useTek((s) => s.media.exclusive)
  const setMedia = useTek((s) => s.setMedia)
  const activeDl = useTek((s) => s.downloads.filter((d) => d.state === 'progressing').length)
  const unseenDone = useTek((s) =>
    s.downloads.filter(
      (d) => d.state === 'completed' && d.finishedAt != null && d.finishedAt > s.downloadsSeenAt
    ).length
  )
  const dlBadge = activeDl || unseenDone

  // Esc cierra el menu (igual que clic fuera).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeToolsMenu()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeToolsMenu])

  // Buscar a mano: el main solo MIRA (no descarga). Si no hay nada nuevo no
  // llega ningun evento, asi que el "ya estas al dia" lo damos con el resultado
  // que devuelve la llamada; el resto de fases las pinta el toast solo.
  const checkUpdates = (): void => {
    closeToolsMenu()
    setUpdateNote('Buscando actualizaciones…')
    void window.tek.update.check().then((s) => {
      if (s.phase === 'idle') setUpdateNote('Ya tienes la última versión de TEK.')
      else setUpdateNote('')
    })
  }

  // Novedades y Reportar un fallo NO viven aqui: tienen su propio boton en la
  // barra (ver NewsButtons). Dentro del menu no se veian, que era justo el
  // problema.
  const items: { id: string; icon: string; label: string; sub: string; run: () => void; badge?: number }[] = [
    { id: 'history', icon: '↺', label: 'Historial', sub: 'lo que has visitado', run: openHistory },
    { id: 'downloads', icon: '↧', label: 'Descargas', sub: 'tus archivos', run: openDownloads, badge: dlBadge },
    { id: 'pw', icon: '⚿', label: 'Contraseñas', sub: 'vault cifrado', run: openPasswords },
    { id: 'auto', icon: '⚡', label: 'Automatización', sub: 'recetas · workspaces · macros', run: openAutomation },
    { id: 'brain', icon: '✦', label: 'Lo que TEK sabe de ti', sub: 'tu perfil', run: openBrain },
    {
      id: 'audio1',
      icon: '♫',
      label: 'Una pestaña sonando a la vez',
      sub: exclusive ? 'activado — al sonar una, TEK pausa las demás' : 'desactivado',
      // Toggle en sitio: el menu se queda abierto para ver el cambio.
      run: () => void window.tek.media.setExclusive(!exclusive).then(setMedia)
    },
    { id: 'tour', icon: '◎', label: 'Repetir tutorial', sub: 'el paseo guiado · y tu nombre', run: openTour },
    // Con una version esperando, la entrada deja de ser una pregunta y pasa a
    // ser la respuesta: la marca vive en el megafono, pero quien abra el menu
    // tampoco tiene que adivinarlo.
    pending
      ? {
          id: 'update',
          icon: '⟲',
          label: `Actualizar a TEK ${pending}`,
          sub: 'ya publicada · la tienes en Novedades',
          run: openNews
        }
      : {
          id: 'update',
          icon: '⟲',
          label: 'Buscar actualizaciones',
          sub: 'nada se descarga sin permiso',
          run: checkUpdates
        }
  ]

  return (
    <div className="tm-overlay" onMouseDown={closeToolsMenu}>
      <motion.div
        className="tm-menu"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: -8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      >
        {items.map((it) => (
          <button key={it.id} className="tm-item" onClick={it.run}>
            <span className="tm-icon">{it.icon}</span>
            <span className="tm-label">{it.label}</span>
            {it.badge ? <span className="tm-badge">{it.badge}</span> : null}
            <span className="tm-sub">{it.sub}</span>
          </button>
        ))}
      </motion.div>
    </div>
  )
}
