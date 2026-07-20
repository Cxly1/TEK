import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { hostKey, type PasswordMeta, type PasswordOffer, type PwDecision, type PwStatus } from '@shared/ipc'
import { JsonStore } from './dev/jsonStore'

/**
 * Gestor de contrasenas de TEK. Reglas de seguridad (no negociables):
 *
 *  - Cada contrasena se cifra con `safeStorage` (DPAPI en Windows: atada a TU
 *    cuenta de usuario, el mismo esquema que usa Chrome). En disco JAMAS hay
 *    texto plano; si el cifrado del sistema no esta disponible, NO se guarda.
 *  - El host de una credencial se deriva en el MAIN del webContents que capturo
 *    el submit — nunca de datos que mande la pagina (una web no puede hacerse
 *    pasar por otra).
 *  - La oferta de guardado que ve el renderer NO lleva la contrasena: esta espera
 *    en memoria del main (con caducidad) hasta que el usuario decide.
 *  - El relleno es por HOST EXACTO y solo tras un clic del usuario en la UI de
 *    TEK (nada de autofill silencioso que un XSS pueda cosechar).
 */

interface VaultEntry {
  id: string
  host: string
  username: string
  /** Contrasena cifrada por safeStorage, en base64. */
  secret: string
  createdAt: number
  updatedAt: number
}

interface VaultData {
  entries: VaultEntry[]
  /** Hosts donde el usuario pidio NO volver a ofrecer guardar. */
  never: string[]
}

interface PendingOffer {
  host: string
  username: string
  password: string
  expiresAt: number
}

/** Una oferta sin decidir caduca a los 2 minutos (se borra de memoria). */
const OFFER_TTL_MS = 2 * 60_000

export class Passwords {
  private readonly store = new JsonStore<VaultData>('tek-vault.json', { entries: [], never: [] })
  private readonly pending = new Map<string, PendingOffer>()
  /** El renderer muestra el toast "¿guardar contraseña?". */
  onOffer: ((o: PasswordOffer) => void) | null = null

  available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  status(): PwStatus {
    return {
      available: this.available(),
      count: this.store.data.entries.length,
      never: [...this.store.data.never].sort()
    }
  }

  list(): PasswordMeta[] {
    return this.store.data.entries
      .map(({ id, host, username, createdAt, updatedAt }) => ({ id, host, username, createdAt, updatedAt }))
      .sort((a, b) => a.host.localeCompare(b.host))
  }

  /** Credenciales (solo id+usuario) para un host EXACTO. */
  metasFor(host: string): { id: string; username: string }[] {
    if (!host) return []
    return this.store.data.entries
      .filter((e) => e.host === host)
      .map((e) => ({ id: e.id, username: e.username }))
  }

  private encrypt(password: string): string | null {
    try {
      return safeStorage.encryptString(password).toString('base64')
    } catch {
      return null
    }
  }

  private decrypt(secret: string): string | null {
    try {
      return safeStorage.decryptString(Buffer.from(secret, 'base64'))
    } catch {
      return null
    }
  }

  /** Descifra UNA contrasena (boton "ver" del panel / relleno). */
  reveal(id: string): string | null {
    const e = this.store.data.entries.find((x) => x.id === id)
    return e ? this.decrypt(e.secret) : null
  }

  /** Credencial completa para rellenar. El que llama DEBE verificar el host. */
  credFor(id: string): { host: string; username: string; password: string } | null {
    const e = this.store.data.entries.find((x) => x.id === id)
    if (!e) return null
    const password = this.decrypt(e.secret)
    return password === null ? null : { host: e.host, username: e.username, password }
  }

  remove(id: string): void {
    this.store.data.entries = this.store.data.entries.filter((e) => e.id !== id)
    this.store.flush()
  }

  removeNever(host: string): void {
    this.store.data.never = this.store.data.never.filter((h) => h !== host)
    this.store.flush()
  }

  /**
   * El preload de una pagina capturo un submit con contrasena. El host sale del
   * webContents (fuente de verdad), no del payload. Si procede, deja la oferta
   * pendiente y avisa al renderer (SIN la contrasena).
   */
  handleCaptured(sender: Electron.WebContents, raw: unknown): void {
    if (!this.available() || !raw || typeof raw !== 'object') return
    if (sender.isDestroyed()) return
    const host = hostKey(sender.getURL())
    if (!host || this.store.data.never.includes(host)) return

    const data = raw as Record<string, unknown>
    const username = String(data.username ?? '').slice(0, 200)
    const password = String(data.password ?? '').slice(0, 500)
    if (!password) return

    const existing = this.store.data.entries.find((e) => e.host === host && e.username === username)
    // Ya esta guardada tal cual: nada que ofrecer.
    if (existing && this.decrypt(existing.secret) === password) return

    this.gcPending()
    // Misma oferta ya en vuelo (paginas que disparan submit dos veces): ignora.
    for (const p of this.pending.values()) {
      if (p.host === host && p.username === username && p.password === password) return
    }
    // Tope duro: una pagina hostil no puede inflar la memoria a base de ofertas.
    if (this.pending.size >= 10) return

    const offerId = randomUUID()
    this.pending.set(offerId, { host, username, password, expiresAt: Date.now() + OFFER_TTL_MS })
    this.onOffer?.({ offerId, host, username, update: !!existing })
  }

  /** Decision del usuario sobre una oferta (toast de TEK). */
  decision(offerId: string, action: PwDecision): void {
    const offer = this.pending.get(offerId)
    this.pending.delete(offerId)
    if (!offer || Date.now() > offer.expiresAt) return
    if (action === 'never') {
      if (!this.store.data.never.includes(offer.host)) {
        this.store.data.never.push(offer.host)
        this.store.flush()
      }
      return
    }
    if (action !== 'save') return
    const secret = this.encrypt(offer.password)
    if (secret === null) return // sin cifrado del sistema no se guarda nada
    const existing = this.store.data.entries.find(
      (e) => e.host === offer.host && e.username === offer.username
    )
    if (existing) {
      existing.secret = secret
      existing.updatedAt = Date.now()
    } else {
      this.store.data.entries.push({
        id: randomUUID(),
        host: offer.host,
        username: offer.username,
        secret,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
    }
    this.store.flush()
  }

  private gcPending(): void {
    const now = Date.now()
    for (const [id, p] of this.pending) if (now > p.expiresAt) this.pending.delete(id)
  }

  dispose(): void {
    this.pending.clear()
    this.onOffer = null
    this.store.dispose()
  }
}
