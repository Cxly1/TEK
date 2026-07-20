import { useEffect, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useTek } from './store'
import { Genesis } from './genesis/Genesis'
import { Shell } from './shell/Shell'
import { CRTPowerOff } from './crt/CRTPowerOff'
import { CommandPalette } from './command/CommandPalette'
import { SessionResume } from './shell/SessionResume'
import { BrainPanel } from './brain/BrainPanel'
import { RoutineToast } from './brain/RoutineToast'
import { DownloadsPanel } from './downloads/DownloadsPanel'
import { DownloadToast } from './downloads/DownloadToast'
import { HistoryPanel } from './history/HistoryPanel'
import { AutomationPanel } from './automation/AutomationPanel'
import { AutoToast } from './automation/AutoToast'
import { PasswordsPanel } from './passwords/PasswordsPanel'
import { PasswordToasts } from './passwords/PasswordToasts'
import { ToolsMenu } from './shell/ToolsMenu'
import { Welcome } from './onboarding/Welcome'
import { Tour } from './onboarding/Tour'

export function App(): React.JSX.Element {
  const phase = useTek((s) => s.phase)
  const paletteOpen = useTek((s) => s.paletteOpen)
  const resume = useTek((s) => s.resume)
  const routine = useTek((s) => s.routine)
  const brainOpen = useTek((s) => s.brainOpen)
  const downloadsOpen = useTek((s) => s.downloadsOpen)
  const historyOpen = useTek((s) => s.historyOpen)
  const automationOpen = useTek((s) => s.automationOpen)
  const passwordsOpen = useTek((s) => s.passwordsOpen)
  const toolsMenuOpen = useTek((s) => s.toolsMenuOpen)
  const profile = useTek((s) => s.profile)
  const tourOpen = useTek((s) => s.tourOpen)
  const welcomeOpen = useTek((s) => s.welcomeOpen)
  const setProfile = useTek((s) => s.setProfile)
  const openTour = useTek((s) => s.openTour)
  const recipeToast = useTek((s) => s.recipeToast)
  const setDownloads = useTek((s) => s.setDownloads)
  const setPhase = useTek((s) => s.setPhase)
  const setResume = useTek((s) => s.setResume)
  const setRoutine = useTek((s) => s.setRoutine)
  const setTabs = useTek((s) => s.setTabs)
  const openPalette = useTek((s) => s.openPalette)
  const togglePalette = useTek((s) => s.togglePalette)
  const closePalette = useTek((s) => s.closePalette)

  const [igniting, setIgniting] = useState(false)

  // Estado de pestanas desde el main.
  useEffect(() => window.tek.onTabsState(setTabs), [setTabs])

  // Perfil de quien usa TEK: el nombre del saludo y si ya vio el tutorial. Llega
  // antes de pintar Genesis, para que el saludo salga ya con el nombre.
  useEffect(() => {
    void window.tek.profile.get().then(setProfile)
  }, [setProfile])

  // Estado de descargas desde el main (alimenta el toast y el panel).
  useEffect(() => {
    void window.tek.downloads.list().then(setDownloads)
    return window.tek.downloads.onState(setDownloads)
  }, [setDownloads])

  // Push de automatizacion: radar, recetas disparadas, REC y contrasenas.
  useEffect(() => {
    const st = useTek.getState()
    void window.tek.dev.servers().then(st.setDevServers)
    const offs = [
      window.tek.dev.onServers((list) => useTek.getState().setDevServers(list)),
      window.tek.auto.onToast((t) => useTek.getState().setRecipeToast(t)),
      window.tek.auto.onRecState((rec) => useTek.getState().setRecording(rec)),
      window.tek.passwords.onOffer((o) => useTek.getState().setPwOffer(o)),
      window.tek.passwords.onFillAvailable((f) => useTek.getState().setFillAvail(f))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // Buscar-en-pagina + comandos de UI que el main dispara cuando la PAGINA tiene
  // el foco (sus teclas no llegan al renderer). Son el espejo de los atajos de
  // teclado de abajo, para que funcionen igual con la web enfocada.
  useEffect(() => {
    const offFound = window.tek.onFound((r) => useTek.getState().setFindResult(r))
    const offUi = window.tek.onUiCommand((cmd) => {
      const st = useTek.getState()
      if (cmd === 'palette') st.togglePalette()
      else if (cmd === 'find') {
        const a = st.tabs.find((t) => t.id === st.activeId)
        if (a && !a.blank) st.openFind()
      } else if (cmd === 'newtab') {
        void window.tek.tabs.create()
        st.openPalette()
      }
    })
    return () => {
      offFound()
      offUi()
    }
  }, [])

  // Atajos globales.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Con un prompt/panel/rutina encima, no interceptamos teclas (pero Escape
      // cierra el panel pesado que este abierto: cerebro, descargas o historial).
      const st = useTek.getState()
      if (
        st.resume !== null ||
        st.routine !== null ||
        st.brainOpen ||
        st.downloadsOpen ||
        st.historyOpen ||
        st.automationOpen ||
        st.passwordsOpen ||
        st.toolsMenuOpen ||
        st.tourOpen ||
        st.welcomeOpen
      ) {
        if (e.key === 'Escape') {
          if (st.toolsMenuOpen) st.closeToolsMenu()
          else if (st.brainOpen) st.closeBrain()
          else if (st.downloadsOpen) st.closeDownloads()
          else if (st.historyOpen) st.closeHistory()
          else if (st.automationOpen) st.closeAutomation()
          else if (st.passwordsOpen) st.closePasswords()
        }
        return
      }
      const mod = e.ctrlKey || e.metaKey
      const inShell = useTek.getState().phase === 'shell'
      const k = e.key.toLowerCase()

      if (mod && k === 'k') {
        e.preventDefault()
        if (inShell) togglePalette()
      } else if (mod && k === 'l') {
        e.preventDefault()
        if (inShell) openPalette()
      } else if (mod && e.shiftKey && k === 'p') {
        e.preventDefault()
        if (inShell) void window.tek.pip.toggle()
      } else if (mod && k === 't') {
        e.preventDefault()
        if (!inShell) return
        // Ctrl+Shift+T reabre la ultima cerrada; Ctrl+T abre una nueva + paleta.
        if (e.shiftKey) void window.tek.tabs.reopen()
        else {
          void window.tek.tabs.create()
          openPalette()
        }
      } else if (mod && k === 'f') {
        e.preventDefault()
        const { tabs, activeId } = useTek.getState()
        const a = tabs.find((t) => t.id === activeId)
        if (inShell && a && !a.blank) useTek.getState().openFind()
      } else if (mod && k === 'w') {
        e.preventDefault()
        const active = useTek.getState().activeId
        if (inShell && active) void window.tek.tabs.close(active)
      } else if (mod && e.key === 'Tab') {
        e.preventDefault()
        const { tabs, activeId } = useTek.getState()
        if (tabs.length > 1) {
          const i = tabs.findIndex((t) => t.id === activeId)
          const n = tabs.length
          const next = tabs[(i + (e.shiftKey ? -1 : 1) + n) % n]
          void window.tek.tabs.activate(next.id)
        }
      } else if (mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const { tabs } = useTek.getState()
        if (inShell && tabs.length > 0) {
          const idx = e.key === '9' ? tabs.length - 1 : Number(e.key) - 1
          const t = tabs[Math.min(idx, tabs.length - 1)]
          if (t) void window.tek.tabs.activate(t.id)
        }
      } else if (e.key === 'Escape' && useTek.getState().findOpen) {
        useTek.getState().closeFind()
      } else if (e.key === 'Escape' && useTek.getState().paletteOpen) {
        closePalette()
      } else if (
        // Super facil: en el LIENZO de pestana nueva (no sobre una web cargada),
        // basta con empezar a escribir un caracter imprimible para abrir la
        // paleta con ese texto. Si hay una pagina real, NO secuestramos teclas
        // sueltas (el espacio debe pausar el video, etc.). El espacio nunca abre
        // la paleta (abriria vacia, sin sentido).
        inShell &&
        !useTek.getState().paletteOpen &&
        !mod &&
        !e.altKey &&
        e.key.length === 1 &&
        e.key !== ' ' &&
        (() => {
          const { tabs, activeId } = useTek.getState()
          const a = tabs.find((t) => t.id === activeId)
          return !a || a.blank
        })() &&
        !(
          e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
        )
      ) {
        e.preventDefault()
        openPalette(e.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePalette, openPalette, closePalette])

  const onCrtDone = async (): Promise<void> => {
    setIgniting(false)
    setPhase('shell')
    const saved = await window.tek.session.peek()
    if (saved && saved.count > 0) {
      setResume(saved.count) // ofrece reanudar la ultima sesion
      return
    }
    // Arranque limpio: la primera pestana en blanco siempre.
    await window.tek.tabs.create()
    // Primera vez: el tutorial guiado manda, sin rutinas ni paleta encima.
    if (!useTek.getState().profile?.tourDone) {
      openTour()
      return
    }
    // Si TEK reconoce tu rutina de esta franja, ofrece abrirla (auto). Si no, ⌘K.
    const r = await window.tek.brain.routineForNow()
    if (r) setRoutine(r)
    else openPalette()
  }

  // Sin perfil todavia no pintamos: son unos ms y evita que Genesis salude sin
  // nombre y lo corrija a mitad de la animacion de texto.
  if (!profile) return <></>

  // Primer arranque: la pregunta del nombre va ANTES de Genesis (asi el saludo
  // de encendido ya es personal). Reabrirla luego no tapa el navegador.
  const askName = welcomeOpen || !profile.greeted

  return (
    <>
      {phase === 'genesis' && !askName && <Genesis onIgnite={() => setIgniting(true)} />}
      {phase === 'shell' && <Shell />}
      {igniting && <CRTPowerOff onComplete={() => void onCrtDone()} />}

      <AnimatePresence>{askName && <Welcome key="welcome" />}</AnimatePresence>
      <AnimatePresence>{tourOpen && <Tour key="tour" />}</AnimatePresence>

      <AnimatePresence>
        {resume !== null && <SessionResume key="resume" />}
      </AnimatePresence>
      <AnimatePresence>{paletteOpen && <CommandPalette key="palette" />}</AnimatePresence>
      <AnimatePresence>{brainOpen && <BrainPanel key="brain" />}</AnimatePresence>
      <AnimatePresence>{downloadsOpen && <DownloadsPanel key="downloads" />}</AnimatePresence>
      <AnimatePresence>{historyOpen && <HistoryPanel key="history" />}</AnimatePresence>
      <AnimatePresence>{automationOpen && <AutomationPanel key="automation" />}</AnimatePresence>
      <AnimatePresence>{passwordsOpen && <PasswordsPanel key="passwords" />}</AnimatePresence>
      <AnimatePresence>{toolsMenuOpen && <ToolsMenu key="toolsmenu" />}</AnimatePresence>
      <AnimatePresence>
        {routine !== null && phase === 'shell' && <RoutineToast key="routine" />}
      </AnimatePresence>
      <AnimatePresence>
        {recipeToast !== null && phase === 'shell' && routine === null && (
          <AutoToast key="recipe-toast" />
        )}
      </AnimatePresence>
      {phase === 'shell' && <PasswordToasts />}
      <DownloadToast />
    </>
  )
}
