import { useEffect, useState } from 'react'
import { useTek } from '@/store'
import type { NowPlaying as NowPlayingInfo } from '@shared/ipc'

/**
 * Controles de musica de TEK. Dos superficies, mismos botones:
 *  - `NowPlaying`: tres botones fantasma en la fila de navegacion (junto al
 *    boton del mini-player), sin texto ni caratula — minimalismo.
 *  - `CanvasNowPlaying`: en el lienzo de pestana nueva, misma esquina, pero con
 *    el logo del sitio que suena y un espectro que late (ahi hay espacio y el
 *    lienzo es la unica superficie visible).
 * El play/pausa MORPHEA triangulo<->barras animando la propiedad CSS `d` (patron
 * del icono de YouTube / Aceternity labs: Chromium interpola dos paths de
 * estructura identica — dos subpaths de 4 puntos).
 */

/** La dueña de la musica, validada contra las pestanas vivas (sin huerfanos). */
function useNow(): NowPlayingInfo | null {
  const now = useTek((s) => s.media.now)
  const gone = useTek((s) => !!s.media.now && !s.tabs.some((t) => t.id === s.media.now!.tabId))
  return now && !gone ? now : null
}

/**
 * Los tres botones (⏮ ⏯ ⏭). Sin soporte del sitio = deshabilitado, no
 * invisible — y lo mismo aplica cuando no hay NADA sonando: `now` puede ser
 * null (sin musica en ninguna pestana), y en vez de desaparecer los tres
 * botones se quedan puestos, deshabilitados. Antes el hueco entero se
 * escondia con `now &&`, y como la fila vive junto a los controles fijos de
 * la barra (mini-player, escudo…) el layout "saltaba" cada vez que la musica
 * arrancaba o paraba.
 */
function MediaButtons({ now }: { now: NowPlayingInfo | null }): React.JSX.Element {
  const label = now ? (now.artist ? `${now.title} — ${now.artist}` : now.title) : ''
  return (
    <>
      <button
        className="tb-mbtn tb-mprev"
        title="Anterior"
        disabled={!now?.canPrev}
        onClick={() => void window.tek.media.prev()}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
          <path
            d="M7 6v12M18 6l-8.5 6 8.5 6V6z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        className="tb-mbtn tb-mplay"
        title={now ? (now.playing ? `Pausar — ${label}` : `Reanudar — ${label}`) : 'Sin música'}
        disabled={!now}
        onClick={() => void window.tek.media.playPause()}
      >
        {/* El `d` de este path lo pisa el CSS (.tb-mplay path): ahi vive el morph. */}
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
          <path
            d="M8 5 L8 19 L13.5 15.5 L13.5 8.5 Z M13.5 8.5 L13.5 15.5 L19 12 L19 12 Z"
            fill="currentColor"
          />
        </svg>
      </button>
      <button
        className="tb-mbtn tb-mnext"
        title="Siguiente"
        disabled={!now?.canNext}
        onClick={() => void window.tek.media.next()}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
          <path
            d="M17 6v12M6 6l8.5 6-8.5 6V6z"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  )
}

/** Fila de navegacion: los tres botones, pegados junto al mini-player. SIEMPRE
 *  puestos (Migue: "debe de estar siempre") — deshabilitados sin musica. */
export function NowPlaying(): React.JSX.Element {
  const now = useNow()
  return (
    <div className={`tb-media no-drag ${now?.playing ? 'is-playing' : ''}`}>
      <MediaButtons now={now} />
    </div>
  )
}

/**
 * Lienzo de pestana nueva: la fila de navegacion no existe ahi (regla Zen de
 * "una sola barra"), asi que los controles viven en la misma esquina pero como
 * pieza propia: logo del sitio + espectro + botones. Clic en el logo = ir a la
 * pestana que suena.
 */
export function CanvasNowPlaying(): React.JSX.Element | null {
  const now = useNow()
  const favicon = useTek((s) =>
    s.media.now ? s.tabs.find((t) => t.id === s.media.now!.tabId)?.favicon ?? null : null
  )
  // Un favicon corrupto no debe pintar una imagen rota: cae a la nota. Se
  // re-intenta si el favicon cambia (p. ej. llega el bueno tras la purga).
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [favicon])
  if (!now) return null
  const label = now.artist ? `${now.title} — ${now.artist}` : now.title
  // SOLO el favicon (data URL del cache): la caratula de la cancion es una URL
  // remota y la CSP del shell (img-src 'self' data:) la bloquea siempre.
  const img = broken ? null : favicon
  return (
    <div className={`canvas-np ${now.playing ? 'is-playing' : ''}`}>
      <button
        className="canvas-np-site"
        title={`${label} · ir a la pestaña`}
        onClick={() => void window.tek.tabs.activate(now.tabId)}
      >
        {img ? (
          <img className="canvas-np-favicon" src={img} alt="" onError={() => setBroken(true)} />
        ) : (
          <span className="canvas-np-note" aria-hidden>
            ♪
          </span>
        )}
      </button>
      <span className="canvas-np-eq" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </span>
      <MediaButtons now={now} />
    </div>
  )
}
