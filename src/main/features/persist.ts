import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
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

/** Lo ultimo que se escribio: si no cambia nada, no se vuelve a escribir. */
let lastSaved = ''

/** Lee la sesion guardada. Devuelve null si no hay o el archivo esta corrupto. */
export function loadSession(): SavedSession | null {
  try {
    const raw = readFileSync(file(), 'utf8')
    const data = JSON.parse(raw) as SavedSession
    if (!Array.isArray(data.tabs)) return null
    lastSaved = raw
    return data
  } catch {
    return null
  }
}

/**
 * Escribe la sesion SOLO si cambio (antes se reescribia en cada evento de
 * cualquier pestana) y de forma ATOMICA: tmp + rename, asi un cierre a mitad
 * no deja el archivo partido y la sesion perdida. Sincrona a proposito: son
 * unos cientos de bytes, y una escritura asincrona vieja podria aterrizar
 * DESPUES de la ultima (la del cierre) y dejar una sesion antigua.
 * Silenciosa ante errores de IO (no debe tumbar la app).
 */
export function saveSession(session: SavedSession): void {
  const json = JSON.stringify(session)
  if (json === lastSaved) return
  const path = file()
  const tmp = `${path}.tmp`
  try {
    writeFileSync(tmp, json, 'utf8')
    renameSync(tmp, path)
    lastSaved = json
  } catch {
    // disco lleno / permisos: la persistencia es best-effort.
  }
}

/** Borra la sesion guardada. */
export function clearSession(): void {
  saveSession({ tabs: [], activeIndex: 0 })
}
