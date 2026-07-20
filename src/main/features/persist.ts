import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Una pestana tal como se guarda en disco (lo minimo para recrearla). */
export interface SavedTab {
  url: string
  blank: boolean
  group: string
}

/** Sesion completa persistida entre arranques. */
export interface SavedSession {
  tabs: SavedTab[]
  activeIndex: number
}

const file = (): string => join(app.getPath('userData'), 'tek-tabs.json')

/** Lee la sesion guardada. Devuelve null si no hay o el archivo esta corrupto. */
export function loadSession(): SavedSession | null {
  try {
    const raw = readFileSync(file(), 'utf8')
    const data = JSON.parse(raw) as SavedSession
    if (!Array.isArray(data.tabs)) return null
    return data
  } catch {
    return null
  }
}

/** Escribe la sesion. Silencioso ante errores de IO (no debe tumbar la app). */
export function saveSession(session: SavedSession): void {
  try {
    writeFileSync(file(), JSON.stringify(session), 'utf8')
  } catch {
    // disco lleno / permisos: la persistencia es best-effort.
  }
}

/** Borra la sesion guardada. */
export function clearSession(): void {
  saveSession({ tabs: [], activeIndex: 0 })
}
