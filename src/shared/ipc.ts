/**
 * Contrato IPC unico, compartido entre main y renderer.
 * Regla del proyecto: ningun canal "magico" con strings sueltos.
 * Todo canal vive aqui, con su payload tipado.
 */

/** Altura de la TopBar (px). La WebContentsView arranca debajo de esta linea. */
export const TOPBAR_HEIGHT = 80

/** Canales renderer -> main (invoke) y eventos main -> renderer (send). */
export const IPC = {
  // Navegacion de la pestana activa
  navigate: 'view:navigate',
  goBack: 'view:goBack',
  goForward: 'view:goForward',
  reload: 'view:reload',
  stop: 'view:stop',
  /** Oculta/muestra la vista activa (la ocultamos cuando abre un overlay como el palette). */
  setVisible: 'view:setVisible',
  /** Reserva una franja inferior (px) encogiendo la vista para que un toast del
   *  renderer quede visible sobre la pagina (la vista nativa tapa el renderer). */
  setBottomInset: 'view:setBottomInset',
  // Buscar en la pagina (Ctrl+F)
  findStart: 'view:findStart',
  findStop: 'view:findStop',
  findSetOpen: 'view:findSetOpen',

  // Pestanas
  tabNew: 'tabs:new',
  tabClose: 'tabs:close',
  tabActivate: 'tabs:activate',
  tabHome: 'tabs:home',
  tabSetMuted: 'tabs:setMuted',
  tabReopen: 'tabs:reopen',
  tabDuplicate: 'tabs:duplicate',
  tabMove: 'tabs:move',
  tabContextMenu: 'tabs:contextMenu',

  // Perfil de quien usa TEK (nombre para el saludo + tutorial visto)
  profileGet: 'profile:get',
  profileSet: 'profile:set',
  /** Version de TEK que se esta ejecutando (para las novedades). */
  appVersion: 'app:version',
  /** Manda un reporte de fallo a quien mantiene TEK. */
  feedbackSend: 'feedback:send',

  // Sesion guardada (reanudar al arrancar)
  sessionPeek: 'session:peek',
  sessionRestore: 'session:restore',
  sessionDiscard: 'session:discard',

  // Controles de ventana (frameless)
  winMinimize: 'win:minimize',
  winMaximizeToggle: 'win:maximizeToggle',
  winClose: 'win:close',

  // Adblock
  adblockStatus: 'adblock:status',
  adblockToggle: 'adblock:toggle',
  adblockSiteAllowed: 'adblock:siteAllowed',
  adblockAllowSite: 'adblock:allowSite',

  // Cerebro de TEK (aprendizaje local)
  brainSuggestions: 'brain:suggestions',
  brainMusic: 'brain:music',
  brainRoutineForNow: 'brain:routineForNow',
  brainProfile: 'brain:profile',
  brainSetPaused: 'brain:setPaused',
  brainForget: 'brain:forget',
  brainWipe: 'brain:wipe',
  // Historial + control manual del aprendizaje
  brainHistory: 'brain:history',
  brainQueries: 'brain:queries',
  brainDeleteVisit: 'brain:deleteVisit',
  brainClearHistory: 'brain:clearHistory',
  brainIgnore: 'brain:ignore',
  brainUnignore: 'brain:unignore',
  brainIgnored: 'brain:ignored',

  // Descargas
  downloadsList: 'downloads:list',
  downloadsOpenFile: 'downloads:openFile',
  downloadsShowInFolder: 'downloads:showInFolder',
  downloadsCancel: 'downloads:cancel',
  downloadsRemove: 'downloads:remove',
  downloadsClear: 'downloads:clear',

  // Dev: radar de servers locales + ajustes de desarrollo
  devServers: 'dev:servers',
  devScan: 'dev:scan',
  devSettingsGet: 'dev:settingsGet',
  devSettingsSet: 'dev:settingsSet',

  // Automatizacion: recetas, workspaces, snippets, scripts de sitio, watchers, macros
  autoState: 'auto:state',
  autoSaveRecipe: 'auto:saveRecipe',
  autoDeleteRecipe: 'auto:deleteRecipe',
  autoRunRecipe: 'auto:runRecipe',
  autoSaveWorkspace: 'auto:saveWorkspace',
  autoDeleteWorkspace: 'auto:deleteWorkspace',
  autoOpenWorkspace: 'auto:openWorkspace',
  autoWorkspaceFromTabs: 'auto:workspaceFromTabs',
  autoSaveSnippet: 'auto:saveSnippet',
  autoDeleteSnippet: 'auto:deleteSnippet',
  autoRunSnippet: 'auto:runSnippet',
  autoSaveSiteScript: 'auto:saveSiteScript',
  autoDeleteSiteScript: 'auto:deleteSiteScript',
  autoSaveWatcher: 'auto:saveWatcher',
  autoDeleteWatcher: 'auto:deleteWatcher',
  autoCheckWatcher: 'auto:checkWatcher',
  autoDeleteMacro: 'auto:deleteMacro',
  autoRunMacro: 'auto:runMacro',
  autoRecordStart: 'auto:recordStart',
  autoRecordStop: 'auto:recordStop',

  // Puente para agentes (servidor HTTP local, opt-in)
  bridgeStatus: 'bridge:status',
  bridgeSetEnabled: 'bridge:setEnabled',

  // Permisos de sitio (camara/micro/ubicacion/notificaciones...)
  permsList: 'perms:list',
  permsRevoke: 'perms:revoke',

  // Privacidad: borrar datos de navegacion (cookies/cache/storage de Chromium)
  privacyClear: 'privacy:clear',
  privacyClearHost: 'privacy:clearHost',

  // Contrasenas (vault cifrado con safeStorage)
  pwStatus: 'pw:status',
  pwList: 'pw:list',
  pwReveal: 'pw:reveal',
  pwDelete: 'pw:delete',
  pwRemoveNever: 'pw:removeNever',
  pwDecision: 'pw:decision',
  pwFill: 'pw:fill',
  // Contrasena maestra (capa opcional sobre el cifrado del sistema)
  pwSetMaster: 'pw:setMaster',
  pwUnlock: 'pw:unlock',
  pwLock: 'pw:lock',

  // Mini-player (Picture-in-Picture): ver un video mientras navegas en otra pestana
  pipEnter: 'pip:enter',
  pipToggle: 'pip:toggle',
  pipExit: 'pip:exit',
  pipBackToTab: 'pip:backToTab',
  pipToggleFloat: 'pip:toggleFloat',
  pipToggleMinimize: 'pip:toggleMinimize',
  pipSetMuted: 'pip:setMuted',
  pipMoveBy: 'pip:moveBy',
  pipSnap: 'pip:snap',
  pipGetState: 'pip:getState',

  // Actualizacion de la app
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateDismiss: 'update:dismiss',

  // Musica / "Ahora suena" (controla la pestana que esta sonando)
  mediaGetState: 'media:getState',
  mediaPlayPause: 'media:playPause',
  mediaNext: 'media:next',
  mediaPrev: 'media:prev',
  mediaSetExclusive: 'media:setExclusive',

  // Eventos main -> renderer
  tabsState: 'tabs:state',
  downloadsState: 'downloads:state',
  /** Resultado de "buscar en pagina" (coincidencia activa / total). */
  foundInPage: 'view:foundInPage',
  /** El main pide al renderer una accion de UI (atajo con la pagina enfocada). */
  uiCommand: 'ui:command',
  /** Estado del radar de servers locales (push al cambiar). */
  devServersState: 'dev:serversState',
  /** Una receta disparada pide confirmacion con cuenta atras. */
  autoToast: 'auto:toast',
  /** Grabacion de macro encendida/apagada (para el indicador REC). */
  autoRecState: 'auto:recState',
  /** Oferta de guardar una contrasena capturada (NUNCA incluye la contrasena). */
  pwOffer: 'pw:offer',
  /** Hay credenciales guardadas para el sitio cargado en una pestana. */
  pwFillAvailable: 'pw:fillAvailable',
  /** Estado del mini-player (Picture-in-Picture): push al shell y a la barra del mini. */
  pipState: 'pip:state',
  /** Estado de la actualizacion (hay version nueva, bajando, lista para reiniciar). */
  updateState: 'update:state',
  /** Estado de "ahora suena" (que pestana suena, con que metadatos). */
  mediaState: 'media:state'
} as const

/**
 * Canales internos main <-> preload de webview. NO forman parte de TekApi:
 * los usa el preload de las paginas (webview.ts los lleva inline para seguir
 * siendo autocontenido; estos espejos son para el lado main).
 */
export const WV = {
  /**
   * El main manda a la LUPA lo que pidio el teclado: 'in' | 'out' | 'reset'
   * (Ctrl + / - / 0). El gesto —pinch y Ctrl+rueda— no pasa por aqui: lo lee y
   * lo aplica el propio preload, que es donde vive la lupa.
   */
  zoomCmd: 'wv:zoomCmd',
  /** El preload capturo un envio de credenciales (submit de login). */
  pwCaptured: 'wv:pwCaptured',
  /** El main manda credenciales a rellenar (solo tras clic del usuario). */
  pwFillCreds: 'wv:pwFillCreds',
  /** El preload avisa si la pagina tiene (o deja de tener) un campo de login
   *  visible. Sin esto, TEK ofrecia rellenar en paginas sin ningun formulario. */
  pwFormPresent: 'wv:pwFormPresent',
  /** El preload reporta un paso de macro mientras se graba. */
  macroEvent: 'wv:macroEvent',
  /** El main enciende/apaga el modo grabacion en la pagina. */
  macroMode: 'wv:macroMode',
  /** El preload pregunta al cargar si SU pestana esta grabando. */
  macroIsRecording: 'wv:macroIsRecording',
  /**
   * El preload pregunta (SINCRONO, al cargar) si este sitio esta permitido en el
   * escudo. Si lo esta, TEK no toca la pagina EN ABSOLUTO: ni filtrado de red ni
   * defusers de anuncios. Sincrono a proposito: la respuesta decide si se
   * parchean globales antes de que la pagina ejecute su primer script.
   */
  siteUntouched: 'wv:siteUntouched',
  /**
   * El preload pide (SINCRONO, en document_start) los scriptlets del adblock
   * para su URL — los `+js(...)` de las listas de uBO. Tienen que ejecutarse
   * ANTES del primer script de la pagina (asi lo hacen uBO y Brave): el camino
   * del adaptador de Ghostery va por webContents.executeJavaScript, que espera
   * a did-stop-loading, y a YouTube le daba tiempo de sobra a disparar su muro
   * anti-adblock antes de que llegara el desarme.
   */
  adScripts: 'wv:adScripts',
  /**
   * El preload reporta los metadatos de MediaSession de su pagina (titulo,
   * artista, caratula, si esta sonando y que acciones soporta el sitio).
   */
  mediaMeta: 'wv:mediaMeta',
  /** El main manda una accion de reproduccion a la pagina (playpause/pause/next/prev). */
  mediaControl: 'wv:mediaControl'
} as const

/** Metadatos de una pestana, tal como el renderer los necesita para pintar. */
export interface TabMeta {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** true = pestana nueva sin pagina (muestra el lienzo "nueva pestana"). */
  blank: boolean
  /** Clave de grupo (host del sitio). '' = sin grupo (pestana en blanco). */
  group: string
  /** true si la pestana esta reproduciendo audio ahora mismo. */
  audible: boolean
  /** true si el audio de la pestana esta silenciado. */
  muted: boolean
  /** nº de anuncios/trackers bloqueados en la carga actual de esta pestana. */
  blocked: number
  /** data URL del favicon del sitio (o null si aun no se ha capturado). */
  favicon?: string | null
  /** true si esta pestana esta ahora mismo en el mini-player (Picture-in-Picture). */
  pip?: boolean
}

/** De donde salio el motor de adblock activo (para diagnostico). */
export type AdblockSource = 'cache' | 'snapshot' | 'baseline' | 'live'

/** Estado del adblock para la pestana activa. */
export interface AdblockStatus {
  /** Bloqueo global activado. */
  enabled: boolean
  /** El motor ya cargo (cache/snapshot/baseline/listas). */
  ready: boolean
  /**
   * Origen del motor: `cache` (refresco previo guardado), `snapshot` (listas
   * empaquetadas con la app), `baseline` (los ~30 dominios embebidos, proteccion
   * minima) o `live` (listas frescas de esta sesion). `baseline` = algo va mal.
   */
  source: AdblockSource
  /** Fecha (ms) de las listas activas, o null si es el baseline embebido. */
  updatedAt: number | null
}

/** Resumen de la sesion guardada que se ofrece reanudar al arrancar. */
export interface SessionPeek {
  count: number
}

// --- Perfil de usuario -----------------------------------------------------

/**
 * Quien usa TEK. Se pregunta UNA vez, en el primer arranque, y solo sirve para
 * saludar por su nombre y para saber si ya vio el tutorial guiado. Vive en local
 * (userData/tek-profile.json): no se manda a ningun sitio.
 */
export interface UserProfile {
  /** Nombre con el que TEK saluda. '' = prefirio no decirlo. */
  name: string
  /** Ya se pregunto el nombre (aunque lo dejara vacio): no volver a preguntar. */
  greeted: boolean
  /** Ya vio el tutorial guiado (se puede repetir desde el menu ☰). */
  tourDone: boolean
  /**
   * Ultima version cuyas novedades ya vio ('' = ninguna). En una instalacion
   * nueva se marca con la version actual al arrancar: estrenar TEK no es
   * "novedad", asi que nadie ve un aviso el primer dia.
   */
  newsSeen: string
  /**
   * Version pendiente de instalar que ya viste anunciada en Novedades ('' =
   * ninguna). Solo decide si el punto del megafono LATE o se queda quieto: el
   * punto no se apaga hasta que actualices de verdad, pero dejar de latir
   * despues de haberlo visto evita que de la lata durante dias.
   */
  updateSeen: string
  /** Primer arranque (ms epoch). */
  createdAt: number
}

// --- Reportar un fallo -----------------------------------------------------

/** Lo que la persona escribe en el panel de "Reportar un fallo". */
export interface FeedbackDraft {
  /** Que le paso. Es lo unico obligatorio. */
  message: string
  /** Como responderle, si quiere dejarlo. Puede ir vacio. */
  contact: string
  /** Adjuntar el sitio donde estaba. Solo si lo marca (por defecto NO). */
  includeSite: boolean
}

/** Resultado del envio, ya en lenguaje de persona. */
export interface FeedbackResult {
  ok: boolean
  /** Que decirle: el error explicado, o el acuse de recibo. */
  note: string
  /** El reporte tal cual se iba a enviar, para poder copiarlo si fallo. */
  text: string
}

// --- Cerebro de TEK --------------------------------------------------------

/** Un sitio sugerido (ranking por frecency, sensible a la franja horaria). */
export interface Suggestion {
  host: string
  url: string
  title: string
  score: number
  /** data URL del favicon del sitio (si TEK lo tiene cacheado). */
  favicon?: string | null
}

/** Lo ultimo que sono / lo que mas suena. */
export interface MusicNow {
  host: string
  url: string
  title: string
  at: number
}
export interface MusicTop {
  title: string
  host: string
  count: number
}
export interface MusicInfo {
  last: MusicNow | null
  top: MusicTop[]
}

/** Una rutina detectada: secuencia de sitios que sueles abrir en una franja. */
export interface RoutineStep {
  host: string
  url: string
  title: string
}
export interface Routine {
  /** Franja: 'manana' | 'tarde' | 'noche' | 'madrugada'. */
  bucket: string
  steps: RoutineStep[]
  /** Cuantas veces se ha observado esta rutina. */
  support: number
}

/** Foto de todo lo que TEK ha aprendido (para el panel de privacidad). */
export interface BrainProfile {
  paused: boolean
  totalVisits: number
  bucket: string
  topSites: Suggestion[]
  topMusic: MusicTop[]
  routines: Routine[]
}

/** Estado global de pestanas que el main empuja al renderer. */
export interface TabsState {
  tabs: TabMeta[]
  activeId: string | null
}

// --- Descargas -------------------------------------------------------------

/** Estado de una descarga. */
export type DownloadState = 'progressing' | 'completed' | 'cancelled' | 'interrupted'

/** Una descarga, activa o ya en el historial de descargas. */
export interface DownloadEntry {
  id: string
  filename: string
  url: string
  savePath: string
  /** Bytes totales (0 si el servidor no lo informa). */
  total: number
  received: number
  state: DownloadState
  paused: boolean
  startedAt: number
  finishedAt: number | null
}

// --- Historial -------------------------------------------------------------

/** Una entrada del historial de navegacion (una visita registrada). */
export interface HistoryEntry {
  id: number
  host: string
  url: string
  title: string
  at: number
  /** data URL del favicon del sitio (si TEK lo tiene cacheado). */
  favicon?: string | null
}

// --- Dev: radar de servers locales ------------------------------------------

/** Un server de desarrollo detectado escuchando en localhost. */
export interface DevServer {
  port: number
  /** http://localhost:<puerto> */
  url: string
  /** <title> de la respuesta si fue HTML; '' si no se pudo leer. */
  title: string
  /** Codigo HTTP que devolvio. */
  status: number
}

/** Ajustes de desarrollo (persistidos en tek-settings.json). */
export interface DevSettings {
  /** Abrir DevTools automaticamente al navegar a localhost. */
  autoDevtoolsLocalhost: boolean
  /** Puente para agentes encendido (servidor HTTP local). */
  bridgeEnabled: boolean
}

// --- Automatizacion: recetas, workspaces, snippets, scripts, watchers, macros

/** Disparador de una receta. */
export type RecipeTrigger =
  | { type: 'manual' }
  | { type: 'startup' }
  /** A una hora concreta. `at` = "HH:MM"; `days` 0-6 (domingo=0); vacio = todos. */
  | { type: 'time'; at: string; days?: number[] }
  /** Al visitar un host (exacto o subdominio). */
  | { type: 'visit'; host: string }
  /** Al detectar un server local en ese puerto. */
  | { type: 'server'; port: number }

/** Accion de una receta. */
export type RecipeAction =
  | { type: 'openTabs'; urls: string[] }
  | { type: 'openWorkspace'; workspaceId: string }
  | { type: 'notify'; title: string; body?: string }
  | { type: 'runSnippet'; snippetId: string }
  | { type: 'runMacro'; macroId: string }
  | { type: 'openDevtools' }

/** Una receta: disparador -> acciones. La pieza central de la automatizacion. */
export interface Recipe {
  id: string
  name: string
  enabled: boolean
  trigger: RecipeTrigger
  actions: RecipeAction[]
  createdAt: number
  lastRunAt: number | null
}

/** Un workspace de proyecto: set de URLs que se abren juntas. */
export interface Workspace {
  id: string
  name: string
  urls: string[]
  createdAt: number
}

/** Snippet de consola: JS que se ejecuta en la pestana activa. */
export interface Snippet {
  id: string
  name: string
  code: string
  createdAt: number
}

/** Resultado de ejecutar un snippet. */
export interface SnippetResult {
  ok: boolean
  /** Valor devuelto (serializado) si ok; mensaje de error si no. */
  value: string
}

/** Userscript/CSS que se inyecta automaticamente en un sitio. */
export interface SiteScript {
  id: string
  name: string
  /** Host exacto o sufijo: "github.com" aplica tambien a *.github.com. */
  host: string
  enabled: boolean
  js: string
  css: string
  createdAt: number
}

/** Modo de un watcher: cambio de contenido, aparicion de texto, o status HTTP. */
export type WatcherMode = 'change' | 'contains' | 'status'

/** Vigia de una URL: avisa con notificacion nativa cuando pasa algo. */
export interface Watcher {
  id: string
  name: string
  url: string
  mode: WatcherMode
  /** Texto a esperar (solo modo 'contains'). */
  pattern: string
  intervalMin: number
  enabled: boolean
  lastCheckedAt: number | null
  lastChangedAt: number | null
  lastStatus: number | null
  /** Huella del ultimo contenido (interno, para detectar cambios). */
  lastHash: string | null
  /** Ultima observacion legible para la UI. */
  note: string
}

/** Un paso grabado de una macro. */
export type MacroStep =
  | { type: 'goto'; url: string }
  | { type: 'click'; selector: string }
  | { type: 'input'; selector: string; value: string }
  | { type: 'key'; selector: string; key: string }

/** Macro: flujo grabado (clics/teclas) que se puede reproducir. */
export interface Macro {
  id: string
  name: string
  startUrl: string
  steps: MacroStep[]
  createdAt: number
}

/** Foto completa del estado de automatizacion (para el panel). */
export interface AutomationState {
  recipes: Recipe[]
  workspaces: Workspace[]
  snippets: Snippet[]
  siteScripts: SiteScript[]
  watchers: Watcher[]
  macros: Macro[]
  /** Hay una grabacion de macro en curso. */
  recording: boolean
}

/** Una receta disparada pide confirmacion (toast con cuenta atras). */
export interface RecipeToastInfo {
  recipeId: string
  name: string
  /** Resumen legible de lo que hara ("abre 3 pestañas", ...). */
  summary: string
}

// --- Puente para agentes -----------------------------------------------------

/** Estado del puente (servidor HTTP local para Claude Code y otros agentes). */
export interface BridgeStatus {
  enabled: boolean
  running: boolean
  port: number
  /** Token Bearer para autenticarse (solo se muestra en el panel). */
  token: string
}

// --- Permisos de sitio ---------------------------------------------------------

/** Una decision recordada: este host tiene este permiso concedido o bloqueado. */
export interface SitePermission {
  host: string
  /** Nombre del permiso ('media', 'geolocation', 'notifications', ...). */
  permission: string
  allowed: boolean
}

// --- Privacidad ----------------------------------------------------------------

/** Alcance del borrado de datos de navegacion. */
export type ClearScope = 'all' | 'cookies' | 'cache'

// --- Contrasenas ---------------------------------------------------------------

/** Metadatos de una credencial guardada (la contrasena NUNCA viaja en listas). */
export interface PasswordMeta {
  id: string
  host: string
  username: string
  createdAt: number
  updatedAt: number
}

/** Estado del vault. */
export interface PwStatus {
  /** El cifrado del sistema esta disponible; sin el NO se guarda nada. */
  available: boolean
  count: number
  /** Hosts donde el usuario pidio no volver a ofrecer guardar. */
  never: string[]
  /** Hay contrasena maestra configurada (capa extra sobre la del sistema). */
  protected: boolean
  /** Protegida y sin desbloquear: no se puede leer ni guardar nada. */
  locked: boolean
}

/** Resultado de poner/cambiar/quitar la contrasena maestra. */
export interface PwMasterResult {
  ok: boolean
  /** Motivo legible si `ok` es false. */
  error?: string
}

/** Oferta de guardar una credencial recien capturada (sin la contrasena). */
export interface PasswordOffer {
  offerId: string
  host: string
  username: string
  /** Ya existe una credencial para ese host+usuario: seria actualizarla. */
  update: boolean
}

/** Decision del usuario sobre una oferta. */
export type PwDecision = 'save' | 'never' | 'dismiss'

/** Hay credenciales guardadas para el sitio cargado en esta pestana. */
export interface FillAvailable {
  tabId: string
  host: string
  /** Credenciales disponibles (id + usuario) para elegir cual rellenar. */
  creds: { id: string; username: string }[]
}

// --- Mini-player (Picture-in-Picture) --------------------------------------

/** Donde vive el mini-player: acoplado (dentro de TEK) o flotante (ventana del SO). */
export type PipMode = 'docked' | 'floating'

/** Estado del mini-player. Lo consume la barra de control del mini y el shell. */
export interface PipState {
  /** Hay un video en el mini ahora mismo. */
  active: boolean
  /** Pestana cuyo contenido esta en el mini (o null). */
  tabId: string | null
  mode: PipMode
  /** Colapsado a pildora (solo barra; el audio sigue). */
  minimized: boolean
  muted: boolean
  title: string
  host: string
  favicon?: string | null
}

// --- Actualizacion de la app -----------------------------------------------

/**
 * En que punto va la actualizacion. NADA se descarga sin decir que si: de
 * `available` solo se sale por decision de la persona (ver Updater.ts).
 */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  /** Hay version nueva y esperamos respuesta: descargar o ahora no. */
  | 'available'
  | 'downloading'
  /** Descargada y verificada; se instala al cerrar TEK (o reiniciando ya). */
  | 'ready'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** Version que hay disponible (o la que se descargo). '' si no hay. */
  version: string
  /** Notas de la release, recortadas. Puede venir vacio. */
  notes: string
  /** Progreso 0-100 mientras `phase === 'downloading'`. */
  percent: number
  /** Motivo legible cuando `phase === 'error'`. */
  error: string
  /**
   * Version publicada MAS NUEVA que la instalada, si se sabe de alguna. '' si
   * estas al dia.
   *
   * Es aparte de `version` y de `phase` a proposito: `phase` es lo que esta
   * pasando AHORA (se apaga al decir "ahora no" y al reiniciar), mientras que
   * esto es un hecho que sigue siendo verdad hasta que actualices. Es lo que
   * mantiene encendido el punto del megafono; sin ello, quien cerrara el aviso
   * se quedaba sin ninguna senal de que tenia una version vieja.
   */
  pending: string
}

// --- Musica: "Ahora suena" -------------------------------------------------

/** Lo que esta sonando (o lo ultimo que sono), para el chip de la barra. */
export interface NowPlaying {
  /** Pestana duena de la musica (para saltar a ella / mandarle controles). */
  tabId: string
  /** Titulo de la cancion o video (de navigator.mediaSession, con fallback al <title>). */
  title: string
  /** Artista (o '' si el sitio no lo reporta). */
  artist: string
  /** URL http(s) de la caratula, o null si no hay. */
  artwork: string | null
  /** true si esta sonando AHORA; false = pausado (el chip ofrece reanudar). */
  playing: boolean
  /** El sitio registro un handler de "siguiente" (se puede saltar de cancion). */
  canNext: boolean
  canPrev: boolean
  /** Host del sitio que suena ("open.spotify.com", "www.youtube.com"...). */
  host: string
}

export interface MediaState {
  /** null = nada suena ni ha sonado (el chip no se pinta). */
  now: NowPlaying | null
  /** "Una sola pestana sonando a la vez" activado. */
  exclusive: boolean
}

// --- Buscar en pagina / comandos de UI -------------------------------------

/** Resultado de "buscar en pagina". */
export interface FindResult {
  /** Indice (1..total) de la coincidencia activa; 0 si no hay ninguna. */
  active: number
  total: number
}

/** Opciones de findInPage. */
export interface FindOptions {
  forward?: boolean
  findNext?: boolean
  matchCase?: boolean
}

/** Accion de UI que el main pide al renderer cuando la pagina tiene el foco. */
export type UiCommand = 'palette' | 'find' | 'newtab' | 'address'

/** API que el preload expone en window.tek. */
export interface TekApi {
  navigate(url: string): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  reload(): Promise<void>
  stop(): Promise<void>
  setVisible(visible: boolean): Promise<void>
  /** Reserva (px) una franja inferior encogiendo la vista activa; 0 la libera.
   *  Cada `source` reserva por separado (vale el mayor); asi dos toasts no se pisan. */
  setBottomInset(source: string, px: number): void
  tabs: {
    create(url?: string): Promise<void>
    close(id: string): Promise<void>
    activate(id: string): Promise<void>
    home(): Promise<void>
    /** Silencia/reactiva el audio de una pestana. */
    setMuted(id: string, muted: boolean): Promise<void>
    /** Reabre la ultima pestana cerrada (Ctrl+Shift+T). */
    reopen(): Promise<void>
    /** Duplica una pestana (misma URL). */
    duplicate(id: string): Promise<void>
    /** Mueve una pestana: la inserta antes de `beforeId` (o al final con null). */
    move(id: string, beforeId: string | null): Promise<void>
    /** Abre el menu contextual nativo de una pestana. */
    contextMenu(id: string): Promise<void>
  }
  /** Perfil local: el nombre con el que TEK te saluda y si ya viste el tutorial. */
  profile: {
    get(): Promise<UserProfile>
    /** Guarda un cambio parcial y devuelve el perfil resultante. */
    set(patch: Partial<UserProfile>): Promise<UserProfile>
  }
  /** Version de TEK en marcha (la de package.json). */
  version(): Promise<string>
  /** Reportar un fallo a quien mantiene TEK. */
  feedback: {
    /** Manda el reporte. Nunca lanza: el fallo viene contado en el resultado. */
    send(draft: FeedbackDraft): Promise<FeedbackResult>
  }
  session: {
    /** Cuantas pestanas hay guardadas (o null si no hay sesion previa). */
    peek(): Promise<SessionPeek | null>
    /** Recrea las pestanas guardadas. */
    restore(): Promise<void>
    /** Descarta la sesion guardada y arranca limpio. */
    discard(): Promise<void>
  }
  win: {
    minimize(): Promise<void>
    maximizeToggle(): Promise<void>
    close(): Promise<void>
  }
  /** Adblock: estado y control. */
  adblock: {
    /** Estado global (activado / motor listo). */
    status(): Promise<AdblockStatus>
    /** Activa o desactiva el bloqueo global. Devuelve el nuevo estado. */
    toggle(enabled: boolean): Promise<boolean>
    /** ¿El dominio esta en la lista de permitidos? */
    siteAllowed(host: string): Promise<boolean>
    /** Permite (o vuelve a bloquear) anuncios en un dominio. */
    allowSite(host: string, allowed: boolean): Promise<void>
  }
  /** El cerebro de TEK: lo que ha aprendido y como consultarlo. */
  brain: {
    /** Sitios sugeridos para AHORA (frecency + franja horaria). */
    suggestions(limit?: number): Promise<Suggestion[]>
    /** Lo ultimo que sono y lo que mas escuchas. */
    music(): Promise<MusicInfo>
    /** La rutina de la franja actual, si hay una con suficiente soporte. */
    routineForNow(): Promise<Routine | null>
    /** Perfil completo para el panel "lo que TEK sabe de ti". */
    profile(): Promise<BrainProfile>
    /** Pausa/reanuda el aprendizaje. Devuelve el nuevo estado. */
    setPaused(paused: boolean): Promise<boolean>
    /** Olvida todo lo aprendido de un dominio. */
    forget(host: string): Promise<void>
    /** Borra TODO lo aprendido. */
    wipe(): Promise<void>
    /** Historial de navegacion (cronologico, con busqueda opcional). Con
     *  `distinct`: una fila por URL (la mas reciente) y sin hosts basura —
     *  pensado para las sugerencias del ⌘K. */
    history(opts?: {
      query?: string
      limit?: number
      offset?: number
      distinct?: boolean
    }): Promise<HistoryEntry[]>
    /** Busquedas anteriores que casan con `q` (mas recientes primero). */
    pastQueries(q: string, limit?: number): Promise<string[]>
    /** Borra una visita del historial. */
    deleteVisit(id: number): Promise<void>
    /** Borra el historial: todo, o solo desde un instante (ms epoch). */
    clearHistory(sinceMs?: number): Promise<void>
    /** Deja de aprender de un dominio (y olvida lo que ya sabia de el). */
    ignore(host: string): Promise<void>
    /** Vuelve a permitir el aprendizaje de un dominio. */
    unignore(host: string): Promise<void>
    /** Dominios que TEK esta ignorando (no aprende de ellos). */
    ignored(): Promise<string[]>
  }
  /** Descargas: lista, abrir, revelar en carpeta, cancelar, quitar, limpiar. */
  downloads: {
    list(): Promise<DownloadEntry[]>
    openFile(id: string): Promise<void>
    showInFolder(id: string): Promise<void>
    cancel(id: string): Promise<void>
    /** Quita una entrada terminada del historial de descargas. */
    remove(id: string): Promise<void>
    /** Limpia el historial de descargas (no cancela las activas). */
    clear(): Promise<void>
    /** Suscribe al estado de descargas. Devuelve una funcion para desuscribir. */
    onState(cb: (list: DownloadEntry[]) => void): () => void
  }
  /** Buscar en la pagina activa (Ctrl+F). */
  find: {
    start(text: string, opts?: FindOptions): Promise<void>
    stop(): Promise<void>
    /** Abre/cierra la barra de busqueda (el main hace hueco a la vista nativa). */
    setOpen(open: boolean): Promise<void>
  }
  /** Radar de servers locales + ajustes de desarrollo. */
  dev: {
    /** Ultimo estado conocido del radar. */
    servers(): Promise<DevServer[]>
    /** Fuerza un escaneo ahora y devuelve el resultado. */
    scan(): Promise<DevServer[]>
    settings(): Promise<DevSettings>
    setSettings(patch: Partial<DevSettings>): Promise<DevSettings>
    /** Suscribe al estado del radar. Devuelve funcion para desuscribir. */
    onServers(cb: (servers: DevServer[]) => void): () => void
  }
  /** Motor de automatizacion: recetas, workspaces, snippets, scripts, watchers, macros. */
  auto: {
    state(): Promise<AutomationState>
    saveRecipe(r: Recipe): Promise<void>
    deleteRecipe(id: string): Promise<void>
    /** Ejecuta las acciones de una receta ahora. */
    runRecipe(id: string): Promise<void>
    saveWorkspace(w: Workspace): Promise<void>
    deleteWorkspace(id: string): Promise<void>
    openWorkspace(id: string): Promise<void>
    /** Crea un workspace con las pestanas abiertas ahora (no en blanco). */
    workspaceFromTabs(name: string): Promise<Workspace | null>
    saveSnippet(s: Snippet): Promise<void>
    deleteSnippet(id: string): Promise<void>
    /** Ejecuta un snippet en la pestana activa. */
    runSnippet(id: string): Promise<SnippetResult>
    saveSiteScript(s: SiteScript): Promise<void>
    deleteSiteScript(id: string): Promise<void>
    saveWatcher(w: Watcher): Promise<void>
    deleteWatcher(id: string): Promise<void>
    /** Comprueba un watcher ahora; devuelve su estado actualizado. */
    checkWatcher(id: string): Promise<Watcher | null>
    deleteMacro(id: string): Promise<void>
    runMacro(id: string): Promise<void>
    /** Empieza a grabar una macro en la pestana activa. */
    recordStart(): Promise<boolean>
    /** Para la grabacion; con nombre la guarda, con null la descarta. */
    recordStop(name: string | null): Promise<Macro | null>
    /** Toast de receta disparada (cuenta atras en el renderer). */
    onToast(cb: (t: RecipeToastInfo) => void): () => void
    /** Cambios del estado de grabacion (indicador REC). */
    onRecState(cb: (recording: boolean) => void): () => void
  }
  /** Puente para agentes (Claude Code y similares): HTTP local con token. */
  bridge: {
    status(): Promise<BridgeStatus>
    setEnabled(on: boolean): Promise<BridgeStatus>
  }
  /** Permisos de sitio recordados (camara, micro, ubicacion, notificaciones...). */
  perms: {
    list(): Promise<SitePermission[]>
    revoke(host: string, permission: string): Promise<void>
  }
  /** Datos de navegacion de Chromium (cookies, cache, storage): borrarlos. */
  privacy: {
    /** Borra datos globalmente: 'all' (todo), 'cookies' (login/sesion) o 'cache'. */
    clear(scope?: ClearScope): Promise<void>
    /** Borra cookies + storage de un host concreto. */
    clearHost(host: string): Promise<void>
  }
  /** Contrasenas: vault cifrado con el cifrado del sistema (DPAPI). */
  passwords: {
    status(): Promise<PwStatus>
    list(): Promise<PasswordMeta[]>
    /** Descifra y devuelve UNA contrasena (boton "ver" del panel). */
    reveal(id: string): Promise<string | null>
    remove(id: string): Promise<void>
    removeNever(host: string): Promise<void>
    /** Decision sobre una oferta de guardado pendiente. */
    decision(offerId: string, action: PwDecision): Promise<void>
    /** Rellena una credencial en una pestana (solo tras clic del usuario). */
    fill(tabId: string, credId: string): Promise<boolean>
    /** Pone, cambia (`current`) o quita (`next` = null) la contrasena maestra.
     *  Re-cifra toda la boveda; o se hace entera o se queda como estaba. */
    setMaster(next: string | null, current?: string): Promise<PwMasterResult>
    /** Desbloquea la boveda para esta sesion. false = contrasena incorrecta. */
    unlock(password: string): Promise<boolean>
    /** Vuelve a bloquearla ya (tambien se bloquea sola por inactividad). */
    lock(): Promise<void>
    onOffer(cb: (o: PasswordOffer) => void): () => void
    onFillAvailable(cb: (f: FillAvailable) => void): () => void
  }
  /** Mini-player (Picture-in-Picture): ver un video mientras navegas en otra pestana. */
  pip: {
    /** Manda una pestana al mini (sin id = la activa). Nace acoplado dentro de TEK. */
    enter(tabId?: string): Promise<void>
    /** Atajo: manda la pestana activa al mini, o si ya hay uno, lo cierra y vuelve. */
    toggle(): Promise<void>
    /** Cierra el mini; el contenido vuelve a su pestana (en segundo plano). */
    exit(): Promise<void>
    /** Cierra el mini y abre esa pestana a pantalla completa. */
    backToTab(): Promise<void>
    /** Alterna acoplado (dentro de TEK) <-> flotante (ventana del SO). */
    toggleFloat(): Promise<void>
    /** Colapsa a pildora (oculta el video, el audio sigue) y restaura. */
    toggleMinimize(): Promise<void>
    setMuted(muted: boolean): Promise<void>
    /** Arrastre del mini: lo desplaza por delta de pixeles (acoplado o flotante). */
    moveBy(dx: number, dy: number): Promise<void>
    /** Ancla el mini acoplado a la esquina mas cercana (al soltar el arrastre). */
    snap(): Promise<void>
    /** Estado actual (lo pide la barra del mini al montar). */
    state(): Promise<PipState>
    /** Suscribe al estado del mini. Devuelve funcion para desuscribir. */
    onState(cb: (s: PipState) => void): () => void
  }
  /** Actualizacion de TEK. Solo funciona en la app instalada, no en dev. */
  update: {
    /** Busca version nueva AHORA (lo pidio la persona). No descarga nada. */
    check(): Promise<UpdateState>
    /** Descarga la version ofrecida. Solo se llama tras un si explicito. */
    download(): Promise<UpdateState>
    /** Cierra TEK y aplica la actualizacion ya descargada. */
    install(): Promise<void>
    /** "Ahora no": no vuelve a ofrecer sola esta version (la siguiente si). */
    dismiss(): Promise<UpdateState>
    onState(cb: (s: UpdateState) => void): () => void
  }
  /** Musica: el chip "Ahora suena" y el control de la pestana que suena. */
  media: {
    state(): Promise<MediaState>
    /** Pausa/reanuda la pestana que suena (tambien atado a la tecla multimedia). */
    playPause(): Promise<void>
    next(): Promise<void>
    prev(): Promise<void>
    /** Activa/desactiva "una sola pestana sonando a la vez". Devuelve el estado. */
    setExclusive(on: boolean): Promise<MediaState>
    onState(cb: (s: MediaState) => void): () => void
  }
  /** Suscribe al estado de pestanas. Devuelve una funcion para desuscribir. */
  onTabsState(cb: (state: TabsState) => void): () => void
  /** Resultado de la busqueda en pagina. Devuelve funcion para desuscribir. */
  onFound(cb: (r: FindResult) => void): () => void
  /** Comandos de UI desde el main (atajos con la pagina enfocada). */
  onUiCommand(cb: (cmd: UiCommand) => void): () => void
}

/**
 * Nombre corto y legible de un host para mostrar en la UI: sin `www` y sin el
 * TLD ("youtube.com"→"youtube", "en.wikipedia.org"→"en.wikipedia",
 * "accounts.google.com.mx"→"accounts.google"). Heuristica simple (sin PSL): quita
 * la ultima etiqueta y, si queda un marcador de segundo nivel (com/co/...), otra.
 */
export function prettyHost(host: string): string {
  const h = (host || '').replace(/^www\./, '')
  const parts = h.split('.')
  if (parts.length <= 1) return h
  const SECOND = new Set(['com', 'co', 'org', 'net', 'gov', 'gob', 'edu', 'ac', 'mil'])
  parts.pop() // TLD (.com, .ai, .org, .mx…)
  if (parts.length >= 2 && SECOND.has(parts[parts.length - 1])) parts.pop() // .com.mx, .co.uk…
  return parts.join('.') || h
}

/** Host "limpio" de una URL para agrupar (sin www). '' si no es una URL valida. */
export function hostKey(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Normaliza lo que el usuario teclea en el ⌘K a una URL navegable o una busqueda. */
export function toNavigableUrl(input: string): string {
  const raw = input.trim()
  if (raw === '') return 'about:blank'

  // Atajos rapidos: "yt gatos", "gh react"
  const shortcut = /^(yt|gh|g)\s+(.+)$/i.exec(raw)
  if (shortcut) {
    const [, key, rest] = shortcut
    const q = encodeURIComponent(rest)
    if (key.toLowerCase() === 'yt') return `https://www.youtube.com/results?search_query=${q}`
    if (key.toLowerCase() === 'gh') return `https://github.com/search?q=${q}&type=repositories`
    return `https://www.google.com/search?q=${q}`
  }

  // Ya es una URL con protocolo
  if (/^https?:\/\//i.test(raw)) return raw

  // Parece un dominio (tiene punto y sin espacios) -> https directo
  if (/^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(raw) && !raw.includes(' ')) {
    return `https://${raw}`
  }

  // Cualquier otra cosa -> busqueda
  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`
}
