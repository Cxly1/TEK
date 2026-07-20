import { dialog, session as electronSession, type BrowserWindow } from 'electron'
import { hostKey, type SitePermission } from '@shared/ipc'
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
 *    Bloquear, y la decision se RECUERDA por host en tek-permissions.json.
 *  - Todo lo demas (HID, serial, USB y desconocidos): denegado, punto.
 */

type Decision = 'allow' | 'deny'

interface PermsData {
  /** clave `${host}|${permiso}` -> decision recordada. */
  rules: Record<string, Decision>
}

/** Permisos que se conceden en silencio (riesgo ~cero, pedirlos seria ruido). */
const ALWAYS_ALLOW = new Set([
  'fullscreen',
  'pointerLock',
  'keyboardLock',
  'clipboard-sanitized-write',
  'mediaKeySystem',
  'speaker-selection',
  'storage-access',
  'top-level-storage-access',
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

/** Texto humano del permiso para el dialogo y el panel. */
export function permissionLabel(permission: string, mediaTypes?: string[]): string {
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

export class Permissions {
  private readonly store = new JsonStore<PermsData>('tek-permissions.json', { rules: {} })
  /** Dialogos en vuelo por host|permiso: no apilar dos prompts iguales. */
  private readonly pending = new Map<string, Promise<boolean>>()
  /** Ventana sobre la que se cuelga el dialogo (la cablea index.ts). */
  getWindow: () => BrowserWindow | null = () => null

  /** Engancha los handlers sobre la particion de las pestanas. */
  attach(partition: string): void {
    const ses = electronSession.fromPartition(partition)

    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const host = this.hostOf(details.requestingUrl || (wc && !wc.isDestroyed() ? wc.getURL() : ''))
      const mediaTypes =
        'mediaTypes' in details ? ((details as { mediaTypes?: string[] }).mediaTypes ?? []) : []
      void this.decide(host, permission, mediaTypes).then(callback)
    })

    // Consulta sincrona ("¿tengo el permiso?"). Sin estado 'default' posible en
    // Electron: notifications cae a permitido-salvo-bloqueo (si no, las webs ven
    // 'denied' permanente y ni piden); el resto, solo si hay regla de permitir.
    ses.setPermissionCheckHandler((_wc, permission, origin) => {
      if (ALWAYS_ALLOW.has(permission)) return true
      const rule = this.ruleFor(this.hostOf(origin), permission)
      if (permission === 'notifications') return rule !== 'deny'
      return rule === 'allow'
    })
  }

  private hostOf(url: string): string {
    return hostKey(url) || ''
  }

  private ruleFor(host: string, permission: string): Decision | null {
    if (!host) return null
    return this.store.data.rules[`${host}|${permission}`] ?? null
  }

  private async decide(host: string, permission: string, mediaTypes: string[]): Promise<boolean> {
    if (ALWAYS_ALLOW.has(permission)) return true
    if (!PROMPT.has(permission)) return false // HID/serial/USB/desconocidos: no
    if (!host) return false

    const remembered = this.ruleFor(host, permission)
    if (remembered) return remembered === 'allow'

    const key = `${host}|${permission}`
    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight

    const ask = this.prompt(host, permission, mediaTypes).finally(() => this.pending.delete(key))
    this.pending.set(key, ask)
    return ask
  }

  private async prompt(host: string, permission: string, mediaTypes: string[]): Promise<boolean> {
    const win = this.getWindow()
    if (!win || win.isDestroyed()) return false
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Permiso',
      message: `${host} quiere ${permissionLabel(permission, mediaTypes)}`,
      detail: 'TEK recordará tu decisión para este sitio (puedes cambiarla en ⚡ Ajustes).',
      buttons: ['Permitir', 'Bloquear'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    })
    const allowed = response === 0
    this.store.data.rules[`${host}|${permission}`] = allowed ? 'allow' : 'deny'
    this.store.flush()
    return allowed
  }

  // --- Panel ---------------------------------------------------------------

  list(): SitePermission[] {
    return Object.entries(this.store.data.rules)
      .map(([key, decision]) => {
        const sep = key.indexOf('|')
        return { host: key.slice(0, sep), permission: key.slice(sep + 1), allowed: decision === 'allow' }
      })
      .sort((a, b) => a.host.localeCompare(b.host) || a.permission.localeCompare(b.permission))
  }

  revoke(host: string, permission: string): void {
    delete this.store.data.rules[`${host}|${permission}`]
    this.store.flush()
  }

  dispose(): void {
    this.pending.clear()
    this.store.dispose()
  }
}
