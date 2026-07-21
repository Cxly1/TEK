/// <reference lib="dom" />
import { ipcRenderer } from 'electron'

/**
 * Preload de las paginas (WebContentsView). Piezas: captura/relleno de
 * contrasenas, grabacion de macros, ANTI-ANUNCIOS de YouTube (inyecta los
 * scriptlets de uBO en document_start, ver bloque de abajo) y un defuser propio
 * de Spotify (sus anuncios de audio no viajan por la red filtrable). El defuser
 * casero de YouTube que podaba `adPlacements`/`playerAds` a mano SE QUITO: chocaba
 * con los scriptlets de uBO (el metodo real de Brave) y era justo lo que YouTube
 * detectaba. Ahora YouTube se trata como cualquier sitio, con esos scriptlets.
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

/**
 * "Permitir sitio" en el escudo = TEK NO TOCA esta pagina. Ni filtrado de red
 * (eso lo hace el main) ni los defusers de anuncios de aqui abajo.
 *
 * Importa de verdad en YouTube: su anti-adblock tambien detecta que le hemos
 * PODADO el player-response, no solo que le bloqueemos peticiones. Sin esta
 * salida no habia forma de decirle a TEK "dejalo en paz" y el reproductor se
 * quedaba en negro con el aviso de "desactiva el bloqueador".
 *
 * Sincrono a proposito: la respuesta decide si parcheamos globales, y eso tiene
 * que ocurrir ANTES del primer script de la pagina. Es una sola llamada por carga.
 */
const SITE_UNTOUCHED = 'wv:siteUntouched'
let untouched = false
try {
  untouched = ipcRenderer.sendSync(SITE_UNTOUCHED, location.hostname) === true
} catch {
  /* si el main no contesta, seguimos como siempre (protegiendo) */
}

// --- Scriptlets del adblock (document_start, ANTES que la pagina) ------------
// La pieza que le faltaba al "metodo Brave": los `+js(...)` de las listas de
// uBO (los set-constant que desarman el detector anti-adblock de YouTube, las
// podas de anuncios por json-edit/replace-fetch...) SOLO funcionan si corren
// antes del primer script de la pagina. El adaptador de Ghostery los manda con
// webContents.executeJavaScript, que con la pagina cargando espera a
// did-stop-loading: en YouTube llegaban tarde y el muro salia igual. Aqui se
// piden sincronos al main (espejo de WV.adScripts) y se ejecutan YA; el main
// le quita los scripts al camino del adaptador para no inyectarlos dos veces
// (ver Adblock.setBlocker). El COMO (aislar cada scriptlet, Trusted Types) va
// documentado abajo, junto a cada paso.
const AD_SCRIPTS = 'wv:adScripts'
;(function injectAdScriptlets(): void {
  if (untouched) return
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return
  let scripts: unknown
  try {
    scripts = ipcRenderer.sendSync(AD_SCRIPTS, location.href)
  } catch {
    return
  }
  if (!Array.isArray(scripts) || scripts.length === 0) return

  // Se construye UN bundle con todos los scriptlets, cada uno en su propia IIFE
  // + try/catch. La IIFE es la cura de la recursion: el motor devuelve 34 trozos
  // con 17 copias de `function safeSelf`/`proxyApplyFn` (la maquinaria
  // anti-deteccion de uBO que envuelve Reflect.apply en un Proxy). En scope
  // compartido se pisan, re-envuelven un Reflect.apply YA envuelto y el trap se
  // llama a si mismo -> RangeError "Maximum call stack" que ademas envenena el
  // apply global y tumbaba el JS de YouTube (kevlar). Aislados, cada uno instala
  // sus proxies de forma coherente. Se DEDUPLICAN los identicos (5 de 34).
  // Red de seguridad DENTRO del bundle: si un scriptlet recursa igual, su catch
  // restaura los nativos guardados en `__ra/__fa/__ft` -> se pierde ESE, no la
  // pagina.
  const seen = new Set<string>()
  const parts: string[] = []
  for (const code of scripts) {
    if (typeof code !== 'string' || seen.has(code)) continue
    seen.add(code)
    parts.push(
      `try{(function(){${code}\n})()}catch(_e){if(_e&&_e.name==='RangeError'){` +
        `try{Reflect.apply=__ra}catch(_){}` +
        `try{Function.prototype.apply=__fa}catch(_){}` +
        `try{Function.prototype.toString=__ft}catch(_){}` +
        `}}`
    )
  }
  if (parts.length === 0) return
  const bundle =
    `(function(){var __ra=Reflect.apply,__fa=Function.prototype.apply,` +
    `__ft=Function.prototype.toString;\n${parts.join('\n')}\n})();`

  // Como inyectarlo. YouTube fuerza Trusted Types (`require-trusted-types-for
  // 'script'`): ahi eval NO vale — el eval INDIRECTO ni siquiera EJECUTA un
  // TrustedScript, lo devuelve tal cual (por eso la 1a version "no hacia nada" y
  // el muro seguia). La via que SI corre bajo TT es un <script> cuyo `.text` es
  // un TrustedScript. Sin TT, el eval indirecto (alcance global) basta. Un probe
  // decide; el fallo del probe deja un unico aviso de CSP en consola, inofensivo.
  let plainOk = true
  try {
    ;(0, eval)('0')
  } catch {
    plainOk = false
  }
  if (plainOk) {
    try {
      ;(0, eval)(bundle)
      console.debug(`[tek] adblock: ${parts.length} scriptlets via eval`)
    } catch (e) {
      console.debug('[tek] adblock: eval del bundle rechazado:', e)
    }
    return
  }

  // Camino Trusted Types (o CSP sin unsafe-eval): <script> con .text.
  try {
    interface TTPolicy {
      createScript(s: string): unknown
    }
    const tt = (window as { trustedTypes?: { createPolicy(n: string, r: unknown): TTPolicy } })
      .trustedTypes
    const policy = tt ? tt.createPolicy('tek-adblock', { createScript: (s: string) => s }) : null
    const el = document.createElement('script')
    // `.text` acepta el TrustedScript (o el string pelado si no hubiera TT).
    ;(el as unknown as { text: unknown }).text = policy ? policy.createScript(bundle) : bundle
    // A document_start existe <html>; <head> puede que aun no. Un <script> inline
    // creado por JS (no por el parser) corre igual bajo strict-dynamic.
    ;(document.head || document.documentElement).appendChild(el)
    el.remove()
    console.debug(`[tek] adblock: ${parts.length} scriptlets via <script> (TT=${!!policy})`)
  } catch (e) {
    console.debug('[tek] adblock: inyeccion por <script> rechazada:', e)
  }
})()

// --- YouTube: fingir INACTIVIDAD para que no sirva sus anuncios casa ----------
// Los anuncios que se cuelan son de YouTube MISMO (Premium/Music, `AdSense-Viral`)
// y NO viven en adPlacements de forma podable: YouTube decide servirlos segun tu
// "tiempo desde la ultima interaccion" (`lactMilliseconds` en la peticion a
// /youtubei/v1/player). Poniendolo ENORME, YouTube cree que llevas una eternidad
// sin tocar nada y NO mete el anuncio. Es el mismo enfoque que uBO, pero:
//   - INCONDICIONAL (uBO lo hace condicional a un marcador que ponen OTROS
//     scriptlets — esa coordinacion multi-paso es justo lo que no sobrevive a la
//     inyeccion aislada; aqui va directo).
//   - fetch Y XHR (uBO solo intercepta XHR; el YouTube de hoy pide /player por
//     fetch, por eso el `lact=1571` que veiamos en consola: el truco no aplicaba).
// Editar la PETICION (no la respuesta) es INDETECTABLE: YouTube no puede saber
// que mentiste sobre tu inactividad; a diferencia de podar adPlacements de la
// respuesta —que YouTube SI detecta— esto no reactiva el muro. Todo con
// try/catch y sin tocar el cuerpo si no cuadra: nunca puede romper el player.
;(function spoofLactYouTube(): void {
  if (untouched) return
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)) return

  const isPlayerReq = (url: string): boolean => /\/youtubei\/v[0-9]+\/player(\?|$)/.test(url)

  /** Mete un lact enorme en el cuerpo JSON del /player. Devuelve el cuerpo tal
   *  cual si no es el JSON esperado (jamas rompe la peticion). */
  const spoofBody = (body: string): string => {
    try {
      const data = JSON.parse(body) as {
        context?: { contentPlaybackContext?: Record<string, unknown> }
      }
      const cpc = data?.context?.contentPlaybackContext
      if (!cpc || typeof cpc !== 'object') return body
      // Enorme = "hace una eternidad que no interactuo" = inactivo -> sin ads.
      cpc.lactMilliseconds = String(Date.now())
      return JSON.stringify(data)
    } catch {
      return body
    }
  }

  // fetch: YouTube pide /player por aqui. CLAVE (era el fallo de la 1a version):
  // YouTube REEMPLAZA `window.fetch` con el suyo DESPUES de nosotros, asi que un
  // wrap normal quedaba PISADO y el spoof no se aplicaba (por eso seguia el
  // `lact=1571` en consola). Aqui `window.fetch` pasa a ser un getter/setter: lo
  // que YouTube asigne se RE-ENVUELVE, de modo que nuestro spoof queda SIEMPRE por
  // encima, gane quien gane la carrera. `toString` finge nativo para no delatarse.
  try {
    const wrap = (f: typeof window.fetch): typeof window.fetch => {
      const wrapped = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
        try {
          const url =
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.href
                : (input as Request).url
          if (isPlayerReq(url) && init && typeof init.body === 'string') {
            init = { ...init, body: spoofBody(init.body) }
          }
        } catch {
          /* cualquier fallo: peticion intacta */
        }
        return f.call(this as typeof window, input, init)
      } as typeof window.fetch
      try {
        wrapped.toString = () => f.toString()
      } catch {
        /* toString no reescribible: da igual */
      }
      return wrapped
    }
    let current = wrap(window.fetch)
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      get() {
        return current
      },
      set(v: typeof window.fetch) {
        // YouTube puso el suyo: lo envolvemos y seguimos mandando nosotros.
        try {
          current = wrap(v)
        } catch {
          current = v
        }
      }
    })
  } catch {
    /* no se pudo instalar el getter/setter: sin spoof de fetch */
  }

  // XHR: por si alguna carga usa el camino clasico.
  try {
    const urlByXhr = new WeakMap<XMLHttpRequest, string>()
    const origOpen = XMLHttpRequest.prototype.open
    const origSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ) {
      try {
        urlByXhr.set(this, typeof url === 'string' ? url : url.href)
      } catch {
        /* ignora */
      }
      // @ts-expect-error firma variadica del open original
      return origOpen.call(this, method, url, ...rest)
    } as typeof XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest,
      body?: Document | XMLHttpRequestBodyInit | null
    ) {
      try {
        const url = urlByXhr.get(this) ?? ''
        if (isPlayerReq(url) && typeof body === 'string') body = spoofBody(body)
      } catch {
        /* peticion intacta */
      }
      return origSend.call(this, body)
    } as typeof XMLHttpRequest.prototype.send
  } catch {
    /* no se pudo envolver XHR */
  }
})()

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

// --- Anuncios de YouTube: los quita el ADBLOCK, no este preload --------------
//
// Aqui vivia un "defuser" propio que parcheaba JSON.parse, Response.prototype.json
// y ytInitialPlayerResponse para borrar adPlacements/playerAds. FUERA, y a
// proposito, tras diagnosticarlo con Migue el 2026-07-20:
//
//  - YouTube ya no solo mira si le bloqueas peticiones: comprueba si le han
//    PODADO el player-response. Nuestra version cruda se notaba -> salia el aviso
//    "desactiva el bloqueador" y el reproductor se quedaba en NEGRO.
//  - Y peor: colisionaba con la solucion buena. El motor de Ghostery ya se baja
//    los scriptlets de uBlock Origin (147 cargados, 34 aplicables a youtube.com;
//    medido en __ztest__/probe-scriptlets.mjs) y ESE es el metodo que usa Brave:
//    set-constant para neutralizar los detectores (Object.prototype.adBlocksFound,
//    adBlockMessageViewModel...) mas json-edit-xhr-request / replace-fetch-response
//    para podar los anuncios sin dejar huella. Dos capas peleandose por JSON.parse
//    y por fetch = no funciona ninguna de las dos.
//
// Asi que YouTube se trata como cualquier otro sitio: sin exencion de red y sin
// parches nuestros. Quien mantiene esto son los de uBO, que estan en esa guerra a
// diario. Si vuelve a fallar, la respuesta NO es volver a parchear globales aqui:
// es comprobar que los scriptlets se esten inyectando de verdad.

// --- Anti-anuncios de Spotify (solo en open.spotify.com) ---------------------
// Spotify Free mete sus anuncios de audio como pistas normales en la maquina de
// reproduccion, y desde su PROPIO dominio (first-party, igual que YouTube). La
// capa de RED no los para, asi que los neutralizamos aqui, en el cliente.
;(function defuseSpotifyAds(): void {
  if (location.hostname !== 'open.spotify.com') return
  // Permitido en el escudo: ni lo miramos (ver SITE_UNTOUCHED arriba).
  if (untouched) return

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

// --- MediaSession: "Ahora suena" + control de reproduccion -------------------
// Sube al main los metadatos que la pagina publica en navigator.mediaSession
// (titulo, artista, caratula) y ejecuta las ordenes de reproduccion que llegan
// de vuelta (chip de la barra, teclas multimedia y el "una pestana a la vez").
// NO depende del escudo (`untouched`): controlar tu musica no es bloquear
// anuncios, funciona igual en sitios permitidos.
//
// Como corre en el MAIN WORLD (contextIsolation:false), se puede envolver el
// prototipo de MediaSession: el setter de `metadata` avisa en el instante en
// que cambia la cancion (cero polling util) y `setActionHandler` nos deja
// GUARDAR los handlers que registra el sitio — "siguiente"/"anterior" se hacen
// invocando exactamente la funcion que el sitio le daria a Chromium, que es lo
// que hace el propio navegador con las teclas multimedia.
;(function nowPlayingBridge(): void {
  if (location.protocol !== 'https:' && location.protocol !== 'http:') return

  const MEDIA_META = 'wv:mediaMeta'
  const MEDIA_CONTROL = 'wv:mediaControl'

  /** Handlers que la pagina registro con mediaSession.setActionHandler. */
  const msHandlers = new Map<string, MediaSessionActionHandler | null>()
  /** Todo <video>/<audio> que haya llamado a play() (incluye los sueltos, sin DOM). */
  const mediaEls = new Set<HTMLMediaElement>()

  // YouTube en video suelto a veces NO registra nexttrack/previoustrack (solo
  // en playlists/Mix): fallback = los botones reales del player (selectores
  // .ytp-* estables desde hace años). Visible de verdad, no display:none.
  const ytBtn = (sel: string): HTMLButtonElement | null => {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return null
    const b = document.querySelector<HTMLButtonElement>(sel)
    return b && b.offsetParent !== null ? b : null
  }

  /**
   * ¿Esta pagina tiene un REPRODUCTOR de verdad (y no solo un "ping" de
   * notificacion)? Sin esto, el sonidito de 2s de WhatsApp capturaba los
   * controles y el play quedaba apuntando a la nada. Cuenta como reproductor:
   * publicar MediaMetadata, registrar handlers de MediaSession, o tener un
   * medio de >=20s (o en vivo). Una notificacion no cumple ninguna.
   */
  const isRealPlayer = (meta: MediaMetadata | null): boolean => {
    if (meta?.title) return true
    if (msHandlers.get('play') || msHandlers.get('pause') || msHandlers.get('nexttrack')) return true
    for (const el of mediaEls) {
      if (el.duration === Infinity || (isFinite(el.duration) && el.duration >= 20)) return true
    }
    return false
  }

  const anyPlaying = (): boolean => {
    for (const el of mediaEls) if (!el.paused && !el.ended) return true
    // Sin elementos vistos aun (p. ej. reproductor en shadow DOM que arranco
    // antes que nosotros): vale lo que declare el sitio.
    try {
      return navigator.mediaSession.playbackState === 'playing'
    } catch {
      return false
    }
  }

  /** Caratula mas grande de metadata.artwork, como URL http(s) absoluta. */
  const artworkOf = (meta: MediaMetadata | null): string | null => {
    const list = meta?.artwork
    if (!list || list.length === 0) return null
    let best: string | null = null
    let bestPx = -1
    for (const a of list) {
      const px = parseInt(String(a.sizes ?? '').split('x')[0], 10) || 0
      if (px < bestPx) continue
      try {
        const u = new URL(String(a.src), location.href)
        if (u.protocol === 'https:' || u.protocol === 'http:') {
          best = u.href.slice(0, 2000)
          bestPx = px
        }
      } catch {
        /* src invalido: probamos la siguiente */
      }
    }
    return best
  }

  let lastSent = ''
  const report = (): void => {
    let meta: MediaMetadata | null = null
    try {
      meta = navigator.mediaSession.metadata
    } catch {
      /* sin MediaSession: seguimos con fallbacks */
    }
    const payload = {
      title: String(meta?.title || document.title || '').slice(0, 200),
      artist: String(meta?.artist ?? '').slice(0, 200),
      artwork: artworkOf(meta),
      playing: anyPlaying(),
      canNext: !!msHandlers.get('nexttrack') || !!ytBtn('.ytp-next-button'),
      canPrev: !!msHandlers.get('previoustrack') || !!ytBtn('.ytp-prev-button'),
      real: isRealPlayer(meta)
    }
    const key = JSON.stringify(payload)
    if (key === lastSent) return
    lastSent = key
    try {
      ipcRenderer.send(MEDIA_META, payload)
    } catch {
      /* contexto destruyendose */
    }
  }
  let reportTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleReport = (): void => {
    if (reportTimer) return
    reportTimer = setTimeout(() => {
      reportTimer = null
      report()
    }, 150)
  }

  // Envoltura del prototipo: metadata/playbackState avisan al cambiar, y
  // setActionHandler nos guarda (o borra, con null) el handler del sitio.
  try {
    const proto = MediaSession.prototype
    for (const prop of ['metadata', 'playbackState'] as const) {
      const desc = Object.getOwnPropertyDescriptor(proto, prop)
      if (desc?.set && desc.get && desc.configurable) {
        Object.defineProperty(proto, prop, {
          configurable: true,
          get() {
            return desc.get!.call(this)
          },
          set(v) {
            desc.set!.call(this, v)
            scheduleReport()
          }
        })
      }
    }
    const origSetAction = proto.setActionHandler
    proto.setActionHandler = function (action, handler): void {
      msHandlers.set(String(action), handler)
      scheduleReport()
      return origSetAction.call(this, action, handler)
    }
  } catch {
    /* MediaSession no disponible: el chip ira solo con <video>/<audio> */
  }

  // play() registra el elemento aunque nunca se adjunte al DOM (Spotify hace
  // eso). Encadena con la envoltura del defuser de arriba si esta activa.
  try {
    const origPlay = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      mediaEls.add(this)
      scheduleReport()
      return origPlay.apply(this)
    }
  } catch {
    /* sin registro por play(): quedan los eventos de abajo */
  }

  // Cambios de estado de cualquier media del documento (fase de captura: play y
  // pause no burbujean). Los reproductores en shadow DOM cerrado no llegan aqui,
  // pero si por el play() envuelto de arriba.
  for (const ev of ['play', 'pause', 'ended', 'emptied'])
    document.addEventListener(ev, scheduleReport, true)

  // Red de seguridad barata: algun estado cambia sin evento visible (pause
  // dentro de shadow DOM, seek al final...). `report` deduplica, asi que este
  // pulso no manda nada si no hubo cambios.
  setInterval(report, 3000)

  const pauseAll = (): void => {
    const h = msHandlers.get('pause')
    if (h) {
      try {
        h({ action: 'pause' })
      } catch {
        /* handler del sitio revento: pausamos a mano igual */
      }
    }
    // Ademas de avisar al sitio, silencio garantizado: pausa directa de todo
    // elemento sonando (pause() sobre pausado es no-op, no hay doble efecto).
    for (const el of mediaEls) {
      if (!el.paused) {
        try {
          el.pause()
        } catch {
          /* elemento en mal estado */
        }
      }
    }
  }

  const playSomething = (): void => {
    const h = msHandlers.get('play')
    if (h) {
      try {
        h({ action: 'play' })
        return
      } catch {
        /* handler roto: probamos con el elemento */
      }
    }
    // Sin handler: reanuda el elemento pausado mas "importante" (mayor duracion
    // finita; el streaming en vivo queda al final).
    let best: HTMLMediaElement | null = null
    for (const el of mediaEls) {
      if (!el.paused || el.ended) continue
      if (!best || (isFinite(el.duration) && el.duration > (isFinite(best.duration) ? best.duration : -1)))
        best = el
    }
    if (best) void best.play().catch(() => undefined)
  }

  ipcRenderer.on(MEDIA_CONTROL, (_e, action: unknown) => {
    if (action === 'pause') pauseAll()
    else if (action === 'playpause') {
      if (anyPlaying()) pauseAll()
      else playSomething()
    } else if (action === 'next' || action === 'prev') {
      const h = msHandlers.get(action === 'next' ? 'nexttrack' : 'previoustrack')
      if (h) {
        try {
          h({ action: action === 'next' ? 'nexttrack' : 'previoustrack' })
        } catch {
          /* handler del sitio revento */
        }
      } else {
        // Sin handler: en YouTube pulsamos el boton real del player.
        ytBtn(action === 'next' ? '.ytp-next-button' : '.ytp-prev-button')?.click()
      }
    }
    scheduleReport()
  })
})()
