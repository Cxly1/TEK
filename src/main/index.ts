import {
  app,
  BrowserWindow,
  components,
  desktopCapturer,
  ipcMain,
  session,
  shell,
  WebContentsView
} from 'electron'
import { join } from 'node:path'
import {
  IPC,
  WV,
  hostKey,
  type ClearScope,
  type DevSettings,
  type FindOptions,
  type PwDecision,
  type Recipe,
  type SiteScript,
  type Snippet,
  type SnippetResult,
  type UpdateState,
  type UserProfile,
  type Watcher,
  type Workspace
} from '@shared/ipc'
import { ViewManager } from './features/ViewManager'
import { Brain } from './features/brain/Brain'
import { Adblock } from './features/adblock/Adblock'
import { Favicons } from './features/Favicons'
import { Downloads } from './features/Downloads'
import { Passwords } from './features/Passwords'
import { Permissions } from './features/Permissions'
import { Profile } from './features/Profile'
import { Privacy } from './features/Privacy'
import { Updater } from './features/Updater'
import { Media } from './features/Media'
import { Settings } from './features/dev/Settings'
import { DevRadar } from './features/dev/DevRadar'
import { Automation } from './features/dev/Automation'
import { Scripts, evalInPage } from './features/dev/Scripts'
import { Watchers } from './features/dev/Watchers'
import { Macros } from './features/dev/Macros'
import { AgentBridge } from './features/dev/AgentBridge'

const isDev = !app.isPackaged

/** Misma particion persistente que usan las pestanas (ViewManager). */
const PARTITION = 'persist:tek'

let mainWindow: BrowserWindow | null = null
let views: ViewManager | null = null
let brain: Brain | null = null
let adblock: Adblock | null = null
let favicons: Favicons | null = null
let downloads: Downloads | null = null
// Automatizacion + dev (viven a nivel de app; sobreviven a la ventana).
let settings: Settings | null = null
let radar: DevRadar | null = null
let automation: Automation | null = null
let scripts: Scripts | null = null
let watchers: Watchers | null = null
let macros: Macros | null = null
let bridge: AgentBridge | null = null
let passwords: Passwords | null = null
let permissions: Permissions | null = null
let privacy: Privacy | null = null
let userProfile: Profile | null = null
let updater: Updater | null = null
let media: Media | null = null

/** ¿El host es un server local? (auto-DevTools solo aplica ahi). */
function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)
}

/** Manda un evento al renderer del shell (si la ventana sigue viva). */
function sendToShell(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

/**
 * Guardia de canales sensibles: solo el renderer del SHELL (la UI de TEK) puede
 * invocarlos. Los preload de las paginas tambien tienen ipcRenderer; aunque hoy
 * no llaman a estos canales, mejor que el main lo imponga.
 */
function fromShell(e: Electron.IpcMainInvokeEvent): boolean {
  return mainWindow !== null && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents
}

/**
 * Carga la UI de la barra del mini-player (Picture-in-Picture) en su vista nativa.
 * Reusa el bundle del renderer con `?surface=pip`: main.tsx monta la barra en vez
 * del shell. Misma fuente (dev server / file://) que la ventana principal.
 */
function loadPipChrome(view: WebContentsView): void {
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void view.webContents.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?surface=pip`)
  } else {
    void view.webContents.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
      search: 'surface=pip'
    })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#060607',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      // El shell es la UI privilegiada (window.tek incluye contrasenas): va con
      // sandbox + contextIsolation. El preload solo usa ipcRenderer/contextBridge,
      // que funcionan sandboxed.
      sandbox: true,
      contextIsolation: true,
      // Cuando la WebContentsView de una pestana tapa al shell, Chromium marca su
      // webContents como "en segundo plano" y ESTRANGULA timers/rAF: la paleta se
      // queda a medio cerrar (animacion de salida congelada) y el lienzo no se
      // desmonta hasta que un clic despierta el compositor. Sin throttling el shell
      // sigue respondiendo aunque este tapado, asi la paleta se cierra al instante.
      backgroundThrottling: false
    }
  })

  // El shell NUNCA navega: si algo intentara llevar la UI a una URL remota,
  // esa pagina tendria window.tek entero (incluida la API del vault). Solo se
  // permite la carga propia (dev server en dev, file:// en produccion).
  const devUrl = process.env['ELECTRON_RENDERER_URL'] ?? ''
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const ok = (isDev && devUrl && url.startsWith(devUrl)) || url.startsWith('file://')
    if (!ok) e.preventDefault()
  })

  views = new ViewManager(mainWindow, brain!, adblock!, favicons!, loadPipChrome)
  wireAutomation(views)

  // Musica: Media necesita mapear webContents<->pestana, y ViewManager le avisa
  // cuando una pestana empieza a sonar (modo "una sola pestana a la vez").
  if (media) {
    const v = views
    media.attach({
      wcOfTab: (id) => v.wcOfTab(id),
      tabIdOfWcId: (wcId) => v.tabIdOfWcId(wcId),
      audibleTabs: () => v.audibleTabs(),
      activeWc: () => v.activeWc()
    })
    views.onAudibleStart = (tabId) => media?.onAudible(tabId)
  }

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    views?.dispose()
    brain?.dispose()
    adblock?.dispose()
    favicons?.dispose()
    downloads?.dispose()
    settings?.dispose()
    radar?.dispose()
    automation?.dispose()
    scripts?.dispose()
    watchers?.dispose()
    macros?.dispose()
    bridge?.dispose()
    passwords?.dispose()
    permissions?.dispose()
    userProfile?.dispose()
    updater?.dispose()
    // Media sobrevive a la ventana (teclas globales), pero suelta las deps: sin
    // pestanas no hay destino y todo se vuelve no-op limpio.
    media?.attach(null)
    updater = null
    userProfile = null
    permissions = null
    privacy = null
    views = null
    brain = null
    adblock = null
    favicons = null
    downloads = null
    settings = null
    radar = null
    automation = null
    scripts = null
    watchers = null
    macros = null
    bridge = null
    passwords = null
    mainWindow = null
  })

  // Links externos que no van en la vista web: abrir en el navegador del sistema.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Solo esquemas seguros al exterior: nada de file:// ni protocolos que en
    // Windows podrian lanzar un ejecutable.
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

/** Conecta el motor de automatizacion con el navegador (deps + hooks). */
function wireAutomation(v: ViewManager): void {
  if (!automation || !scripts || !macros || !watchers || !radar || !bridge || !passwords) return

  scripts.getActiveWc = () => v.activeWc()

  automation.setDeps({
    openTabs: (urls) => urls.forEach((u) => v.create(u)),
    runSnippet: (id) => scripts!.runSnippet(id),
    runMacro: (id) => macros!.run(id),
    openDevtools: () => v.openDevtoolsActive()
  })

  macros.setDeps({
    getActiveWc: () => v.activeWc(),
    openTabForMacro: (url) => v.wcOfTab(v.createReturning(url))
  })

  watchers.openUrl = (url) => {
    v.create(url)
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  }

  bridge.setDeps({
    listTabs: () => v.tabsForBridge(),
    openTab: (url) => v.createReturning(url),
    activateTab: (id) => v.activate(id),
    closeTab: (id) => v.close(id),
    navigate: (url, tabId) => {
      if (tabId) {
        const wc = v.wcOfTab(tabId)
        if (wc) void wc.loadURL(url).catch(() => undefined)
      } else {
        v.navigate(url)
      }
    },
    evalJs: async (code, tabId): Promise<SnippetResult> => {
      const wc = tabId ? v.wcOfTab(tabId) : v.activeWc()
      if (!wc) return { ok: false, value: 'sin pestaña' }
      return evalInPage(wc, code)
    },
    screenshot: async (tabId) => {
      const wc = tabId ? v.wcOfTab(tabId) : v.activeWc()
      if (!wc) return null
      try {
        return (await wc.capturePage()).toPNG()
      } catch {
        return null
      }
    },
    pageText: async (tabId) => {
      const wc = tabId ? v.wcOfTab(tabId) : v.activeWc()
      if (!wc) return null
      try {
        const text = (await wc.executeJavaScript(
          `(document.body ? document.body.innerText : '').slice(0, 200000)`,
          true
        )) as string
        return { url: wc.getURL(), title: wc.getTitle(), text }
      } catch {
        return null
      }
    }
  })

  // Hooks del navegador hacia la automatizacion.
  v.onNavigate = (_tabId, url, host, wc) => {
    automation!.onVisit(host)
    macros!.handleNavigate(wc.id, url)
  }
  v.onDomReady = (_tabId, wc) => {
    scripts!.applyTo(wc, hostKey(wc.getURL()))
    // El aviso de "hay credenciales guardadas" NO se dispara aqui: solo tiene
    // sentido si la pagina tiene de verdad un campo de login (lo dice el preload
    // en WV.pwFormPresent). Antes salia en cualquier pagina del sitio.
  }
  v.shouldAutoDevtools = (host) =>
    isLocalHost(host) && (settings?.get().autoDevtoolsLocalhost ?? false)
}

function registerIpc(): void {
  ipcMain.handle(IPC.navigate, (_e, url: string) => views?.navigate(url))
  ipcMain.handle(IPC.goBack, () => views?.goBack())
  ipcMain.handle(IPC.goForward, () => views?.goForward())
  ipcMain.handle(IPC.reload, () => views?.reload())
  ipcMain.handle(IPC.stop, () => views?.stop())
  ipcMain.handle(IPC.setVisible, (_e, visible: boolean) => views?.setOverlayVisible(visible))
  // Franja inferior para que un toast del renderer se vea sobre la pagina nativa.
  ipcMain.on(IPC.setBottomInset, (_e, source: string, px: number) =>
    views?.setBottomInset(source, px)
  )
  ipcMain.handle(IPC.tabNew, (_e, url?: string) => views?.create(url))
  ipcMain.handle(IPC.tabClose, (_e, id: string) => views?.close(id))
  ipcMain.handle(IPC.tabActivate, (_e, id: string) => views?.activate(id))
  ipcMain.handle(IPC.tabHome, () => views?.home())
  ipcMain.handle(IPC.tabSetMuted, (_e, id: string, muted: boolean) => views?.setMuted(id, muted))
  ipcMain.handle(IPC.tabReopen, () => views?.reopenClosed())
  ipcMain.handle(IPC.tabDuplicate, (_e, id: string) => views?.duplicate(id))
  ipcMain.handle(IPC.tabMove, (_e, id: string, beforeId: string | null) =>
    views?.move(id, beforeId)
  )
  ipcMain.handle(IPC.tabContextMenu, (_e, id: string) => views?.showTabMenu(id))

  // Mini-player (Picture-in-Picture)
  ipcMain.handle(IPC.pipEnter, (_e, tabId?: string) => views?.enterPip(tabId))
  ipcMain.handle(IPC.pipToggle, () => views?.togglePip())
  ipcMain.handle(IPC.pipExit, () => views?.exitPip(false))
  ipcMain.handle(IPC.pipBackToTab, () => views?.exitPip(true))
  ipcMain.handle(IPC.pipToggleFloat, () => views?.togglePipFloat())
  ipcMain.handle(IPC.pipToggleMinimize, () => views?.togglePipMinimize())
  ipcMain.handle(IPC.pipSetMuted, (_e, muted: boolean) => views?.setPipMuted(muted))
  ipcMain.handle(IPC.pipMoveBy, (_e, dx: number, dy: number) => views?.pipMoveBy(dx, dy))
  ipcMain.handle(IPC.pipSnap, () => views?.pipSnap())
  ipcMain.handle(IPC.pipGetState, () => views?.pipState() ?? null)

  // Buscar en la pagina (Ctrl+F)
  ipcMain.handle(IPC.findStart, (_e, text: string, opts?: FindOptions) => views?.find(text, opts))
  ipcMain.handle(IPC.findStop, () => views?.stopFind())
  ipcMain.handle(IPC.findSetOpen, (_e, open: boolean) => views?.setFindOpen(open))

  // Perfil (nombre + tutorial visto). Solo el shell: es lo unico que TEK sabe
  // de la persona, ninguna pagina debe poder leerlo ni cambiarlo.
  const DEFAULT_PROFILE: UserProfile = {
    name: '',
    greeted: false,
    tourDone: false,
    createdAt: Date.now()
  }
  ipcMain.handle(IPC.profileGet, (e) =>
    fromShell(e) ? userProfile?.get() ?? DEFAULT_PROFILE : DEFAULT_PROFILE
  )
  ipcMain.handle(IPC.profileSet, (e, patch: Partial<UserProfile>) =>
    fromShell(e) ? userProfile?.set(patch) ?? DEFAULT_PROFILE : DEFAULT_PROFILE
  )

  // --- Actualizacion de la app ---------------------------------------------
  // Nada se descarga sin un si explicito: `updateCheck` solo mira, y es
  // `updateDownload` (que solo dispara la UI tras el clic) quien baja.
  const IDLE_UPDATE: UpdateState = { phase: 'idle', version: '', notes: '', percent: 0, error: '' }
  ipcMain.handle(IPC.updateCheck, (e) =>
    fromShell(e) ? updater?.check(true) ?? IDLE_UPDATE : IDLE_UPDATE
  )
  ipcMain.handle(IPC.updateDownload, (e) =>
    fromShell(e) ? updater?.download() ?? IDLE_UPDATE : IDLE_UPDATE
  )
  ipcMain.handle(IPC.updateInstall, (e) => {
    if (fromShell(e)) updater?.install()
  })
  ipcMain.handle(IPC.updateDismiss, (e) =>
    fromShell(e) ? updater?.dismiss() ?? IDLE_UPDATE : IDLE_UPDATE
  )

  // Musica: chip "Ahora suena" + control de la pestana que suena
  const IDLE_MEDIA = { now: null, exclusive: false }
  ipcMain.handle(IPC.mediaGetState, () => media?.state() ?? IDLE_MEDIA)
  ipcMain.handle(IPC.mediaPlayPause, () => media?.control('playpause'))
  ipcMain.handle(IPC.mediaNext, () => media?.control('next'))
  ipcMain.handle(IPC.mediaPrev, () => media?.control('prev'))
  ipcMain.handle(IPC.mediaSetExclusive, (e, on: boolean) =>
    fromShell(e) && media ? media.setExclusive(on) : IDLE_MEDIA
  )

  ipcMain.handle(IPC.sessionPeek, () => views?.peek() ?? null)
  ipcMain.handle(IPC.sessionRestore, () => views?.restore())
  ipcMain.handle(IPC.sessionDiscard, () => views?.discard())

  ipcMain.handle(IPC.winMinimize, () => mainWindow?.minimize())
  ipcMain.handle(IPC.winMaximizeToggle, () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.handle(IPC.winClose, () => mainWindow?.close())

  // Adblock
  ipcMain.handle(IPC.adblockStatus, () => adblock?.status() ?? { enabled: false, ready: false })
  ipcMain.handle(IPC.adblockToggle, (_e, on: boolean) => adblock?.setEnabled(on) ?? false)
  ipcMain.handle(IPC.adblockSiteAllowed, (_e, host: string) => adblock?.siteAllowed(host) ?? false)
  ipcMain.handle(IPC.adblockAllowSite, (_e, host: string, allowed: boolean) =>
    adblock?.setSiteAllowed(host, allowed)
  )

  // Cerebro de TEK
  ipcMain.handle(IPC.brainSuggestions, async (_e, limit?: number) => {
    const sugs = brain?.suggestions(limit) ?? []
    if (!favicons || sugs.length === 0) return sugs
    // Asegura iconos para los hosts que aun no tengan (cap ~800ms; ya cacheados
    // = instantaneo). Asi la nueva pestana sale con favicons desde el primer uso.
    await Promise.race([
      Promise.all(sugs.map((s) => favicons!.ensure(s.host))),
      new Promise((r) => setTimeout(r, 800))
    ])
    return sugs.map((s) => ({ ...s, favicon: favicons!.get(s.host) }))
  })
  ipcMain.handle(IPC.brainMusic, () => brain?.music() ?? { last: null, top: [] })
  ipcMain.handle(IPC.brainRoutineForNow, () => brain?.routineForNow() ?? null)
  ipcMain.handle(IPC.brainProfile, () => brain?.profile() ?? null)
  ipcMain.handle(IPC.brainSetPaused, (_e, paused: boolean) => brain?.setPaused(paused) ?? true)
  ipcMain.handle(IPC.brainForget, (_e, host: string) => brain?.forget(host))
  ipcMain.handle(IPC.brainWipe, () => brain?.wipe())
  ipcMain.handle(
    IPC.brainHistory,
    (_e, opts?: { query?: string; limit?: number; offset?: number; distinct?: boolean }) => {
      const rows = brain?.history(opts) ?? []
      // Favicons solo de cache (sin red): son hosts ya visitados, es instantaneo.
      return favicons ? rows.map((r) => ({ ...r, favicon: favicons!.get(r.host) })) : rows
    }
  )
  ipcMain.handle(IPC.brainQueries, (_e, q: string, limit?: number) =>
    brain?.pastQueries(q, limit) ?? []
  )
  ipcMain.handle(IPC.brainDeleteVisit, (_e, id: number) => brain?.deleteVisit(id))
  ipcMain.handle(IPC.brainClearHistory, (_e, sinceMs?: number) => brain?.clearHistory(sinceMs))
  ipcMain.handle(IPC.brainIgnore, (_e, host: string) => brain?.ignore(host))
  ipcMain.handle(IPC.brainUnignore, (_e, host: string) => brain?.unignore(host))
  ipcMain.handle(IPC.brainIgnored, () => brain?.ignored() ?? [])

  // Descargas
  ipcMain.handle(IPC.downloadsList, () => downloads?.list() ?? [])
  ipcMain.handle(IPC.downloadsOpenFile, (_e, id: string) => downloads?.openFile(id))
  ipcMain.handle(IPC.downloadsShowInFolder, (_e, id: string) => downloads?.showInFolder(id))
  ipcMain.handle(IPC.downloadsCancel, (_e, id: string) => downloads?.cancel(id))
  ipcMain.handle(IPC.downloadsRemove, (_e, id: string) => downloads?.remove(id))
  ipcMain.handle(IPC.downloadsClear, () => downloads?.clear())

  // Radar de servers locales + ajustes dev
  ipcMain.handle(IPC.devServers, () => radar?.list() ?? [])
  ipcMain.handle(IPC.devScan, () => radar?.scan() ?? [])
  ipcMain.handle(IPC.devSettingsGet, () => settings?.get())
  ipcMain.handle(IPC.devSettingsSet, async (e, patch: Partial<DevSettings>) => {
    if (!fromShell(e) || !settings) return settings?.get()
    const next = settings.set(patch)
    // El puente arranca/para al vuelo segun el ajuste.
    if (bridge) {
      if (next.bridgeEnabled) await bridge.start()
      else bridge.stop()
    }
    return next
  })

  // Automatizacion
  ipcMain.handle(IPC.autoState, () => ({
    recipes: automation?.recipes() ?? [],
    workspaces: automation?.workspaces() ?? [],
    snippets: scripts?.snippets() ?? [],
    siteScripts: scripts?.siteScripts() ?? [],
    watchers: watchers?.list() ?? [],
    macros: macros?.list() ?? [],
    recording: macros?.recording ?? false
  }))
  ipcMain.handle(IPC.autoSaveRecipe, (_e, r: Recipe) => automation?.saveRecipe(r))
  ipcMain.handle(IPC.autoDeleteRecipe, (_e, id: string) => automation?.deleteRecipe(id))
  ipcMain.handle(IPC.autoRunRecipe, (_e, id: string) => automation?.run(id))
  ipcMain.handle(IPC.autoSaveWorkspace, (_e, w: Workspace) => automation?.saveWorkspace(w))
  ipcMain.handle(IPC.autoDeleteWorkspace, (_e, id: string) => automation?.deleteWorkspace(id))
  ipcMain.handle(IPC.autoOpenWorkspace, (_e, id: string) => automation?.openWorkspace(id))
  ipcMain.handle(IPC.autoWorkspaceFromTabs, (_e, name: string) => {
    if (!automation || !views) return null
    const urls = views
      .tabsForBridge()
      .map((t) => t.url)
      .filter((u) => /^https?:\/\//i.test(u))
    return automation.workspaceFromUrls(name, urls)
  })
  ipcMain.handle(IPC.autoSaveSnippet, (_e, s: Snippet) => scripts?.saveSnippet(s))
  ipcMain.handle(IPC.autoDeleteSnippet, (_e, id: string) => scripts?.deleteSnippet(id))
  ipcMain.handle(
    IPC.autoRunSnippet,
    (_e, id: string): Promise<SnippetResult> =>
      scripts?.runSnippet(id) ?? Promise.resolve({ ok: false, value: 'sin motor' })
  )
  ipcMain.handle(IPC.autoSaveSiteScript, (_e, s: SiteScript) => scripts?.saveSiteScript(s))
  ipcMain.handle(IPC.autoDeleteSiteScript, (_e, id: string) => scripts?.deleteSiteScript(id))
  ipcMain.handle(IPC.autoSaveWatcher, (_e, w: Watcher) => watchers?.save(w))
  ipcMain.handle(IPC.autoDeleteWatcher, (_e, id: string) => watchers?.delete(id))
  ipcMain.handle(IPC.autoCheckWatcher, (_e, id: string) => watchers?.check(id) ?? null)
  ipcMain.handle(IPC.autoDeleteMacro, (_e, id: string) => macros?.delete(id))
  ipcMain.handle(IPC.autoRunMacro, (_e, id: string) => macros?.run(id))
  ipcMain.handle(IPC.autoRecordStart, () => macros?.startRecording() ?? false)
  ipcMain.handle(IPC.autoRecordStop, (_e, name: string | null) => macros?.stopRecording(name) ?? null)

  // Puente para agentes (solo el shell puede tocarlo)
  ipcMain.handle(IPC.bridgeStatus, (e) => {
    if (!fromShell(e)) return null
    return bridge?.status(settings?.get().bridgeEnabled ?? false) ?? null
  })
  ipcMain.handle(IPC.bridgeSetEnabled, async (e, on: boolean) => {
    if (!fromShell(e) || !bridge || !settings) return null
    settings.set({ bridgeEnabled: on })
    if (on) await bridge.start()
    else bridge.stop()
    return bridge.status(on)
  })

  // Contrasenas (canales sensibles: solo el shell)
  ipcMain.handle(IPC.pwStatus, (e) => (fromShell(e) ? passwords?.status() : null))
  ipcMain.handle(IPC.pwList, (e) => (fromShell(e) ? passwords?.list() ?? [] : []))
  ipcMain.handle(IPC.pwReveal, (e, id: string) => (fromShell(e) ? passwords?.reveal(id) ?? null : null))
  ipcMain.handle(IPC.pwDelete, (e, id: string) => {
    if (fromShell(e)) passwords?.remove(id)
  })
  ipcMain.handle(IPC.pwRemoveNever, (e, host: string) => {
    if (fromShell(e)) passwords?.removeNever(host)
  })
  ipcMain.handle(IPC.pwDecision, (e, offerId: string, action: PwDecision) => {
    if (fromShell(e)) passwords?.decision(offerId, action)
  })
  ipcMain.handle(IPC.pwFill, (e, tabId: string, credId: string) => {
    if (!fromShell(e) || !views || !passwords) return false
    const wc = views.wcOfTab(tabId)
    const cred = passwords.credFor(credId)
    if (!wc || !cred) return false
    // El host se verifica EN EL MOMENTO de rellenar: si la pestana ya navego a
    // otro sitio, no se manda nada.
    if (hostKey(wc.getURL()) !== cred.host) return false
    wc.send(WV.pwFillCreds, { username: cred.username, password: cred.password })
    return true
  })

  // Contrasena maestra de la boveda (solo el shell)
  ipcMain.handle(IPC.pwSetMaster, (e, next: string | null, current?: string) =>
    fromShell(e) ? passwords?.setMaster(next, current) ?? { ok: false } : { ok: false }
  )
  ipcMain.handle(IPC.pwUnlock, (e, password: string) =>
    fromShell(e) ? passwords?.unlock(password) ?? false : false
  )
  ipcMain.handle(IPC.pwLock, (e) => {
    if (fromShell(e)) passwords?.lock()
  })

  // Permisos de sitio (solo el shell consulta/revoca)
  ipcMain.handle(IPC.permsList, (e) => (fromShell(e) ? permissions?.list() ?? [] : []))
  ipcMain.handle(IPC.permsRevoke, (e, host: string, permission: string) => {
    if (fromShell(e)) permissions?.revoke(host, permission)
  })

  // Privacidad: borrar datos de navegacion (solo el shell; acciones destructivas)
  ipcMain.handle(IPC.privacyClear, (e, scope?: ClearScope) => {
    if (fromShell(e)) return privacy?.clear(scope)
  })
  ipcMain.handle(IPC.privacyClearHost, (e, host: string) => {
    if (fromShell(e)) return privacy?.clearForHost(host)
  })

  // Canales del preload de las webviews (vienen de las PAGINAS: validar fuerte).
  ipcMain.on(WV.pwCaptured, (e, payload: unknown) => passwords?.handleCaptured(e.sender, payload))
  // La pagina gano o perdio un campo de login visible. Solo entonces ofrecemos
  // rellenar; con `creds: []` el renderer retira el aviso. El host lo sacamos
  // del webContents, no de lo que diga la pagina.
  ipcMain.on(WV.pwFormPresent, (e, present: unknown) => {
    if (!views || !passwords || e.sender.isDestroyed()) return
    const tabId = views.tabIdOfWcId(e.sender.id)
    if (!tabId) return
    const host = hostKey(e.sender.getURL())
    const creds = present === true && !passwords.status().locked ? passwords.metasFor(host) : []
    sendToShell(IPC.pwFillAvailable, { tabId, host, creds })
  })
  ipcMain.on(WV.macroEvent, (e, step: unknown) => macros?.handleEvent(e.sender, step))
  // Metadatos de MediaSession de una pagina (titulo/artista/caratula del chip).
  ipcMain.on(WV.mediaMeta, (e, payload: unknown) => media?.handleMeta(e.sender, payload))
  ipcMain.handle(WV.macroIsRecording, (e) => macros?.isRecordingWc(e.sender.id) ?? false)
  // "Permitir sitio" en el escudo significa NO TOCAR: ni red ni defusers. El
  // preload lo pregunta sincrono antes de parchear nada (ver WV.siteUntouched).
  ipcMain.on(WV.siteUntouched, (e, host: unknown) => {
    const h = typeof host === 'string' ? host.replace(/^www\./, '') : ''
    e.returnValue = !!h && !!adblock?.siteAllowed(h)
  })
  // Scriptlets del adblock en document_start: la pieza que mata el muro
  // anti-adblock de YouTube (ver WV.adScripts y Adblock.scriptsFor).
  ipcMain.on(WV.adScripts, (e, url: unknown) => {
    e.returnValue = typeof url === 'string' ? (adblock?.scriptsFor(url) ?? []) : []
  })
}

/**
 * FedCM APAGADO a proposito (antes de que arranque Chromium; despues no sirve).
 *
 * FedCM es la API nueva con la que Google hace "Iniciar sesion con Google". La
 * pinta el NAVEGADOR: es Chromium quien dibuja el selector de cuentas. Electron
 * no trae esa interfaz, asi que `navigator.credentials.get({identity})` siempre
 * acaba en `NetworkError: Error retrieving a token` y la libreria de Google se
 * rinde sin decir nada — el boton "Continuar con Google" no hacia NADA
 * (diagnosticado en Pinterest, log `[GSI_LOGGER]` + "Prompt dismissed").
 *
 * Apagandolo, la libreria de Google detecta que no hay FedCM y cae al flujo
 * clasico de popup, que en TEK SI funciona (es el que ya arreglamos con el
 * setWindowOpenHandler que conserva `window.opener`). No perdemos nada: FedCM
 * aqui nunca llego a funcionar.
 */
// HardwareMediaKeyHandling tambien fuera: con el activo, Chromium se registra
// las teclas multimedia del sistema y NUNCA llegan al globalShortcut de Media
// (conflicto documentado en Electron). Las teclas las enruta TEK, que sabe cual
// es la pestana que suena; el manejo interno de Chromium elige "su" media
// session y con varias pestanas se equivoca.
app.commandLine.appendSwitch('disable-features', 'FedCm,HardwareMediaKeyHandling')

// Instancia unica: dos TEK sobre el mismo perfil corrompen la cache de Chromium
// y arriesgan la base del cerebro. La segunda instancia enfoca la primera y muere.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  // Windows necesita un AppUserModelID para mostrar notificaciones con el nombre
  // correcto (si no, las descartaria o saldria "electron.app.Electron").
  if (process.platform === 'win32') app.setAppUserModelId('com.tek.browser')

  // DRM (Widevine CDM): sin esto, Netflix / Disney+ / Prime Video y cualquier
  // <video> con EME se quedan en negro o dan error de reproduccion. Corremos
  // sobre el runtime de castlabs (electron-releases +wvcus), que DESCARGA y
  // verifica el componente en tiempo de ejecucion. Lo esperamos ANTES de crear
  // la ventana para que la primera pestana ya tenga DRM (solo la 1a vez baja el
  // CDM; luego queda cacheado y resuelve al instante). Si falla (p. ej. sin red)
  // la app arranca igual: solo el video con DRM no ira hasta el proximo arranque.
  // OJO: maximo Widevine L3 -> 720p. El 4K exige DRM por hardware (L1), que solo
  // tienen la app de la Store y Edge; ningun navegador propio puede darlo.
  try {
    await components.whenReady()
    console.log('[tek] DRM Widevine: componente verificado y listo')
  } catch (err) {
    console.error('[tek] Widevine CDM no disponible:', err)
  }

  brain = new Brain()
  adblock = new Adblock(PARTITION)
  void adblock.init() // carga cache/baseline y refresca listas en segundo plano
  favicons = new Favicons()
  void favicons.init() // carga la cache de iconos de disco
  downloads = new Downloads(PARTITION)
  void downloads.init() // carga el historial de descargas de disco

  // Automatizacion + dev.
  settings = new Settings()
  radar = new DevRadar()
  automation = new Automation()
  scripts = new Scripts()
  watchers = new Watchers()
  macros = new Macros()
  bridge = new AgentBridge()
  passwords = new Passwords()
  userProfile = new Profile()

  // Actualizacion: empuja su estado al shell y el shell decide que enseñar.
  // Solo hace algo en TEK instalado (en dev no hay app-update.yml).
  updater = new Updater((s) => sendToShell(IPC.updateState, s))
  updater.start()

  // Musica: "ahora suena", teclas multimedia globales y "una pestana a la vez".
  media = new Media()
  media.onState = (s) => sendToShell(IPC.mediaState, s)
  media.registerKeys()

  // Permisos de sitio: SIN este handler Electron CONCEDE todo por defecto
  // (camara, micro, ubicacion...). Deny-by-default + dialogo recordado.
  permissions = new Permissions()
  permissions.getWindow = () => mainWindow
  permissions.attach(PARTITION)

  // Borrado de datos de navegacion (cookies/cache/storage de Chromium).
  privacy = new Privacy(PARTITION)

  // Compartir pantalla (Meet/Discord/Slack): sin este handler getDisplayMedia
  // falla siempre. Compartimos la pantalla principal; el permiso
  // 'display-capture' ya paso por el dialogo de Permissions antes de llegar aqui.
  session.fromPartition(PARTITION).setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        const screen = sources[0]
        if (screen) {
          callback({ video: screen, audio: request.audioRequested ? 'loopback' : undefined })
        } else {
          callback({})
        }
      })
      .catch(() => callback({}))
  })

  registerIpc()
  createWindow()

  // El gestor de descargas empuja su estado al renderer (toast + panel).
  const dl = downloads
  dl.onChange = (): void => {
    mainWindow?.webContents.send(IPC.downloadsState, dl.list())
  }

  // Push de automatizacion hacia el renderer.
  radar.onChange = (servers) => sendToShell(IPC.devServersState, servers)
  radar.onUp = (port) => automation?.onServer(port)
  automation.onToast = (t) => sendToShell(IPC.autoToast, t)
  macros.onRecState = (rec) => sendToShell(IPC.autoRecState, rec)
  passwords.onOffer = (o) => sendToShell(IPC.pwOffer, o)

  radar.start()
  automation.start()
  watchers.start()
  if (settings.get().bridgeEnabled) void bridge.start()

  // Recetas de arranque: cuando el renderer ya esta montado y escuchando.
  setTimeout(() => automation?.fireStartup(), 2500)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Los globalShortcut deben soltarse al salir (recomendacion de Electron).
app.on('will-quit', () => {
  media?.dispose()
  media = null
})
