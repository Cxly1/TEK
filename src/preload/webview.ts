/// <reference lib="dom" />
import { ipcRenderer } from 'electron'

/**
 * Preload de las paginas (WebContentsView). Piezas: captura/relleno de
 * contrasenas, grabacion de macros y ANTI-ANUNCIOS de YouTube/Spotify — poda los
 * anuncios del "player response" ANTES de que el reproductor los lea. La capa de
 * red de Ghostery no puede con los anuncios de video porque YouTube los sirve
 * desde su propio dominio (googlevideo.com, igual que el video real); la unica
 * via fiable es quitar `adPlacements`/`playerAds`/`adSlots` del JSON del player
 * en el instante en que aparece. La inyeccion de scriptlets de Ghostery es
 * asincrona y suele llegar tarde; esto es sincrono, en document-start.
 *
 * ZOOM LUPA: en esta maquina el pinch del trackpad NO llega como gesto nativo
 * al compositor (probado en vivo: habilitar el zoom visual nativo no hizo nada)
 * y el CDP `Emulation.setPageScaleFactor` resulto NO-OP en desktop (probado
 * 2026-07-03). Asi que la lupa vive AQUI, sin dependencias: capturamos el
 * wheel+ctrl (unico camino por el que el pinch llega, comprobado) y escalamos
 * la pagina con `transform: scale()` anclado al puntero. Un transform no
 * relayouta: lupa pura, no zoom de pagina.
 *
 * CLAVE: este preload corre en el MAIN WORLD (`contextIsolation:false` en la
 * WebContentsView), por eso puede sobrescribir `fetch`/`JSON.parse` de la propia
 * pagina. Y es CommonJS porque los preload ESM no se ejecutan bajo `sandbox`.
 * No expone NADA a `window` (todo vive en este scope), asi la pagina no alcanza
 * `ipcRenderer` ni `require`.
 */

// --- Zoom LUPA (pinch del trackpad / Ctrl+rueda) ------------------------------
// Canal por el que el main pide quitar la lupa con Ctrl+0 (espejo de
// WV.lupaReset en src/shared/ipc.ts; inline: preload autocontenido).
const LUPA_RESET = 'wv:lupaReset'

let lupaScale = 1
let lupaX = 0
let lupaY = 0

/** Aplica (o quita) la lupa: transform en <html>, anclado donde empezo el gesto. */
function applyLupa(): void {
  const el = document.documentElement
  if (!el) return
  if (lupaScale <= 1.001) {
    lupaScale = 1
    el.style.transform = ''
    el.style.transformOrigin = ''
    return
  }
  el.style.transformOrigin = `${lupaX}px ${lupaY}px`
  el.style.transform = `scale(${lupaScale})`
}

window.addEventListener(
  'wheel',
  (e: WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    // El ancla se fija al EMPEZAR a agrandar (con la lupa en 1): lo que esta
    // bajo el puntero es lo que crece, y el resto del gesto gira alrededor.
    if (lupaScale === 1 && e.deltaY < 0) {
      lupaX = e.clientX + window.scrollX
      lupaY = e.clientY + window.scrollY
    }
    // deltaY < 0 (separar dedos) agranda; > 0 reduce. Tope 1x..4x.
    lupaScale = Math.max(1, Math.min(4, lupaScale * Math.exp(-e.deltaY * 0.002)))
    applyLupa()
  },
  { passive: false, capture: true }
)

// Ctrl+0 (lo resuelve el main en before-input-event) tambien quita la lupa.
ipcRenderer.on(LUPA_RESET, () => {
  lupaScale = 1
  applyLupa()
})

// --- Contrasenas: captura de submit + relleno bajo demanda -------------------
// Canales espejo de WV en src/shared/ipc.ts (inline: preload autocontenido).
const PW_CAPTURED = 'wv:pwCaptured'
const PW_FILL = 'wv:pwFillCreds'
const PW_FORM = 'wv:pwFormPresent'

// contextIsolation:false comparte el realm con la pagina (lo necesitamos para
// podar los anuncios de YouTube/Spotify, que viven en el MAIN world). Como este
// preload corre en document-start —ANTES de cualquier script de la pagina—
// capturamos AQUI el setter nativo de `value`: asi una pagina hostil no puede,
// mas tarde, redefinirlo (prototype-pollution) para interceptar el relleno de
// credenciales. El robo entre sitios ya es imposible aparte (el relleno es por
// host EXACTO y solo tras tu clic); esto es defensa en profundidad.
const nativeInputValueSet = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'value'
)?.set

/**
 * El campo de usuario "mas cercano" a un password: el ultimo input de
 * texto/email que aparece ANTES del password en el DOM (patron universal de
 * formularios de login). El main decide despues si ofrece guardar; aqui solo
 * recolectamos lo que la propia pagina ya tiene.
 */
function findUserField(scope: ParentNode, pwEl: HTMLInputElement): HTMLInputElement | null {
  const candidates = Array.from(
    scope.querySelectorAll<HTMLInputElement>(
      'input[type=email], input[autocomplete~=username], input[type=text], input:not([type])'
    )
  ).filter((el) => el !== pwEl && !el.disabled)
  let best: HTMLInputElement | null = null
  for (const el of candidates) {
    const pos = pwEl.compareDocumentPosition(el)
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) best = el
  }
  return best ?? candidates[0] ?? null
}

function captureCreds(pwEl: HTMLInputElement): void {
  const password = pwEl.value
  if (!password) return
  const scope: ParentNode = pwEl.form ?? document
  const userEl = findUserField(scope, pwEl)
  // El host NO viaja: el main lo deriva del webContents (la pagina no puede
  // hacerse pasar por otro sitio). El main ademas deduplica y pide confirmacion.
  ipcRenderer.send(PW_CAPTURED, { username: userEl?.value ?? '', password })
}

// Submit clasico de formulario.
document.addEventListener(
  'submit',
  (e) => {
    const form = e.target
    if (!(form instanceof HTMLFormElement)) return
    const pw = form.querySelector<HTMLInputElement>('input[type=password]')
    if (pw) captureCreds(pw)
  },
  true
)
// Logins de SPA sin <form>: Enter dentro del password o clic en un boton
// mientras hay un password con valor. El main descarta los duplicados.
document.addEventListener(
  'keydown',
  (e) => {
    const t = e.target
    if (e.key === 'Enter' && t instanceof HTMLInputElement && t.type === 'password' && t.value) {
      captureCreds(t)
    }
  },
  true
)
document.addEventListener(
  'click',
  (e) => {
    const t = e.target instanceof Element ? e.target : null
    if (!t?.closest('button, [type=submit], [role=button]')) return
    const pw = document.querySelector<HTMLInputElement>('input[type=password]')
    if (pw && pw.value) captureCreds(pw)
  },
  true
)

/** Fija el valor con el setter nativo (compatibilidad con React) + eventos. */
function setFieldValue(el: HTMLInputElement, value: string): void {
  // Usa el setter capturado en document-start (no relee el descriptor, que la
  // pagina podria haber envenenado despues de cargar).
  if (nativeInputValueSet) nativeInputValueSet.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// Relleno: SOLO llega desde el main, y el main solo lo manda tras un clic del
// usuario en la UI de TEK con el host verificado. Nada de autofill silencioso.
ipcRenderer.on(PW_FILL, (_e, creds: { username: string; password: string }) => {
  const pw = document.querySelector<HTMLInputElement>('input[type=password]')
  if (!pw) return
  if (creds.username) {
    const user = findUserField(pw.form ?? document, pw)
    if (user) setFieldValue(user, creds.username)
  }
  setFieldValue(pw, creds.password)
  pw.focus()
})

/**
 * ¿Hay AHORA MISMO un campo de contrasena visible donde tenga sentido rellenar?
 * Sin esto TEK ofrecia "credenciales guardadas" en CUALQUIER pagina del sitio
 * (leyendo un video de YouTube, por ejemplo), donde no habia nada que rellenar.
 * Miramos que exista, que no este oculto y que tenga tamano real en pantalla.
 */
function hasLoginField(): boolean {
  const fields = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=password]'))
  for (const el of fields) {
    if (el.disabled || el.readOnly) continue
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue // los honeypots miden 0
    const st = getComputedStyle(el)
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue
    return true
  }
  return false
}

// Avisamos al main SOLO cuando el estado cambia. Los logins de SPA aparecen
// despues de cargar (y desaparecen al entrar), asi que hay que vigilar el DOM;
// el observer va con throttle porque en sitios pesados el DOM muta sin parar.
let loginFieldSeen: boolean | null = null
function reportLoginField(): void {
  const now = hasLoginField()
  if (now === loginFieldSeen) return
  loginFieldSeen = now
  ipcRenderer.send(PW_FORM, now)
}

let formScanTimer: ReturnType<typeof setTimeout> | null = null
function scheduleLoginScan(): void {
  if (formScanTimer) return
  formScanTimer = setTimeout(() => {
    formScanTimer = null
    reportLoginField()
  }, 400)
}

window.addEventListener('DOMContentLoaded', () => {
  reportLoginField()
  new MutationObserver(scheduleLoginScan).observe(document.documentElement, {
    childList: true,
    subtree: true
  })
})

// --- Macros: grabacion de clics/teclas (solo con el modo encendido) ----------
const MACRO_EVENT = 'wv:macroEvent'
const MACRO_MODE = 'wv:macroMode'
const MACRO_IS_RECORDING = 'wv:macroIsRecording'

let recOn = false
ipcRenderer.on(MACRO_MODE, (_e, on: boolean) => {
  recOn = !!on
})
// Tras una navegacion el preload renace: pregunta si SU pestana esta grabando.
void ipcRenderer
  .invoke(MACRO_IS_RECORDING)
  .then((on: boolean) => {
    if (on) recOn = true
  })
  .catch(() => undefined)

/** Selector razonablemente robusto: id > name/testid > ruta nth-of-type. */
function selectorOf(el: Element): string {
  if (el.id) {
    const sel = `#${CSS.escape(el.id)}`
    if (document.querySelectorAll(sel).length === 1) return sel
  }
  const tag = el.tagName.toLowerCase()
  for (const attr of ['name', 'data-testid', 'aria-label']) {
    const v = el.getAttribute(attr)
    if (v) {
      const sel = `${tag}[${attr}="${CSS.escape(v)}"]`
      try {
        if (document.querySelectorAll(sel).length === 1) return sel
      } catch {
        /* valor raro para un selector: sigue */
      }
    }
  }
  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur !== document.documentElement && parts.length < 6) {
    if (cur.id) {
      parts.unshift(`#${CSS.escape(cur.id)}`)
      break
    }
    let part = cur.tagName.toLowerCase()
    const parent: Element | null = cur.parentElement
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName)
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`
    }
    parts.unshift(part)
    cur = parent
  }
  return parts.join(' > ')
}

document.addEventListener(
  'click',
  (e) => {
    if (!recOn) return
    const t = e.target instanceof Element ? e.target : null
    if (!t) return
    const el =
      t.closest(
        'a, button, [role=button], input[type=submit], input[type=button], input[type=checkbox], input[type=radio], select, summary, label'
      ) ?? t
    ipcRenderer.send(MACRO_EVENT, { type: 'click', selector: selectorOf(el) })
  },
  true
)
document.addEventListener(
  'change',
  (e) => {
    if (!recOn) return
    const t = e.target
    const isField =
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
    if (!isField) return
    // SEGURIDAD: el valor de un campo de contrasena JAMAS se graba en una macro
    // (acabaria en texto plano en el JSON de macros).
    if (t instanceof HTMLInputElement && t.type === 'password') return
    ipcRenderer.send(MACRO_EVENT, { type: 'input', selector: selectorOf(t), value: t.value })
  },
  true
)
document.addEventListener(
  'keydown',
  (e) => {
    if (!recOn || e.key !== 'Enter') return
    const t = e.target instanceof Element ? e.target : null
    if (!t) return
    ipcRenderer.send(MACRO_EVENT, { type: 'key', selector: selectorOf(t), key: 'Enter' })
  },
  true
)

// --- Anti-anuncios de YouTube (solo en hosts de YouTube) ---------------------
;(function defuseYouTubeAds(): void {
  const host = location.hostname
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return

  // Claves de anuncios dentro del player/browse/next response.
  const AD_KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams']

  /** Quita las claves de anuncios de un objeto (y de su playerResponse anidado). */
  const prune = (obj: unknown, depth = 0): unknown => {
    if (!obj || typeof obj !== 'object' || depth > 4) return obj
    const o = obj as Record<string, unknown>
    for (const k of AD_KEYS) {
      if (k in o) {
        try {
          delete o[k]
        } catch {
          /* propiedad no configurable: ignora */
        }
      }
    }
    // El player response puede venir anidado en estas envolturas comunes.
    if (o.playerResponse) prune(o.playerResponse, depth + 1)
    if (o.response) prune(o.response, depth + 1)
    return obj
  }

  // 1) JSON.parse: cubre respuestas leidas como texto y luego parseadas.
  try {
    const orig = JSON.parse
    JSON.parse = function (this: unknown, ...args: Parameters<typeof JSON.parse>) {
      const out = orig.apply(this, args)
      try {
        return prune(out)
      } catch {
        return out
      }
    }
  } catch {
    /* no se pudo envolver JSON.parse */
  }

  // 2) Response.json: cubre las llamadas fetch a /youtubei/v1/player|next|browse.
  try {
    const origJson = Response.prototype.json
    Response.prototype.json = function (this: Response) {
      return origJson.apply(this, []).then((data: unknown) => {
        try {
          return prune(data)
        } catch {
          return data
        }
      })
    }
  } catch {
    /* no se pudo envolver Response.json */
  }

  // 3) ytInitialPlayerResponse: el pre-roll inicial llega como objeto inline (no
  //    pasa por JSON.parse). Lo interceptamos con un setter que poda al asignar.
  try {
    let stored: unknown
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() {
        return stored
      },
      set(v: unknown) {
        stored = prune(v)
      }
    })
  } catch {
    /* otro script ya lo definio como no-configurable */
  }

  // 4) ANTI-MURO anti-adblock ("Los bloqueadores de anuncios incumplen las
  //    Condiciones del Servicio de YouTube"). NO secuestramos el objeto `yt`
  //    entero (reemplazarlo con un accessor rompia la carga del reproductor):
  //    solo (a) ponemos a false el flag del popup en cuanto exista la ruta —esto
  //    evita el muro de raiz—, (b) si el modal aparece igual quitamos SU dialogo
  //    (no el ytd-popup-container, que YouTube reutiliza para los menus) y
  //    reanudamos el video, y (c) saltamos un anuncio que llegue a reproducirse.
  type YtPopups = { adBlockMessageViewModel?: unknown }
  type YtRoot = { config_?: { openPopupConfig?: { supportedPopups?: YtPopups } } }
  const disableWall = (): void => {
    try {
      const yt = (window as unknown as { yt?: YtRoot }).yt
      const pops = yt?.config_?.openPopupConfig?.supportedPopups
      if (pops && pops.adBlockMessageViewModel !== false) pops.adBlockMessageViewModel = false
    } catch {
      /* supportedPopups inmutable: queda el respaldo del DOM */
    }
  }

  // Aceleramos un anuncio imposible de saltar: hay que deshacerlo al terminar
  // (YouTube REUSA el mismo <video> para el contenido).
  let adRateApplied = false

  const killAdWall = (): void => {
    // config_ se llena despues de crear yt: reafirmamos el flag cada vuelta.
    disableWall()
    // Si el modal aparece igual: quitamos SU dialogo + backdrop (no el contenedor
    // compartido) y reanudamos el video que el muro pauso.
    const enforcement = document.querySelector('ytd-enforcement-message-view-model')
    if (enforcement) {
      ;(enforcement.closest('tp-yt-paper-dialog') ?? enforcement).remove()
      document.querySelector('tp-yt-iron-overlay-backdrop')?.remove()
      // YouTube bloquea el scroll y pausa el video al mostrar el muro: revierte.
      document.documentElement.style.overflow = ''
      if (document.body) document.body.style.overflow = ''
      const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')
      if (v && v.paused) void v.play().catch(() => undefined)
    }
    // Red de seguridad: salta el anuncio de video que llegue a reproducirse.
    const player = document.querySelector('.html5-video-player')
    if (player?.classList.contains('ad-showing')) {
      const v = player.querySelector<HTMLVideoElement>('video')
      if (v && isFinite(v.duration) && v.duration > 0) {
        try {
          v.currentTime = v.duration
        } catch {
          /* currentTime aun no asignable */
        }
      } else if (v) {
        // Anuncio SIN duracion finita (insercion server-side / live): no hay a
        // donde saltar; se consume rapido y en silencio. Antes esto dejaba el
        // player atorado "cargando".
        try {
          v.muted = true
          v.playbackRate = 8
          adRateApplied = true
        } catch {
          /* playbackRate no asignable aun */
        }
      }
      document
        .querySelector<HTMLElement>(
          '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button'
        )
        ?.click()
    } else if (adRateApplied) {
      // El anuncio acelerado termino: restaura el <video> para el contenido.
      adRateApplied = false
      const v = document.querySelector<HTMLVideoElement>('video.html5-main-video')
      if (v) {
        try {
          v.playbackRate = 1
          v.muted = false
        } catch {
          /* sin video que restaurar */
        }
      }
    }
  }

  // ANTI-ATASCO: con los anuncios podados, el player a veces se queda "cargando"
  // eterno al arrancar (espera un hueco de anuncio server-side que nunca llega).
  // Si el video lleva >5s buffereando al principio sin avanzar, un seek minimo
  // via la API del player lo desatasca. Un solo rescate por URL.
  let stallSince = 0
  let nudgedFor = ''
  const checkStall = (): void => {
    const player = document.querySelector('.html5-video-player')
    const v = player?.querySelector<HTMLVideoElement>('video')
    if (!player || !v || player.classList.contains('ad-showing') || v.paused) {
      stallSince = 0
      return
    }
    const stuck = v.currentTime < 1 && v.readyState < 3 // sin datos para avanzar
    if (!stuck) {
      stallSince = 0
      return
    }
    if (stallSince === 0) {
      stallSince = Date.now()
      return
    }
    if (Date.now() - stallSince > 5000 && nudgedFor !== location.href) {
      nudgedFor = location.href
      stallSince = 0
      try {
        const mp = player as unknown as { seekTo?: (t: number, allowAhead?: boolean) => void }
        if (typeof mp.seekTo === 'function') mp.seekTo(Math.max(0.1, v.currentTime + 0.1), true)
        else v.currentTime += 0.1
        void v.play().catch(() => undefined)
        console.debug('[tek] yt-defuse: player atascado al inicio; seek de rescate')
      } catch {
        /* el player no acepto el seek: no insistimos */
      }
    }
  }

  const startWallWatch = (): void => {
    // YouTube muta el DOM SIN PARAR: correr killAdWall en cada mutacion era
    // trabajo constante del main thread (podia hacer sentir lenta la carga).
    // Throttle: como mucho una pasada cada 300ms; el resto lo cubre el interval.
    let wallPending = false
    const scheduleWall = (): void => {
      if (wallPending) return
      wallPending = true
      setTimeout(() => {
        wallPending = false
        killAdWall()
      }, 300)
    }
    try {
      new MutationObserver(scheduleWall).observe(document.documentElement, {
        childList: true,
        subtree: true
      })
    } catch {
      /* sin observer: queda el intervalo */
    }
    setInterval(() => {
      killAdWall()
      checkStall()
    }, 1000)
    killAdWall()
  }
  if (document.documentElement) startWallWatch()
  else document.addEventListener('DOMContentLoaded', startWallWatch, { once: true })
})()

// --- Anti-anuncios de Spotify (solo en open.spotify.com) ---------------------
// Spotify Free mete sus anuncios de audio como pistas normales en la maquina de
// reproduccion, y desde su PROPIO dominio (first-party, igual que YouTube). La
// capa de RED no los para, asi que los neutralizamos aqui, en el cliente.
;(function defuseSpotifyAds(): void {
  if (location.hostname !== 'open.spotify.com') return

  const TAG = '[tek] spotify-adblock:'
  const BLOB = 'blob:https://open.spotify.com/'

  // Guardas en sessionStorage: sobreviven a los reload de esta misma pestana.
  const RELOADS_KEY = 'tek-sp-reloads'
  const RESUME_KEY = 'tek-sp-resume'

  /** Recarga con freno anti-bucle: como mucho 2 recargas cada 5 minutos. */
  const guardedReload = (why: string): void => {
    let stamps: number[] = []
    try {
      const raw = JSON.parse(sessionStorage.getItem(RELOADS_KEY) ?? '[]')
      if (Array.isArray(raw)) {
        stamps = raw.filter((t) => typeof t === 'number' && Date.now() - t < 300_000)
      }
    } catch {
      /* JSON roto: empezamos de cero */
    }
    if (stamps.length >= 2) {
      console.debug(`${TAG} ${why}, pero ya recargue 2 veces en 5 min; no insisto`)
      return
    }
    stamps.push(Date.now())
    try {
      sessionStorage.setItem(RELOADS_KEY, JSON.stringify(stamps))
    } catch {
      /* sin sessionStorage: recargamos igual */
    }
    console.debug(`${TAG} ${why}; recargando`)
    location.reload()
  }

  // 1) Capa PRINCIPAL — heuristica de <audio>, agnostica del backend.
  //    La musica real se reproduce con MediaSource: su `src` es siempre un blob
  //    `blob:https://open.spotify.com/...`. Un audio cuyo src NO es ese blob y
  //    que dura poco es un anuncio -> lo silenciamos y saltamos al final, con lo
  //    que su `ended` dispara y el reproductor avanza solo.
  //    GOTCHA (en vivo 2026-07-18): Spotify REUSA el mismo elemento para la
  //    siguiente cancion. Sin restaurar muted/playbackRate al volver el blob, la
  //    musica quedaba MUDA (el bug de "no pasa el anuncio pero tampoco la
  //    cancion"). Igual que hace la seccion de YouTube con su <video>.
  const media = new Set<HTMLMediaElement>() // iterable: el vigia de abajo lo recorre
  const doctored = new WeakSet<HTMLMediaElement>() // elementos tocados en modo anuncio
  const lastPos = new WeakMap<HTMLMediaElement, number>()
  let adSeenAt = 0 // ultima vez que esta capa vio un anuncio
  let lastMusicAt = Date.now() // ultima vez que un blob (musica) avanzo

  const watchMedia = (el: HTMLMediaElement): void => {
    if (media.has(el)) return
    if (media.size > 16) {
      const oldest = media.values().next().value
      if (oldest) media.delete(oldest)
    }
    media.add(el)
    const onState = (): void => {
      const src = el.currentSrc || el.src || ''
      if (!src) return
      if (src.startsWith(BLOB)) {
        // Musica real. Si ESTE elemento venia de un anuncio, restauralo.
        if (doctored.has(el)) {
          doctored.delete(el)
          try {
            el.muted = false
            el.playbackRate = 1
          } catch {
            /* no restaurable en este estado */
          }
          console.debug(`${TAG} elemento restaurado para la musica`)
        }
        return
      }
      const dur = el.duration
      // Salvaguarda anti-falsos-positivos: solo audio corto / sin duracion aun.
      if (isFinite(dur) && dur >= 45) return
      adSeenAt = Date.now()
      doctored.add(el)
      try {
        el.muted = true
      } catch {
        /* muted read-only en algun estado */
      }
      try {
        if (isFinite(dur) && dur > 0) el.currentTime = dur // consume el anuncio
        else el.playbackRate = 16 // aun sin duracion: acelera hasta que termine
      } catch {
        /* currentTime/playbackRate no asignables aun */
      }
      console.debug(`${TAG} anuncio de audio saltado (dur=${dur})`)
    }
    for (const ev of ['loadedmetadata', 'durationchange', 'play', 'playing'] as const) {
      el.addEventListener(ev, onState)
    }
    onState()
  }

  // play() "ve" todo audio en cuanto suena, este o no adjunto al DOM.
  try {
    const origPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      try {
        watchMedia(this)
      } catch {
        /* no se pudo enganchar el watcher */
      }
      return origPlay.apply(this)
    }
  } catch {
    /* no se pudo envolver play() */
  }

  // 2) Capa DE RESCATE — si aun asi un corte de anuncios deja el reproductor
  //    atascado (senal de anuncio a la vista y la musica sin avanzar >8s),
  //    recargamos: al volver, Spotify retoma la cola ya sin el anuncio y aqui
  //    mismo le damos Play. [Antes aqui vivia una capa que mutaba las
  //    respuestas de track-playback con campos adivinados; fuera — era la otra
  //    sospechosa de atascar la maquina de estados y la de audio ya cubre.]
  const AD_RX = /\b(advertisement|anuncio)\b/i
  const adOnScreen = (): boolean => {
    if (AD_RX.test(document.title)) return true
    const w = document.querySelector('[data-testid="now-playing-widget"]')
    return !!w && AD_RX.test(w.textContent ?? '')
  }
  const musicAlive = (): boolean => {
    for (const el of media) {
      const src = el.currentSrc || el.src || ''
      if (!src.startsWith(BLOB) || el.paused) continue
      const pos = el.currentTime
      if (pos !== lastPos.get(el)) {
        lastPos.set(el, pos)
        lastMusicAt = Date.now()
      }
    }
    return Date.now() - lastMusicAt < 3000
  }

  let stuckSince = 0
  setInterval(() => {
    const adSignal = adOnScreen() || Date.now() - adSeenAt < 8000
    if (!adSignal || musicAlive()) {
      stuckSince = 0
      return
    }
    if (stuckSince === 0) {
      stuckSince = Date.now()
      return
    }
    if (Date.now() - stuckSince > 8000) {
      stuckSince = 0
      try {
        sessionStorage.setItem(RESUME_KEY, String(Date.now()))
      } catch {
        /* sin marca de resume: la recarga igual saca del atasco */
      }
      guardedReload('anuncio atascado sin avanzar a la cancion')
    }
  }, 1000)

  // Tras una recarga por anuncio: Play en cuanto el boton exista, y SOLO si de
  // verdad esta en "Play" (si ya suena o el usuario pauso, no tocamos nada).
  const tryResume = (): void => {
    let t0 = 0
    try {
      t0 = Number(sessionStorage.getItem(RESUME_KEY) ?? '0')
      if (t0) sessionStorage.removeItem(RESUME_KEY)
    } catch {
      return
    }
    if (!t0 || Date.now() - t0 > 45_000) return
    const deadline = Date.now() + 20_000
    const timer = setInterval(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="control-button-playpause"]'
      )
      const label = btn?.getAttribute('aria-label') ?? ''
      if (btn && /^(play|reproducir)/i.test(label)) {
        btn.click()
        console.debug(`${TAG} musica reanudada tras saltar el anuncio`)
        clearInterval(timer)
      } else if (/^(pause|pausar)/i.test(label) || Date.now() > deadline) {
        clearInterval(timer)
      }
    }, 500)
  }
  tryResume()

  // 3) Capa COSMETICA — oculta el banner/leaderboard de anuncio si aparece.
  try {
    const style = document.createElement('style')
    style.textContent =
      '[data-testid="ad-slot-container"],[data-testid="hpto-container"],[aria-label="Advertisement"]{display:none!important}'
    const attach = (): void => {
      ;(document.head || document.documentElement).appendChild(style)
    }
    if (document.head) attach()
    else document.addEventListener('DOMContentLoaded', attach, { once: true })
  } catch {
    /* no se pudo inyectar el CSS cosmetico */
  }

  // 4) RESCATE DE CARGA — a veces la primera carga se queda en el HTML del
  //    server (contenido suelto, sin sidebar ni barra de reproduccion: la
  //    hidratacion murio) y solo un refresh la arregla. Si con la pagina ya
  //    completa no aparece NINGUNA pieza del shell, recargamos una vez, que es
  //    exactamente lo que hacia el usuario a mano. Mismo freno anti-bucle.
  const HYDRATED =
    '[data-testid="now-playing-bar"], [data-testid="left-sidebar"], [data-testid="search-input"], [data-testid="root"] nav'
  let hydroChecks = 0
  const checkHydrated = (): void => {
    if (document.querySelector(HYDRATED)) return
    // Aun descargando (readyState != complete): juzga mas tarde, hasta ~30s.
    if (document.readyState !== 'complete' && hydroChecks++ < 10) {
      setTimeout(checkHydrated, 3000)
      return
    }
    guardedReload('shell sin hidratar tras la carga')
  }
  setTimeout(checkHydrated, 8000)
})()
