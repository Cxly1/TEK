import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { prettyHost, type MusicNow, type Suggestion } from '@shared/ipc'
import { useTek, useActiveTab } from '@/store'
import { useArrowNav, type NavItemProps } from '@/lib/useArrowNav'
import { groupColor } from '@/lib/groupColor'
import { greetingForUser } from '@/lib/greeting'
import { TopBar } from './TopBar'
import { CanvasNowPlaying } from './NowPlaying'
import { FindBar } from '../find/FindBar'
import './shell.css'

/** Reloj + saludo por tu nombre: punto focal sereno de la nueva pestana. */
function Clock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  const name = useTek((s) => s.profile?.name ?? '')
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="newtab-clock" data-tour="clock">
      <span className="clock-time">{time}</span>
      <span className="clock-greet">{greetingForUser(name, now.getHours())}</span>
    </div>
  )
}

/** Inicial del titulo/host para el icono del tile. */
function glyph(s: Suggestion): string {
  const base = (s.title || s.host).replace(/^www\./, '')
  return base.charAt(0).toUpperCase() || '•'
}

/**
 * Acceso directo: favicon real del sitio (si TEK lo tiene) sobre un chip teñido
 * con el color del dominio; si no hay favicon —o falla la imagen— cae a la
 * inicial. Asi se ve profesional desde el primer uso y mejora al navegar.
 */
function SugTile({
  s,
  onGo,
  navProps
}: {
  s: Suggestion
  onGo: (url: string) => void
  navProps: NavItemProps
}): React.JSX.Element {
  const [broken, setBroken] = useState(false)
  const c = groupColor(s.host)
  const showImg = !!s.favicon && !broken
  return (
    <button
      className="sug-tile knav-item"
      onClick={() => onGo(s.url)}
      title={s.title || s.host}
      style={{ ['--c' as string]: c }}
      {...navProps}
    >
      <span className="sug-icon">
        {showImg ? (
          <img
            className="sug-favicon"
            src={s.favicon as string}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="sug-glyph-text">{glyph(s)}</span>
        )}
      </span>
      <span className="sug-name">{prettyHost(s.host)}</span>
    </button>
  )
}

/**
 * Navegador activo. La TopBar vive en el renderer; el area inferior la cubre la
 * WebContentsView nativa cuando la pestana activa tiene pagina. Si esta en
 * blanco o el palette esta abierto, mostramos el lienzo "nueva pestana" — que
 * ahora aprende de ti: sugiere tus sitios segun la hora y lo que escuchas.
 *
 * Todo el lienzo se recorre con el teclado: el contenedor toma el foco al
 * aparecer, ←→↑↓ mueven el resaltado (busqueda y music en fila propia, servers y
 * chips en fila horizontal, los tiles en grid 2D de 4) y Enter abre el activo.
 */
export function Shell(): React.JSX.Element {
  const openPalette = useTek((s) => s.openPalette)
  const paletteOpen = useTek((s) => s.paletteOpen)
  const findOpen = useTek((s) => s.findOpen)
  const active = useActiveTab()
  const tourOpen = useTek((s) => s.tourOpen)
  // Con el tutorial abierto mostramos el lienzo aunque haya una web cargada: los
  // pasos señalan piezas suyas (buscador, accesos) y deben existir para medirlas.
  const showCanvas = !active || active.blank || paletteOpen || tourOpen
  // ¿Hay algo por encima del lienzo? Entonces NO le robamos el foco del teclado:
  // cada overlay (paleta, paneles, reanudar sesión, rutina) gestiona el suyo.
  const overlayUp = useTek(
    (s) =>
      s.paletteOpen ||
      s.resume !== null ||
      s.routine !== null ||
      s.brainOpen ||
      s.downloadsOpen ||
      s.historyOpen ||
      s.automationOpen ||
      s.passwordsOpen ||
      s.tourOpen
  )

  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [music, setMusic] = useState<MusicNow | null>(null)
  const devServers = useTek((s) => s.devServers)
  const setDevServers = useTek((s) => s.setDevServers)

  // El resaltado dorado solo aparece tras la 1a flecha (no compite con el raton).
  const [armed, setArmed] = useState(false)

  // Cada vez que aparece el lienzo, pedimos al cerebro lo de AHORA.
  useEffect(() => {
    if (!showCanvas) return
    let alive = true
    void window.tek.brain.suggestions(8).then((s) => alive && setSuggestions(s))
    void window.tek.brain.music().then((m) => alive && setMusic(m.last))
    // Radar: el ultimo estado conocido de servers locales (el push lo refresca).
    void window.tek.dev.servers().then((list) => alive && setDevServers(list))
    return () => {
      alive = false
    }
  }, [showCanvas, setDevServers])

  const go = (url: string): void => void window.tek.navigate(url)

  // --- Navegacion por teclado del lienzo -----------------------------------
  // En el MISMO orden que se renderiza, juntamos las acciones y la geometria de
  // filas: busqueda (fila 1), music (fila 1), servers (fila horizontal), tiles
  // (grid 2D de 4) o chips (fila). Los offsets nos dan el indice de cada acceso.
  const actions: (() => void)[] = [() => openPalette()]
  const rows: number[] = [1]
  let idxMusic = -1
  if (music) {
    idxMusic = actions.length
    actions.push(() => go(music.url))
    rows.push(1)
  }
  let idxServer = -1
  if (devServers.length > 0) {
    idxServer = actions.length
    devServers.forEach((s) => actions.push(() => go(s.url)))
    rows.push(devServers.length)
  }
  const idxTile = actions.length
  if (suggestions.length > 0) {
    suggestions.forEach((s) => actions.push(() => go(s.url)))
    for (let i = 0; i < suggestions.length; i += 4) rows.push(Math.min(4, suggestions.length - i))
  } else {
    actions.push(
      () => openPalette(''),
      () => openPalette('yt '),
      () => openPalette('gh ')
    )
    rows.push(3)
  }

  const nav = useArrowNav({ rowLengths: rows, onActivate: (i) => actions[i]?.() })

  // data-active solo cuenta una vez "armado" (tras la 1a flecha).
  const navItem = (i: number): NavItemProps => {
    const p = nav.itemProps(i)
    return { ...p, 'data-active': armed && p['data-active'] }
  }

  // Navegacion por teclado del lienzo via listener de window: con la nueva
  // pestana a la vista y nada encima, ←→↑↓ recorren los accesos y Enter abre el
  // activo. NO depende del foco de ningun elemento, asi que va YA al arrancar
  // (antes habia que tocar el raton primero). Escribir sigue abriendo la paleta
  // (lo gestiona App); con una pagina cargada su vista nativa se queda las teclas,
  // asi que esto solo actua en la nueva pestana.
  useEffect(() => {
    if (!showCanvas || overlayUp) {
      setArmed(false)
      return
    }
    const onKey = (e: KeyboardEvent): void => {
      // Un evento ya consumido por otra superficie (p. ej. el Enter con el que
      // la paleta acaba de cerrarse: los efectos sincronos de React re-enganchan
      // este listener a MITAD de ese mismo evento) no debe operar el lienzo.
      if (e.defaultPrevented) return
      if (e.key.startsWith('Arrow')) setArmed(true)
      if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
        nav.onKeyDown(e as unknown as React.KeyboardEvent)
      } else if (e.key === 'Enter') {
        // El raton mueve el indice EN SILENCIO (el resaltado dorado solo se ve
        // tras la primera flecha). Enter solo activa lo que se VE: armado ->
        // el item resaltado; sin armar -> la busqueda. Sin esto, cruzar un
        // tile con el puntero lo dejaba como objetivo invisible y un Enter
        // posterior (p. ej. justo tras buscar en la paleta) abria ese sitio
        // "de la nada".
        e.preventDefault()
        if (armed) nav.onKeyDown(e as unknown as React.KeyboardEvent)
        else openPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showCanvas, overlayUp, nav, armed, openPalette])

  return (
    <motion.div
      className="shell"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <TopBar />
      <div className="shell-body">
        <AnimatePresence>{findOpen && <FindBar key="find" />}</AnimatePresence>
        {showCanvas && (
          <div className="newtab">
            {/* Misma esquina que en una pagina (la fila de navegacion no existe
                aqui): logo del sitio que suena + espectro + los tres botones. */}
            <CanvasNowPlaying />
            <Clock />

            <button
              className="newtab-search knav-item"
              data-tour="omnibox"
              onClick={() => openPalette()}
              {...navItem(0)}
            >
              <span className="newtab-search-cmd">⌘</span>
              <span className="newtab-search-text">Buscar o escribir una dirección</span>
              <kbd className="newtab-search-k">⌘K</kbd>
            </button>

            {music && (
              <button
                className="music-card knav-item"
                onClick={() => go(music.url)}
                title={music.title}
                {...navItem(idxMusic)}
              >
                <span className="music-eq" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="music-text">
                  <span className="music-label">Continuar escuchando</span>
                  <span className="music-title">{music.title}</span>
                </span>
                <span className="music-play">▶</span>
              </button>
            )}

            {devServers.length > 0 && (
              <div className="dev-card">
                <span className="dev-card-label">⚡ servers corriendo</span>
                <div className="dev-card-list">
                  {devServers.map((s, j) => (
                    <button
                      key={s.port}
                      className="dev-chip knav-item"
                      onClick={() => go(s.url)}
                      title={s.title || s.url}
                      {...navItem(idxServer + j)}
                    >
                      <span className="dev-chip-dot" aria-hidden />
                      <span className="dev-chip-port">:{s.port}</span>
                      {s.title && <span className="dev-chip-title">{s.title}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {suggestions.length > 0 ? (
              <div className="sug-grid" data-tour="dial">
                {suggestions.map((s, j) => (
                  <SugTile key={s.host} s={s} onGo={go} navProps={navItem(idxTile + j)} />
                ))}
              </div>
            ) : (
              <>
                <span className="newtab-hint">o empieza a escribir…</span>
                <div className="newtab-chips" data-tour="dial">
                  <button className="chip knav-item" onClick={() => openPalette('')} {...navItem(idxTile)}>
                    <span className="chip-icon">⌕</span> Google
                  </button>
                  <button className="chip knav-item" onClick={() => openPalette('yt ')} {...navItem(idxTile + 1)}>
                    <span className="chip-icon">▶</span> YouTube
                  </button>
                  <button className="chip knav-item" onClick={() => openPalette('gh ')} {...navItem(idxTile + 2)}>
                    <span className="chip-icon">◧</span> GitHub
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}
