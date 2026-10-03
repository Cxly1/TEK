import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type TekApi,
  type TabsState,
  type DownloadEntry,
  type DevServer,
  type FillAvailable,
  type FindResult,
  type MediaState,
  type LayerContent,
  type LayerEvent,
  type PasswordOffer,
  type PipState,
  type RecipeToastInfo,
  type UiCommand,
  type UpdateState
} from '@shared/ipc'
import { isThemeName, type ThemeName } from '@shared/theme'

// --- Apariencia: se aplica ANTES de que la pagina pinte ---------------------
// El tema se pide SINCRONO y se marca en <html data-theme> en cuanto existe el
// documento: los tokens de tokens.css cuelgan de ese atributo, asi que ninguna
// superficie de TEK (shell, capa flotante, barra del mini-player) enseña ni un
// fotograma con los colores de otro tema. Los cambios llegan por evento y se
// aplican aqui mismo, sin esperar a React; lo que pinta en canvas lo lee del
// mismo atributo.
let theme: ThemeName = 'noche'
try {
  const t: unknown = ipcRenderer.sendSync(IPC.themeGet)
  if (isThemeName(t)) theme = t
} catch {
  /* sin main que conteste (no deberia pasar): Noche */
}
const themeListeners = new Set<(t: ThemeName) => void>()
function markTheme(): boolean {
  const el = document.documentElement
  if (!el) return false
  el.dataset.theme = theme
  return true
}
if (!markTheme()) {
  // En document-start aun no hay <html>: se marca en cuanto el parser lo crea.
  const mo = new MutationObserver(() => {
    if (markTheme()) mo.disconnect()
  })
  mo.observe(document, { childList: true })
}
ipcRenderer.on(IPC.themeChanged, (_e, t: unknown) => {
  if (!isThemeName(t) || t === theme) return
  theme = t
  markTheme()
  for (const cb of themeListeners) cb(t)
})

// --- Quieto: nadie mira la barra ---------------------------------------------
// El main avisa cuando la ventana pierde el foco, la pestana que ves suena o una
// pagina esta en pantalla completa; <html data-quieto> congela las animaciones
// sin fin del shell (shell.css). Directo al atributo, sin pasar por React.
ipcRenderer.on(IPC.shellQuiet, (_e, on: unknown) => {
  document.documentElement?.toggleAttribute('data-quieto', on === true)
})

/** Suscripcion estandar a un evento main->renderer. Devuelve el des-suscriptor. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: TekApi = {
  navigate: (url) => ipcRenderer.invoke(IPC.navigate, url),
  goBack: () => ipcRenderer.invoke(IPC.goBack),
  goForward: () => ipcRenderer.invoke(IPC.goForward),
  reload: () => ipcRenderer.invoke(IPC.reload),
  stop: () => ipcRenderer.invoke(IPC.stop),
  setVisible: (visible) => ipcRenderer.invoke(IPC.setVisible, visible),
  setBottomInset: (source, px) => ipcRenderer.send(IPC.setBottomInset, source, px),
  tabs: {
    create: (url) => ipcRenderer.invoke(IPC.tabNew, url),
    close: (id) => ipcRenderer.invoke(IPC.tabClose, id),
    activate: (id) => ipcRenderer.invoke(IPC.tabActivate, id),
    home: () => ipcRenderer.invoke(IPC.tabHome),
    setMuted: (id, muted) => ipcRenderer.invoke(IPC.tabSetMuted, id, muted),
    reopen: () => ipcRenderer.invoke(IPC.tabReopen),
    duplicate: (id) => ipcRenderer.invoke(IPC.tabDuplicate, id),
    move: (id, beforeId) => ipcRenderer.invoke(IPC.tabMove, id, beforeId),
    contextMenu: (id) => ipcRenderer.invoke(IPC.tabContextMenu, id)
  },
  profile: {
    get: () => ipcRenderer.invoke(IPC.profileGet),
    set: (patch) => ipcRenderer.invoke(IPC.profileSet, patch)
  },
  arcade: {
    stats: () => ipcRenderer.invoke(IPC.arcadeStats),
    registrar: (puntos, oleada) => ipcRenderer.invoke(IPC.arcadeSubmit, puntos, oleada),
    setMudo: (mudo) => ipcRenderer.invoke(IPC.arcadeSetMuted, mudo)
  },
  version: () => ipcRenderer.invoke(IPC.appVersion),
  feedback: {
    send: (draft) => ipcRenderer.invoke(IPC.feedbackSend, draft)
  },
  session: {
    peek: () => ipcRenderer.invoke(IPC.sessionPeek),
    restore: () => ipcRenderer.invoke(IPC.sessionRestore),
    discard: () => ipcRenderer.invoke(IPC.sessionDiscard)
  },
  win: {
    minimize: () => ipcRenderer.invoke(IPC.winMinimize),
    maximizeToggle: () => ipcRenderer.invoke(IPC.winMaximizeToggle),
    close: () => ipcRenderer.invoke(IPC.winClose)
  },
  adblock: {
    status: () => ipcRenderer.invoke(IPC.adblockStatus),
    toggle: (enabled) => ipcRenderer.invoke(IPC.adblockToggle, enabled),
    siteAllowed: (host) => ipcRenderer.invoke(IPC.adblockSiteAllowed, host),
    allowSite: (host, allowed) => ipcRenderer.invoke(IPC.adblockAllowSite, host, allowed)
  },
  brain: {
    suggestions: (limit) => ipcRenderer.invoke(IPC.brainSuggestions, limit),
    music: () => ipcRenderer.invoke(IPC.brainMusic),
    routineForNow: () => ipcRenderer.invoke(IPC.brainRoutineForNow),
    profile: () => ipcRenderer.invoke(IPC.brainProfile),
    setPaused: (paused) => ipcRenderer.invoke(IPC.brainSetPaused, paused),
    forget: (host) => ipcRenderer.invoke(IPC.brainForget, host),
    wipe: () => ipcRenderer.invoke(IPC.brainWipe),
    history: (opts) => ipcRenderer.invoke(IPC.brainHistory, opts),
    pastQueries: (q, limit) => ipcRenderer.invoke(IPC.brainQueries, q, limit),
    deleteVisit: (id) => ipcRenderer.invoke(IPC.brainDeleteVisit, id),
    clearHistory: (sinceMs) => ipcRenderer.invoke(IPC.brainClearHistory, sinceMs),
    ignore: (host) => ipcRenderer.invoke(IPC.brainIgnore, host),
    unignore: (host) => ipcRenderer.invoke(IPC.brainUnignore, host),
    ignored: () => ipcRenderer.invoke(IPC.brainIgnored)
  },
  downloads: {
    list: () => ipcRenderer.invoke(IPC.downloadsList),
    openFile: (id) => ipcRenderer.invoke(IPC.downloadsOpenFile, id),
    showInFolder: (id) => ipcRenderer.invoke(IPC.downloadsShowInFolder, id),
    cancel: (id) => ipcRenderer.invoke(IPC.downloadsCancel, id),
    remove: (id) => ipcRenderer.invoke(IPC.downloadsRemove, id),
    clear: () => ipcRenderer.invoke(IPC.downloadsClear),
    onState: (cb: (list: DownloadEntry[]) => void) => {
      const listener = (_e: unknown, list: DownloadEntry[]): void => cb(list)
      ipcRenderer.on(IPC.downloadsState, listener)
      return () => ipcRenderer.removeListener(IPC.downloadsState, listener)
    }
  },
  find: {
    start: (text, opts) => ipcRenderer.invoke(IPC.findStart, text, opts),
    stop: () => ipcRenderer.invoke(IPC.findStop),
    setOpen: (open) => ipcRenderer.invoke(IPC.findSetOpen, open)
  },
  dev: {
    servers: () => ipcRenderer.invoke(IPC.devServers),
    scan: () => ipcRenderer.invoke(IPC.devScan),
    settings: () => ipcRenderer.invoke(IPC.devSettingsGet),
    setSettings: (patch) => ipcRenderer.invoke(IPC.devSettingsSet, patch),
    onServers: (cb: (servers: DevServer[]) => void) => on(IPC.devServersState, cb)
  },
  auto: {
    state: () => ipcRenderer.invoke(IPC.autoState),
    saveRecipe: (r) => ipcRenderer.invoke(IPC.autoSaveRecipe, r),
    deleteRecipe: (id) => ipcRenderer.invoke(IPC.autoDeleteRecipe, id),
    runRecipe: (id) => ipcRenderer.invoke(IPC.autoRunRecipe, id),
    saveWorkspace: (w) => ipcRenderer.invoke(IPC.autoSaveWorkspace, w),
    deleteWorkspace: (id) => ipcRenderer.invoke(IPC.autoDeleteWorkspace, id),
    openWorkspace: (id) => ipcRenderer.invoke(IPC.autoOpenWorkspace, id),
    workspaceFromTabs: (name) => ipcRenderer.invoke(IPC.autoWorkspaceFromTabs, name),
    saveSnippet: (s) => ipcRenderer.invoke(IPC.autoSaveSnippet, s),
    deleteSnippet: (id) => ipcRenderer.invoke(IPC.autoDeleteSnippet, id),
    runSnippet: (id) => ipcRenderer.invoke(IPC.autoRunSnippet, id),
    saveSiteScript: (s) => ipcRenderer.invoke(IPC.autoSaveSiteScript, s),
    deleteSiteScript: (id) => ipcRenderer.invoke(IPC.autoDeleteSiteScript, id),
    saveWatcher: (w) => ipcRenderer.invoke(IPC.autoSaveWatcher, w),
    deleteWatcher: (id) => ipcRenderer.invoke(IPC.autoDeleteWatcher, id),
    checkWatcher: (id) => ipcRenderer.invoke(IPC.autoCheckWatcher, id),
    deleteMacro: (id) => ipcRenderer.invoke(IPC.autoDeleteMacro, id),
    runMacro: (id) => ipcRenderer.invoke(IPC.autoRunMacro, id),
    recordStart: () => ipcRenderer.invoke(IPC.autoRecordStart),
    recordStop: (name) => ipcRenderer.invoke(IPC.autoRecordStop, name),
    onToast: (cb: (t: RecipeToastInfo) => void) => on(IPC.autoToast, cb),
    onRecState: (cb: (recording: boolean) => void) => on(IPC.autoRecState, cb)
  },
  bridge: {
    status: () => ipcRenderer.invoke(IPC.bridgeStatus),
    setEnabled: (onOff) => ipcRenderer.invoke(IPC.bridgeSetEnabled, onOff)
  },
  perms: {
    list: () => ipcRenderer.invoke(IPC.permsList),
    revoke: (origin, permission) => ipcRenderer.invoke(IPC.permsRevoke, origin, permission)
  },
  privacy: {
    clear: (scope) => ipcRenderer.invoke(IPC.privacyClear, scope),
    clearHost: (host) => ipcRenderer.invoke(IPC.privacyClearHost, host)
  },
  passwords: {
    status: () => ipcRenderer.invoke(IPC.pwStatus),
    list: () => ipcRenderer.invoke(IPC.pwList),
    reveal: (id) => ipcRenderer.invoke(IPC.pwReveal, id),
    remove: (id) => ipcRenderer.invoke(IPC.pwDelete, id),
    removeNever: (host) => ipcRenderer.invoke(IPC.pwRemoveNever, host),
    decision: (offerId, action) => ipcRenderer.invoke(IPC.pwDecision, offerId, action),
    fill: (tabId, credId) => ipcRenderer.invoke(IPC.pwFill, tabId, credId),
    setMaster: (next, current) => ipcRenderer.invoke(IPC.pwSetMaster, next, current),
    unlock: (password) => ipcRenderer.invoke(IPC.pwUnlock, password),
    lock: () => ipcRenderer.invoke(IPC.pwLock),
    onOffer: (cb: (o: PasswordOffer) => void) => on(IPC.pwOffer, cb),
    onFillAvailable: (cb: (f: FillAvailable) => void) => on(IPC.pwFillAvailable, cb)
  },
  pip: {
    enter: (tabId) => ipcRenderer.invoke(IPC.pipEnter, tabId),
    toggle: () => ipcRenderer.invoke(IPC.pipToggle),
    exit: () => ipcRenderer.invoke(IPC.pipExit),
    backToTab: () => ipcRenderer.invoke(IPC.pipBackToTab),
    toggleFloat: () => ipcRenderer.invoke(IPC.pipToggleFloat),
    toggleMinimize: () => ipcRenderer.invoke(IPC.pipToggleMinimize),
    setMuted: (muted) => ipcRenderer.invoke(IPC.pipSetMuted, muted),
    moveBy: (dx, dy) => ipcRenderer.invoke(IPC.pipMoveBy, dx, dy),
    snap: () => ipcRenderer.invoke(IPC.pipSnap),
    state: () => ipcRenderer.invoke(IPC.pipGetState),
    onState: (cb: (s: PipState) => void) => on(IPC.pipState, cb)
  },
  update: {
    check: () => ipcRenderer.invoke(IPC.updateCheck),
    download: () => ipcRenderer.invoke(IPC.updateDownload),
    install: () => ipcRenderer.invoke(IPC.updateInstall),
    dismiss: () => ipcRenderer.invoke(IPC.updateDismiss),
    onState: (cb: (s: UpdateState) => void) => on(IPC.updateState, cb)
  },
  media: {
    state: () => ipcRenderer.invoke(IPC.mediaGetState),
    playPause: () => ipcRenderer.invoke(IPC.mediaPlayPause),
    next: () => ipcRenderer.invoke(IPC.mediaNext),
    prev: () => ipcRenderer.invoke(IPC.mediaPrev),
    setExclusive: (on) => ipcRenderer.invoke(IPC.mediaSetExclusive, on),
    onState: (cb: (s: MediaState) => void) => on(IPC.mediaState, cb)
  },
  layer: {
    open: (content) => ipcRenderer.invoke(IPC.layerOpen, content),
    update: (content) => ipcRenderer.send(IPC.layerUpdate, content),
    close: () => ipcRenderer.send(IPC.layerClose),
    onEvent: (cb: (e: LayerEvent) => void) => on(IPC.layerEvent, cb),
    current: () => ipcRenderer.invoke(IPC.layerCurrent),
    onShow: (cb: (c: LayerContent | null) => void) => on(IPC.layerShow, cb),
    pick: (id, keepOpen) => ipcRenderer.send(IPC.layerPick, id, keepOpen),
    dismiss: () => ipcRenderer.send(IPC.layerDismiss)
  },
  theme: {
    get: () => theme,
    set: (t) => ipcRenderer.invoke(IPC.themeSet, t),
    onChange: (cb) => {
      themeListeners.add(cb)
      return () => themeListeners.delete(cb)
    }
  },
  onTabsState: (cb: (state: TabsState) => void) => {
    const listener = (_e: unknown, state: TabsState): void => cb(state)
    ipcRenderer.on(IPC.tabsState, listener)
    return () => ipcRenderer.removeListener(IPC.tabsState, listener)
  },
  onTabsFavicons: (cb: (icons: Record<string, string>) => void) => on(IPC.tabsFavicons, cb),
  onFound: (cb: (r: FindResult) => void) => {
    const listener = (_e: unknown, r: FindResult): void => cb(r)
    ipcRenderer.on(IPC.foundInPage, listener)
    return () => ipcRenderer.removeListener(IPC.foundInPage, listener)
  },
  onUiCommand: (cb: (cmd: UiCommand) => void) => {
    const listener = (_e: unknown, cmd: UiCommand): void => cb(cmd)
    ipcRenderer.on(IPC.uiCommand, listener)
    return () => ipcRenderer.removeListener(IPC.uiCommand, listener)
  }
}

contextBridge.exposeInMainWorld('tek', api)
