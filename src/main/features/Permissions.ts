import { dialog, shell, session as electronSession, type BrowserWindow } from 'electron'
import { isLoopbackHost, originKey, type SitePermission } from '@shared/ipc'
import { JsonStore } from './dev/jsonStore'

/**
 * Permisos de sitio de TEK. SIN esto, Electron CONCEDE por defecto cualquier
 * permiso que pida una pagina (camara, microfono, ubicacion...) — un agujero
 * serio. Politica:
 *
 *  - Inocuos (pantalla completa, portapapeles saneado, pointer lock, DRM...):
 *    se permiten en silencio, como hace Chrome.
 *  - Sensibles (camara/micro, compartir pantalla, ubicacion, notificaciones,
 *    leer portapapeles, abrir apps externas...): dialogo nativo Permitir /
 *    Bloquear, y la decision se RECUERDA por ORIGEN en tek-permissions.json.
 *  - Todo lo demas (HID, serial, USB, storage-access y desconocidos): denegado.
 *
 * POR ORIGEN y no por host (desde 2026-10): un permiso dado a
 * `https://ejemplo.com` ya no vale para `http://ejemplo.com`, que en una red
 * publica puede falsear cualquiera. Las reglas viejas (por host) se migran solas
 * a https —los permisos sensibles solo se piden desde contextos seguros— o a
 * http si el host es tu propio equipo (localhost).
 *
 * Aqui vive tambien la confirmacion de los enlaces que abren OTRA app
 * (mailto:, tel:, sms:, webcal:, magnet:): misma memoria, mismo panel.
 */

type Decision = 'allow' | 'deny'

interface PermsData {
  /** clave `${origen}|${permiso}` -> decision recordada (ver originKey). */
  rules: Record<string, Decision>
}

/**
 * Permisos que se conceden en silencio (riesgo ~cero, pedirlos seria ruido).
 * `storage-access` YA NO esta: dejaba a iframes de terceros recuperar sus
 * cookies sin preguntar. Se deniega (TEK no bloquea las cookies de terceros,
 * asi que en la practica no cambia nada visible; si algun dia se bloquean, el
 * permiso ya no se regala).
 */
const ALWAYS_ALLOW = new Set([
  'fullscreen',
  'pointerLock',
  'keyboardLock',
  'clipboard-sanitized-write',
  'mediaKeySystem',
  'speaker-selection',
  'window-management'
])

/** Permisos sensibles que disparan el dialogo (el resto se deniega). */
const PROMPT = new Set([
  'media',
  'display-capture',
  'geolocation',
  'notifications',
  'clipboard-read',
  'midi',
  'midiSysex',
  'openExternal',
  'fileSystem',
  'idle-detection'
])

/** Esquemas de enlace que abren otra app del sistema (con tu permiso). */
export const EXTERNAL_SCHEMES = ['mailto', 'tel', 'sms', 'webcal', 'magnet']

/** Que app se va a abrir, dicho para personas. */
const EXTERNAL_APP: Record<string, string> = {
  mailto: 'tu app de correo',
  tel: 'tu app de llamadas',
  sms: 'tu app de mensajes',
  webcal: 'tu calendario',
  magnet: 'tu app de torrents'
}

/** Esquema de un enlace externo conocido, o '' si no lo es. */
export function externalScheme(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url || '')
  const s = m ? m[1].toLowerCase() : ''
  return EXTERNAL_SCHEMES.includes(s) ? s : ''
}

/** Texto humano del permiso para el dialogo y el panel. */
export function permissionLabel(permission: string, mediaTypes?: string[]): string {
  if (permission.startsWith('external:')) {
    return `abrir ${EXTERNAL_APP[permission.slice('external:'.length)] ?? 'otra app'}`
  }
  switch (permission) {
    case 'media': {
      const video = mediaTypes?.includes('video')
      const audio = mediaTypes?.includes('audio')
      if (video && audio) return 'usar tu cámara y micrófono'
      if (video) return 'usar tu cámara'
      if (audio) return 'usar tu micrófono'
      return 'usar cámara/micrófono'
    }
    case 'display-capture':
      return 'compartir tu pantalla'
    case 'geolocation':
      return 'conocer tu ubicación'
    case 'notifications':
      return 'mostrarte notificaciones'
    case 'clipboard-read':
      return 'leer tu portapapeles'
    case 'midi':
    case 'midiSysex':
      return 'usar dispositivos MIDI'
    case 'openExternal':
      return 'abrir una aplicación externa'
    case 'fileSystem':
      return 'acceder a archivos de tu equipo'
    case 'idle-detection':
      return 'saber si estás inactivo'
    default:
      return permission
  }
}

/** Como se ensena un origen: el host si es https; el origen entero si no. */
function originLabel(origin: string): string {
  return origin.startsWith('https://') ? origin.slice('https://'.length) : origin
}

/** Tras "Cancelar" a un enlace externo, esa pestana no vuelve a preguntar en un rato. */
const EXTERNAL_QUIET_MS = 10_000
/** Como mucho una apertura de otra app cada tanto por pestana (aunque este permitido). */
const EXTERNAL_MIN_GAP_MS = 3000

export class Permissions {
  private readonly store = new JsonStore<PermsData>('tek-permissions.json', { rules: {} })
  /** Dialogos en vuelo por origen|permiso: no apilar dos prompts iguales. */
  private readonly pending = new Map<string, Promise<boolean>>()
  /** Enlaces externos: pestana con dialogo abierto, silencio tras Cancelar, ultima apertura. */
  private readonly extBusy = new WeakSet<Electron.WebContents>()
  private readonly extQuietUntil = new WeakMap<Electron.WebContents, number>()
  private readonly extLastAt = new WeakMap<Electron.WebContents, number>()
  /** Ventana sobre la que se cuelga el dialogo (la cablea index.ts). */
  getWindow: () => BrowserWindow | null = () => null

  constructor() {
    this.migrate()
  }

  /** Reglas por HOST (hasta v0.5) -> por origen. Idempotente. */
  private migrate(): void {
    const rules = this.store.data.rules
    let changed = false
    for (const [key, decision] of Object.entries(rules)) {
      const sep = key.indexOf('|')
      if (sep <= 0) continue
      const who = key.slice(0, sep)
      if (who.includes('://')) continue
      const permission = key.slice(sep + 1)
      const origin = `${isLoopbackHost(who) ? 'http' : 'https'}://${who}`
      delete rules[key]
      if (!rules[`${origin}|${permission}`]) rules[`${origin}|${permission}`] = decision
      changed = true
    }
    if (changed) this.store.flush()
  }

  /** Engancha los handlers sobre la particion de las pestanas. */
  attach(partition: string): void {
    const ses = electronSession.fromPartition(partition)

    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const origin = originKey(details.requestingUrl || (wc && !wc.isDestroyed() ? wc.getURL() : ''))
      const mediaTypes =
        'mediaTypes' in details ? ((details as { mediaTypes?: string[] }).mediaTypes ?? []) : []
      void this.decide(origin, permission, mediaTypes).then(callback)
    })

    // Consulta sincrona ("¿tengo el permiso?"). Sin estado 'default' posible en
    // Electron: notifications cae a permitido-salvo-bloqueo (si no, las webs ven
    // 'denied' permanente y ni piden); el resto, solo si hay regla de permitir.
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      if (ALWAYS_ALLOW.has(permission)) return true
      const rule = this.ruleFor(originKey(requestingOrigin), permission)
      if (permission === 'notifications') return rule !== 'deny'
      return rule === 'allow'
    })
  }

  private ruleFor(origin: string, permission: string): Decision | null {
    if (!origin) return null
    return this.store.data.rules[`${origin}|${permission}`] ?? null
  }

  private async decide(origin: string, permission: string, mediaTypes: string[]): Promise<boolean> {
    if (ALWAYS_ALLOW.has(permission)) return true
    if (!PROMPT.has(permission)) return false // HID/serial/USB/storage-access/desconocidos: no
    if (!origin) return false

    const remembered = this.ruleFor(origin, permission)
    if (remembered) return remembered === 'allow'

    const key = `${origin}|${permission}`
    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight

    const ask = this.prompt(origin, permission, mediaTypes).finally(() => this.pending.delete(key))
    this.pending.set(key, ask)
    return ask
  }

  private async prompt(origin: string, permission: string, mediaTypes: string[]): Promise<boolean> {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return false
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Permiso',
      message: `${originLabel(origin)} quiere ${permissionLabel(permission, mediaTypes)}`,
      detail: 'TEK recordará tu decisión para este sitio (puedes cambiarla en ⚡ Ajustes).',
      buttons: ['Permitir', 'Bloquear'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    const allowed = response === 0
    this.store.data.rules[`${origin}|${permission}`] = allowed ? 'allow' : 'deny'
    this.store.flush()
    return allowed
  }

  // --- Enlaces que abren otra app --------------------------------------------

  /**
   * Una pagina quiere abrir un enlace mailto:/tel:/sms:/webcal:/magnet:. Antes la
   * app del sistema se abria SIN preguntar, incluso sin un clic. Ahora: "¿Abrir
   * en otra app?" con "Permitir siempre en <sitio>".
   *
   * Electron no cuenta si la navegacion vino de un clic, asi que el freno es
   * otro: siempre se pregunta (salvo permiso recordado), una sola pregunta a la
   * vez por pestana, tras Cancelar 10 s de silencio, y como mucho una apertura
   * cada 3 s aunque el sitio este permitido. Una pagina en bucle no puede
   * inundarte de dialogos ni de ventanas de correo.
   */
  async openExternalFor(wc: Electron.WebContents | null, url: string): Promise<void> {
    const scheme = externalScheme(url)
    if (!scheme) return
    const now = Date.now()
    if (wc) {
      if (this.extBusy.has(wc)) return
      if ((this.extQuietUntil.get(wc) ?? 0) > now) return
      if (now - (this.extLastAt.get(wc) ?? 0) < EXTERNAL_MIN_GAP_MS) return
    }
    const origin = wc && !wc.isDestroyed() ? originKey(wc.getURL()) : ''
    const permission = `external:${scheme}`
    if (origin && this.ruleFor(origin, permission) === 'allow') {
      if (wc) this.extLastAt.set(wc, now)
      void shell.openExternal(url)
      return
    }
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return
    if (wc) this.extBusy.add(wc)
    try {
      const who = origin ? originLabel(origin) : 'Una página'
      const shown = url.length > 140 ? `${url.slice(0, 140)}…` : url
      const { response, checkboxChecked } = await dialog.showMessageBox(win, {
        type: 'question',
        title: 'Abrir en otra app',
        message: '¿Abrir en otra app?',
        detail: `${who} quiere abrir ${EXTERNAL_APP[scheme]}:\n${shown}`,
        buttons: ['Abrir', 'Cancelar'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        ...(origin ? { checkboxLabel: `Permitir siempre en ${originLabel(origin)}`, checkboxChecked: false } : {})
      })
      if (response === 0) {
        if (origin && checkboxChecked) {
          this.store.data.rules[`${origin}|${permission}`] = 'allow'
          this.store.flush()
        }
        if (wc) this.extLastAt.set(wc, Date.now())
        void shell.openExternal(url)
      } else if (wc) {
        this.extQuietUntil.set(wc, Date.now() + EXTERNAL_QUIET_MS)
      }
    } finally {
      if (wc) this.extBusy.delete(wc)
    }
  }

  // --- Panel ---------------------------------------------------------------

  list(): SitePermission[] {
    return Object.entries(this.store.data.rules)
      .map(([key, decision]) => {
        const sep = key.indexOf('|')
        const origin = key.slice(0, sep)
        return {
          origin,
          host: originLabel(origin),
          permission: key.slice(sep + 1),
          allowed: decision === 'allow'
        }
      })
      .sort((a, b) => a.host.localeCompare(b.host) || a.permission.localeCompare(b.permission))
  }

  revoke(origin: string, permission: string): void {
    delete this.store.data.rules[`${origin}|${permission}`]
    this.store.flush()
  }

  dispose(): void {
    this.pending.clear()
    this.store.dispose()
  }
}
