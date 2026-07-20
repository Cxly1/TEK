import { session as electronSession } from 'electron'
import type { ClearScope } from '@shared/ipc'

/**
 * Borrado de datos de navegacion REALES de Chromium (cookies, cache y storage:
 * localStorage, IndexedDB, service workers, cachestorage…) de la particion de las
 * pestanas. Es el UNICO sitio que toca tu sesion del navegador: el "borrar" del
 * cerebro solo afecta a lo aprendido en SQLite, no a tu login ni a tu cache.
 */
export class Privacy {
  constructor(private readonly partition: string) {}

  private get ses(): Electron.Session {
    return electronSession.fromPartition(this.partition)
  }

  /** Borra datos globalmente. 'cache' = solo cache; 'cookies' = login/sesion; 'all' = todo. */
  async clear(scope: ClearScope = 'all'): Promise<void> {
    const ses = this.ses
    if (scope === 'cache') {
      await ses.clearCache()
      return
    }
    if (scope === 'cookies') {
      await ses.clearStorageData({ storages: ['cookies'] })
      return
    }
    await ses.clearStorageData() // cookies + localStorage + indexeddb + SW + cachestorage…
    await ses.clearCache()
  }

  /** Borra cookies + storage de UN host (su origen https y el dominio de cookies). */
  async clearForHost(host: string): Promise<void> {
    const h = (host || '').trim().replace(/^www\./, '').toLowerCase()
    if (!h) return
    const ses = this.ses
    // Storage del origen (localStorage, IndexedDB, service workers, cachestorage…).
    await ses.clearStorageData({ origin: `https://${h}` }).catch(() => undefined)
    // Cookies del dominio (y subdominios): clearStorageData no las filtra por host,
    // asi que las quitamos una a una.
    try {
      const cookies = await ses.cookies.get({ domain: h })
      await Promise.all(
        cookies.map((c) => {
          const dom = (c.domain ?? h).replace(/^\./, '')
          const url = `http${c.secure ? 's' : ''}://${dom}${c.path ?? '/'}`
          return ses.cookies.remove(url, c.name).catch(() => undefined)
        })
      )
    } catch {
      /* sin cookies para ese dominio */
    }
  }
}
