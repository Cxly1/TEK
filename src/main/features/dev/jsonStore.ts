import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'

/**
 * Mini-almacen JSON en userData, el mismo patron probado de Downloads: archivo
 * propio, carga sincrona unica al arrancar, guardado con debounce y escritura
 * atomica (tmp + rename) para no dejar el archivo a medias si TEK se cierra.
 * A PROPOSITO sin SQLite: la automatizacion debe sobrevivir aunque el modulo
 * nativo del cerebro falle (gotcha del ABI de better-sqlite3).
 */
export class JsonStore<T> {
  private readonly file: string
  private saveTimer: NodeJS.Timeout | null = null
  data: T

  constructor(filename: string, fallback: T) {
    this.file = join(app.getPath('userData'), filename)
    this.data = fallback
    try {
      const raw = readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw) as T
      if (parsed && typeof parsed === 'object') this.data = { ...fallback, ...parsed }
    } catch {
      /* primera vez o archivo corrupto: arrancamos con el fallback */
    }
  }

  /** Guarda con debounce (las rafagas de cambios = una escritura). */
  save(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, 300)
  }

  /** Escribe a disco YA (atomico). Para dispose() y datos sensibles. */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('[TEK JsonStore] no se pudo guardar', this.file, err)
    }
  }

  dispose(): void {
    this.flush()
  }
}
