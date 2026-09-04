import { create } from 'zustand'
import type {
  DevServer,
  DownloadEntry,
  FeedbackDraft,
  FillAvailable,
  FindResult,
  MediaState,
  PasswordOffer,
  RecipeToastInfo,
  Routine,
  TabMeta,
  TabsState,
  UpdateState,
  UserProfile
} from '@shared/ipc'

export type Phase = 'genesis' | 'shell'

interface TekState {
  phase: Phase
  paletteOpen: boolean
  /** Texto con el que arranca el palette al abrirse (p. ej. la tecla que disparo la apertura). */
  seed: string
  /**
   * Si el `seed` debe salir SELECCIONADO al abrir (estilo barra de direcciones:
   * escribir lo reemplaza, Ctrl+C lo copia). Falso cuando el seed es la tecla
   * que disparo la apertura, porque ahi el cursor tiene que quedar detras.
   */
  seedSelected: boolean
  /** Si hay sesion previa por reanudar: numero de pestanas. null = sin prompt. */
  resume: number | null
  /** Rutina detectada para esta franja, pendiente de abrir. null = nada. */
  routine: Routine | null
  /** Panel "lo que TEK sabe de ti" abierto. */
  brainOpen: boolean
  /** Panel de descargas abierto. */
  downloadsOpen: boolean
  /** Panel de historial abierto. */
  historyOpen: boolean
  /** Panel de automatizacion abierto. */
  automationOpen: boolean
  /** Panel de contrasenas abierto. */
  passwordsOpen: boolean
  /** Panel de novedades (que cambio en esta version) abierto. */
  newsOpen: boolean
  /** Panel de "reportar un fallo" abierto. */
  feedbackOpen: boolean
  /** Menu unico de herramientas (☰ de la barra) desplegado. */
  toolsMenuOpen: boolean
  /** INTERFERENCIA (el arcade) en pantalla. */
  arcadeOpen: boolean
  /** Perfil de quien usa TEK. null = todavia no llego del main. */
  profile: UserProfile | null
  /** Version de TEK en marcha ('' hasta que llega del main). Decide las novedades. */
  version: string
  setVersion: (v: string) => void
  /** Reporte a medio escribir. Vive aqui para que cerrar el panel no lo borre. */
  feedbackDraft: FeedbackDraft
  setFeedbackDraft: (patch: Partial<FeedbackDraft>) => void
  /** Tutorial guiado (spotlight) en pantalla. */
  tourOpen: boolean
  /** Pantalla que pregunta tu nombre (primer arranque o "cambiar mi nombre"). */
  welcomeOpen: boolean
  /** Barra "buscar en pagina" (Ctrl+F) abierta. */
  findOpen: boolean
  /** Resultado actual de la busqueda en pagina (coincidencia activa / total). */
  findResult: FindResult
  /** Descargas (activas + historial), empujadas desde el main. */
  downloads: DownloadEntry[]
  /** Marca de tiempo de la ultima vez que se abrio el panel de descargas: las
   *  completadas despues de esto cuentan como "no vistas" para el badge. */
  downloadsSeenAt: number
  /** Servers locales detectados por el radar (push del main). */
  devServers: DevServer[]
  /** Receta disparada esperando confirmacion (toast con cuenta atras). */
  recipeToast: RecipeToastInfo | null
  /** Oferta de guardar contrasena (NUNCA contiene la contrasena). */
  pwOffer: PasswordOffer | null
  /** Credenciales disponibles para el sitio de una pestana (toast de relleno). */
  fillAvail: FillAvailable | null
  /** Estado de la actualizacion de TEK (lo empuja el main). */
  update: UpdateState
  /** Aviso pasajero tras buscar a mano ("ya estas al dia"). '' = ninguno. */
  updateNote: string
  /** "Ahora suena" + modo "una sola pestana a la vez" (lo empuja el main). */
  media: MediaState
  /** Grabacion de macro en curso (indicador REC). */
  recording: boolean
  /** Grupos (por host) plegados en la barra. */
  collapsedGroups: Record<string, boolean>
  tabs: TabMeta[]
  activeId: string | null
  setPhase: (p: Phase) => void
  setResume: (count: number | null) => void
  setRoutine: (r: Routine | null) => void
  toggleGroup: (host: string) => void
  openBrain: () => void
  closeBrain: () => void
  openDownloads: () => void
  closeDownloads: () => void
  openHistory: () => void
  closeHistory: () => void
  openAutomation: () => void
  closeAutomation: () => void
  openPasswords: () => void
  closePasswords: () => void
  openNews: () => void
  closeNews: () => void
  openFeedback: () => void
  closeFeedback: () => void
  openToolsMenu: () => void
  closeToolsMenu: () => void
  openArcade: () => void
  closeArcade: () => void
  setProfile: (p: UserProfile) => void
  openTour: () => void
  closeTour: () => void
  openWelcome: () => void
  closeWelcome: () => void
  openFind: () => void
  closeFind: () => void
  setFindResult: (r: FindResult) => void
  setDownloads: (list: DownloadEntry[]) => void
  setDevServers: (list: DevServer[]) => void
  setRecipeToast: (t: RecipeToastInfo | null) => void
  setPwOffer: (o: PasswordOffer | null) => void
  setFillAvail: (f: FillAvailable | null) => void
  setUpdate: (u: UpdateState) => void
  setUpdateNote: (note: string) => void
  setMedia: (m: MediaState) => void
  setRecording: (rec: boolean) => void
  openPalette: (seed?: string, seedSelected?: boolean) => void
  closePalette: () => void
  togglePalette: () => void
  setTabs: (state: TabsState) => void
}

export const useTek = create<TekState>((set, get) => ({
  phase: 'genesis',
  paletteOpen: false,
  seed: '',
  seedSelected: false,
  resume: null,
  routine: null,
  brainOpen: false,
  downloadsOpen: false,
  historyOpen: false,
  automationOpen: false,
  passwordsOpen: false,
  newsOpen: false,
  feedbackOpen: false,
  toolsMenuOpen: false,
  arcadeOpen: false,
  profile: null,
  version: '',
  setVersion: (v) => set({ version: v }),
  feedbackDraft: { message: '', contact: '', includeSite: false },
  setFeedbackDraft: (patch) => set({ feedbackDraft: { ...get().feedbackDraft, ...patch } }),
  tourOpen: false,
  welcomeOpen: false,
  findOpen: false,
  findResult: { active: 0, total: 0 },
  downloads: [],
  // Al arrancar, marcamos "todo visto": el historial viejo no debe inflar el badge.
  downloadsSeenAt: Date.now(),
  devServers: [],
  recipeToast: null,
  pwOffer: null,
  fillAvail: null,
  update: { phase: 'idle', version: '', notes: '', percent: 0, error: '', pending: '' },
  updateNote: '',
  media: { now: null, exclusive: false },
  recording: false,
  collapsedGroups: {},
  tabs: [],
  activeId: null,
  setPhase: (phase) => set({ phase }),
  setResume: (resume) => set({ resume }),
  setRoutine: (routine) => set({ routine }),
  toggleGroup: (host) =>
    set((s) => ({ collapsedGroups: { ...s.collapsedGroups, [host]: !s.collapsedGroups[host] } })),
  openBrain: () => {
    void window.tek.setVisible(false)
    set({ brainOpen: true, downloadsOpen: false, historyOpen: false, automationOpen: false, passwordsOpen: false, toolsMenuOpen: false })
  },
  closeBrain: () => {
    void window.tek.setVisible(true)
    set({ brainOpen: false })
  },
  openDownloads: () => {
    void window.tek.setVisible(false)
    // Abrir el panel = "ya las vi": limpia el badge de completadas no vistas.
    set({ downloadsOpen: true, downloadsSeenAt: Date.now(), historyOpen: false, brainOpen: false, automationOpen: false, passwordsOpen: false, toolsMenuOpen: false })
  },
  closeDownloads: () => {
    void window.tek.setVisible(true)
    set({ downloadsOpen: false })
  },
  openHistory: () => {
    void window.tek.setVisible(false)
    set({ historyOpen: true, downloadsOpen: false, brainOpen: false, automationOpen: false, passwordsOpen: false, toolsMenuOpen: false })
  },
  closeHistory: () => {
    void window.tek.setVisible(true)
    set({ historyOpen: false })
  },
  openAutomation: () => {
    void window.tek.setVisible(false)
    set({ automationOpen: true, brainOpen: false, downloadsOpen: false, historyOpen: false, passwordsOpen: false, toolsMenuOpen: false })
  },
  closeAutomation: () => {
    void window.tek.setVisible(true)
    set({ automationOpen: false })
  },
  openPasswords: () => {
    void window.tek.setVisible(false)
    set({ passwordsOpen: true, brainOpen: false, downloadsOpen: false, historyOpen: false, automationOpen: false, toolsMenuOpen: false })
  },
  closePasswords: () => {
    void window.tek.setVisible(true)
    set({ passwordsOpen: false })
  },
  openNews: () => {
    void window.tek.setVisible(false)
    // Abrirlas ES haberlas visto: se apaga el punto del megafono para siempre en
    // esta version. Se guarda en el perfil, no solo en memoria.
    //
    // Con una version pendiente el punto NO se apaga (sigues teniendo una
    // vieja), pero deja de latir: haberla visto anunciada basta para que no siga
    // llamando la atencion. Las dos marcas viajan en la misma escritura.
    const st = get()
    const version = st.version
    const pending = st.update.pending
    const patch: Partial<UserProfile> = {}
    if (version && st.profile?.newsSeen !== version) patch.newsSeen = version
    if (pending && st.profile?.updateSeen !== pending) patch.updateSeen = pending
    if (Object.keys(patch).length) {
      void window.tek.profile.set(patch).then(get().setProfile)
    }
    set({ newsOpen: true, feedbackOpen: false, brainOpen: false, downloadsOpen: false, historyOpen: false, automationOpen: false, passwordsOpen: false, toolsMenuOpen: false })
  },
  closeNews: () => {
    void window.tek.setVisible(true)
    set({ newsOpen: false })
  },
  openFeedback: () => {
    void window.tek.setVisible(false)
    set({ feedbackOpen: true, newsOpen: false, brainOpen: false, downloadsOpen: false, historyOpen: false, automationOpen: false, passwordsOpen: false, toolsMenuOpen: false })
  },
  closeFeedback: () => {
    void window.tek.setVisible(true)
    set({ feedbackOpen: false })
  },
  openToolsMenu: () => {
    // Como los paneles: ocultamos la vista para que el desplegable no quede
    // tapado por el WebContentsView nativo (se dibuja por encima del renderer).
    void window.tek.setVisible(false)
    set({ toolsMenuOpen: true })
  },
  closeToolsMenu: () => {
    // Cancelar (clic fuera / Esc): devolvemos la vista. Si se elige una
    // herramienta, el panel correspondiente la mantiene oculta por su cuenta.
    void window.tek.setVisible(true)
    set({ toolsMenuOpen: false })
  },
  openArcade: () => {
    // Como los paneles: la vista nativa se dibuja por encima del renderer, asi
    // que hay que apartarla o el juego quedaria debajo de la pagina.
    void window.tek.setVisible(false)
    set({
      arcadeOpen: true,
      toolsMenuOpen: false,
      paletteOpen: false,
      brainOpen: false,
      downloadsOpen: false,
      historyOpen: false,
      automationOpen: false,
      passwordsOpen: false,
      newsOpen: false,
      feedbackOpen: false
    })
  },
  closeArcade: () => {
    // El main decide si la vista vuelve de verdad: si la pestana esta en blanco
    // o su carga fallo, se queda oculta y detras aparece el lienzo que toque.
    void window.tek.setVisible(true)
    set({ arcadeOpen: false })
  },
  setProfile: (profile) => set({ profile }),
  openTour: () => {
    // Como los paneles: la vista nativa tapa al renderer, y el tutorial señala
    // piezas de la UI de TEK — tiene que verse ENTERA. Cierra lo que estorbe.
    void window.tek.setVisible(false)
    set({
      tourOpen: true,
      toolsMenuOpen: false,
      paletteOpen: false,
      brainOpen: false,
      downloadsOpen: false,
      historyOpen: false,
      automationOpen: false,
      passwordsOpen: false
    })
  },
  closeTour: () => {
    void window.tek.setVisible(true)
    set({ tourOpen: false })
  },
  openWelcome: () => {
    void window.tek.setVisible(false)
    set({ welcomeOpen: true, tourOpen: false })
  },
  closeWelcome: () => {
    void window.tek.setVisible(true)
    set({ welcomeOpen: false })
  },
  openFind: () => {
    // A diferencia de los paneles, la barra de busqueda NO oculta la vista: el
    // main la baja para dejar la franja visible (hay que ver la pagina al buscar).
    void window.tek.find.setOpen(true)
    set({ findOpen: true })
  },
  closeFind: () => {
    void window.tek.find.setOpen(false)
    set({ findOpen: false, findResult: { active: 0, total: 0 } })
  },
  setFindResult: (findResult) => set({ findResult }),
  setDownloads: (downloads) => set({ downloads }),
  setDevServers: (devServers) => set({ devServers }),
  setRecipeToast: (recipeToast) => set({ recipeToast }),
  setPwOffer: (pwOffer) => set({ pwOffer }),
  setFillAvail: (fillAvail) => set({ fillAvail }),
  setUpdate: (update) => set({ update }),
  setUpdateNote: (updateNote) => set({ updateNote }),
  setMedia: (media) => set({ media }),
  setRecording: (recording) => set({ recording }),
  openPalette: (seed = '', seedSelected = false) => {
    void window.tek.setVisible(false)
    set({ paletteOpen: true, seed, seedSelected })
  },
  closePalette: () => {
    // El main decide si la vista vuelve (no vuelve si la pestana esta en blanco).
    void window.tek.setVisible(true)
    set({ paletteOpen: false, seed: '', seedSelected: false })
  },
  togglePalette: () =>
    set((s) => {
      const next = !s.paletteOpen
      void window.tek.setVisible(!next)
      return { paletteOpen: next, seed: '', seedSelected: false }
    }),
  setTabs: (state) => set({ tabs: state.tabs, activeId: state.activeId })
}))

/** Pestana activa derivada del estado (o undefined si no hay). */
export function useActiveTab(): TabMeta | undefined {
  return useTek((s) => s.tabs.find((t) => t.id === s.activeId))
}
