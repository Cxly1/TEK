import type { LayerAnchor, MenuItem, MenuModel } from '@shared/ipc'
import { useTek } from '@/store'

/**
 * Menu unico de herramientas (☰ de la barra): QUE lleva y QUE hace cada opcion.
 * Pintarlo es cosa de la capa flotante (MenuPanel), encima de la pagina viva;
 * abrirlo y cerrarlo, del LayerController.
 *
 * Arriba solo lo que se usa a diario; lo demas vive en "Más opciones".
 */
export function buildToolsModel(
  anchor: LayerAnchor,
  s: { pending: string; exclusive: boolean; dlBadge: number }
): MenuModel {
  const daily: MenuItem[] = [
    { id: 'history', icon: 'history', label: 'Historial', hint: 'Lo que has visitado' },
    {
      id: 'downloads',
      icon: 'download',
      label: 'Descargas',
      hint: 'Tus archivos',
      badge: s.dlBadge || undefined
    },
    { id: 'pw', icon: 'key', label: 'Contraseñas', hint: 'Vault cifrado' }
  ]
  // Con una version esperando, deja de ser una pregunta escondida en "Más
  // opciones" y sube a la vista como respuesta (la marca vive en el megafono,
  // pero quien abra el menu tampoco tiene que adivinarlo).
  if (s.pending) {
    daily.push({
      id: 'update',
      icon: 'refresh',
      label: `Actualizar a TEK ${s.pending}`,
      hint: 'Ya publicada · la tienes en Novedades',
      dot: true
    })
  }
  const extras: MenuItem[] = [
    {
      id: 'arcade',
      icon: 'gamepad',
      label: 'INTERFERENCIA',
      hint: 'El arcade · también sale cuando algo no carga'
    },
    { id: 'tour', icon: 'route', label: 'Repetir tutorial', hint: 'El paseo guiado · y tu nombre' }
  ]
  if (!s.pending) {
    extras.push({
      id: 'update',
      icon: 'refresh',
      label: 'Buscar actualizaciones',
      hint: 'Nada se descarga sin permiso'
    })
  }
  return {
    anchor,
    pages: [
      {
        id: 'root',
        groups: [daily, [{ id: 'more', icon: 'more', label: 'Más opciones', page: 'more' }]]
      },
      {
        id: 'more',
        title: 'Más opciones',
        groups: [
          [
            {
              id: 'auto',
              icon: 'zap',
              label: 'Automatización',
              hint: 'Recetas · workspaces · macros'
            },
            { id: 'brain', icon: 'sparkles', label: 'Lo que TEK sabe de ti', hint: 'Tu perfil' },
            {
              id: 'audio1',
              icon: 'music',
              label: 'Una pestaña a la vez',
              hint: s.exclusive
                ? 'Encendido: al sonar una pestaña, TEK pausa las demás'
                : 'Apagado: pueden sonar varias pestañas a la vez',
              toggle: s.exclusive
            }
          ],
          extras
        ]
      }
    ]
  }
}

/** Ejecuta lo elegido en el menu. Todo menos el interruptor cierra el menu. */
export function runToolsPick(id: string): void {
  const st = useTek.getState()
  if (id === 'audio1') {
    // Interruptor en sitio: el menu sigue abierto y se repinta con el estado nuevo.
    void window.tek.media.setExclusive(!st.media.exclusive).then(st.setMedia)
    return
  }
  st.closeToolsMenu()
  if (id === 'history') st.openHistory()
  else if (id === 'downloads') st.openDownloads()
  else if (id === 'pw') st.openPasswords()
  else if (id === 'auto') st.openAutomation()
  else if (id === 'brain') st.openBrain()
  else if (id === 'arcade') st.openArcade()
  else if (id === 'tour') st.openTour()
  else if (id === 'update') {
    if (st.update.pending) {
      st.openNews()
      return
    }
    // Buscar a mano: el main solo MIRA (no descarga). Si no hay nada nuevo no
    // llega ningun evento, asi que el "ya estas al dia" sale del resultado de la
    // llamada; el resto de fases las pinta el toast solo.
    st.setUpdateNote('Buscando actualizaciones…')
    void window.tek.update.check().then((u) => {
      useTek.getState().setUpdateNote(u.phase === 'idle' ? 'Ya tienes la última versión de TEK.' : '')
    })
  }
}
