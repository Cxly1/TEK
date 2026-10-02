import {
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

/**
 * Quien puede hablar con el proceso principal.
 *
 * El main guarda la boveda, escribe en disco y ejecuta JS en las pestanas, asi
 * que cada canal IPC tiene que saber QUIEN le llama. Hay dos tipos de remitente:
 *
 *  - SUPERFICIES de TEK: el shell, la capa flotante (menu ☰, Descargas,
 *    Historial) y la barra del mini-player. Cargan el renderer propio, con
 *    sandbox y contextIsolation. Son las unicas que pueden usar los canales IPC.*.
 *  - PESTANAS: cargan webs que no controlamos. Su preload solo usa los canales
 *    WV.* (contrasenas, macros, musica, arranque del adblock); cualquier otro
 *    canal les esta vedado.
 *
 * Una superficie se reconoce por DOS cosas a la vez: el webContents esta
 * registrado aqui (lo hacen index.ts, FloatingLayer y MiniPlayer al crearlo) y
 * el marco que manda es el principal y tiene la URL EXACTA de la app. Lo primero
 * evita que una pestana se haga pasar por superficie; lo segundo, que una
 * superficie que hubiera navegado a otra cosa siga teniendo la llave.
 */

const surfaces = new WeakSet<WebContents>()

/** Donde vive la UI: el dev server de Vite o el index.html empaquetado. */
let devOrigin = ''
let indexFile = ''

/** Se fija una vez al arrancar (index.ts), antes de crear ninguna ventana. */
export function initAppUrl(devUrl: string | undefined, rendererIndexPath: string): void {
  devOrigin = ''
  if (devUrl) {
    try {
      devOrigin = new URL(devUrl).origin
    } catch {
      devOrigin = ''
    }
  }
  indexFile = normPath(rendererIndexPath)
}

function normPath(p: string): string {
  const abs = resolve(p)
  return process.platform === 'win32' ? abs.toLowerCase() : abs
}

/**
 * ¿Es la URL de la propia UI de TEK? Sin mirar `?surface=` ni el `#`: las tres
 * superficies cargan el mismo index.html. Cualquier otro archivo, otra carpeta u
 * otro origen NO lo es, aunque sea file://.
 */
export function isAppUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (devOrigin && u.origin === devOrigin) {
    return u.pathname === '/' || u.pathname === '/index.html'
  }
  if (u.protocol !== 'file:' || !indexFile) return false
  try {
    return normPath(fileURLToPath(u)) === indexFile
  } catch {
    return false
  }
}

/** Marca un webContents como superficie de TEK (solo el codigo de TEK lo llama). */
export function registerSurface(wc: WebContents): void {
  surfaces.add(wc)
}

/** ¿El webContents es una superficie registrada y sigue en la UI de TEK? */
export function isSurface(wc: WebContents | null | undefined): boolean {
  return !!wc && !wc.isDestroyed() && surfaces.has(wc) && isAppUrl(wc.getURL())
}

type AnyEvent = IpcMainEvent | IpcMainInvokeEvent

/** ¿El mensaje sale del marco principal de una superficie de TEK? */
export function fromTek(e: AnyEvent): boolean {
  if (!isSurface(e.sender)) return false
  const frame = e.senderFrame
  // Las superficies no tienen iframes; un marco hijo nunca habla por ellas.
  return !!frame && frame.parent === null && isAppUrl(frame.url)
}

/**
 * ¿El mensaje sale del marco principal de una pestana (o de lo que no es una
 * superficie)? Para los canales WV.*: el preload de las paginas solo corre en
 * el marco principal, y un mensaje de un iframe no debe hablar por la pagina.
 */
export function fromPageTop(e: AnyEvent): boolean {
  if (!e.sender || e.sender.isDestroyed() || surfaces.has(e.sender)) return false
  const frame = e.senderFrame
  return !!frame && frame.parent === null
}

/** Un aviso por canal y origen: lo bastante para verlo, sin inundar la consola. */
const warned = new Set<string>()
function deny(channel: string, e: AnyEvent): void {
  let from = '?'
  try {
    from = e.senderFrame?.url || e.sender.getURL()
  } catch {
    /* remitente ya destruido */
  }
  const key = `${channel}|${from.slice(0, 120)}`
  if (warned.has(key) || warned.size > 200) return
  warned.add(key)
  console.warn(`[tek] IPC denegado: ${channel} desde ${from.slice(0, 120)}`)
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** `ipcMain.handle` solo para superficies de TEK (al resto se le rechaza). */
export function handleTek(
  channel: string,
  fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown
): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromTek(e)) {
      deny(channel, e)
      throw new Error('canal reservado a TEK')
    }
    return fn(e, ...args)
  })
}

/** `ipcMain.on` solo para superficies de TEK. */
export function onTek(channel: string, fn: (e: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (!fromTek(e)) {
      deny(channel, e)
      return
    }
    fn(e, ...args)
  })
}

/**
 * Canal SINCRONO solo para superficies. A quien no lo es se le contesta
 * `denied`: sin `returnValue`, el `sendSync` del otro lado se quedaria colgado.
 */
export function onTekSync(
  channel: string,
  fn: (e: IpcMainEvent, ...args: any[]) => void,
  denied: unknown
): void {
  ipcMain.on(channel, (e, ...args) => {
    if (!fromTek(e)) {
      deny(channel, e)
      e.returnValue = denied
      return
    }
    fn(e, ...args)
  })
}

/** `ipcMain.on` solo para el marco principal de una pagina (canales WV.*). */
export function onPage(channel: string, fn: (e: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (!fromPageTop(e)) {
      deny(channel, e)
      return
    }
    fn(e, ...args)
  })
}

/** Canal SINCRONO de pagina; a cualquier otro remitente se le contesta `denied`. */
export function onPageSync(
  channel: string,
  fn: (e: IpcMainEvent, ...args: any[]) => void,
  denied: unknown
): void {
  ipcMain.on(channel, (e, ...args) => {
    if (!fromPageTop(e)) {
      deny(channel, e)
      e.returnValue = denied
      return
    }
    fn(e, ...args)
  })
}

/** `ipcMain.handle` de pagina (canales WV.* con respuesta). */
export function handlePage(
  channel: string,
  fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown
): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromPageTop(e)) {
      deny(channel, e)
      throw new Error('canal reservado a las paginas')
    }
    return fn(e, ...args)
  })
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Candado de navegacion para una superficie: solo puede cargar la UI de TEK.
 * Nada de file:// sueltos, ni webs, ni marcos hijos, ni ventanas nuevas (el
 * shell tiene su propio manejador de ventanas para los enlaces externos; a las
 * demas superficies se les niegan todas).
 */
export function lockToApp(wc: WebContents, opts: { denyWindows: boolean }): void {
  wc.on('will-navigate', (e, url) => {
    if (isAppUrl(url)) return
    e.preventDefault()
    console.warn(`[tek] navegacion bloqueada en la UI: ${url.slice(0, 120)}`)
  })
  wc.on('will-redirect', (e, url) => {
    if (isAppUrl(url)) return
    e.preventDefault()
  })
  // Marcos hijos: la UI de TEK no tiene ninguno; si apareciera uno, no navega.
  wc.on('will-frame-navigate', (e) => {
    if (e.isMainFrame) return
    e.preventDefault()
  })
  if (opts.denyWindows) wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}
