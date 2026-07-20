import { safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { hostKey, type PasswordMeta, type PasswordOffer, type PwDecision, type PwStatus } from '@shared/ipc'
import { JsonStore } from './dev/jsonStore'

/**
 * Gestor de contrasenas de TEK. Reglas de seguridad (no negociables):
 *
 *  - Cada contrasena se cifra con `safeStorage` (cifrado del sistema, atado a TU
 *    cuenta de usuario). En disco JAMAS hay texto plano; si el cifrado del
 *    sistema no esta disponible, NO se guarda.
 *  - CAPA OPCIONAL: contrasena maestra. El cifrado del sistema protege el
 *    ARCHIVO (disco robado, otra cuenta del mismo equipo), pero descifra solo
 *    para cualquier programa que ya corra como tu — ese es el techo de todos los
 *    navegadores. Con contrasena maestra cada secreto va ademas en AES-256-GCM
 *    con una clave derivada por scrypt de algo que solo esta en tu cabeza: leer
 *    el archivo deja de bastar. La clave vive en memoria del proceso principal y
 *    se tira sola por inactividad.
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
  /** Contrasena cifrada. Con `v2:` delante = lleva ademas la capa maestra. */
  secret: string
  createdAt: number
  updatedAt: number
}

/** Parametros de derivacion de la clave maestra (scrypt). */
interface KdfParams {
  salt: string
  N: number
  r: number
  p: number
}

interface VaultData {
  entries: VaultEntry[]
  /** Hosts donde el usuario pidio NO volver a ofrecer guardar. */
  never: string[]
  /** null = sin contrasena maestra (solo cifrado del sistema). */
  kdf: KdfParams | null
}

interface PendingOffer {
  host: string
  username: string
  password: string
  expiresAt: number
}

/** Una oferta sin decidir caduca a los 2 minutos (se borra de memoria). */
const OFFER_TTL_MS = 2 * 60_000
/** La boveda se vuelve a bloquear sola tras este rato sin usarla. */
const AUTOLOCK_MS = 15 * 60_000
/** Coste de scrypt: ~100ms por intento, que es lo que encarece la fuerza bruta. */
const SCRYPT: Omit<KdfParams, 'salt'> = { N: 32768, r: 8, p: 1 }
/** Marca de los secretos que llevan la capa de contrasena maestra. */
const V2 = 'v2:'

export class Passwords {
  private readonly store = new JsonStore<VaultData>('tek-vault.json', {
    entries: [],
    never: [],
    kdf: null
  })
  private readonly pending = new Map<string, PendingOffer>()
  /** Clave maestra derivada. SOLO en memoria, nunca a disco. */
  private key: Buffer | null = null
  private lockTimer: NodeJS.Timeout | null = null
  /** El renderer muestra el toast "¿guardar contraseña?". */
  onOffer: ((o: PasswordOffer) => void) | null = null

  available(): boolean {
    try {
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /** ¿Hay contrasena maestra configurada? */
  private isProtected(): boolean {
    return this.store.data.kdf !== null
  }

  /** Protegida pero sin desbloquear: no se puede leer ni guardar nada. */
  private isLocked(): boolean {
    return this.isProtected() && this.key === null
  }

  status(): PwStatus {
    return {
      available: this.available(),
      count: this.store.data.entries.length,
      never: [...this.store.data.never].sort(),
      protected: this.isProtected(),
      locked: this.isLocked()
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

  // --- Capa maestra ---------------------------------------------------------

  private derive(password: string, kdf: KdfParams): Buffer {
    // maxmem hay que subirlo a mano: por defecto Node no llega a N=32768.
    return scryptSync(password, Buffer.from(kdf.salt, 'base64'), 32, {
      N: kdf.N,
      r: kdf.r,
      p: kdf.p,
      maxmem: 256 * 1024 * 1024
    })
  }

  /** AES-256-GCM -> base64(iv | tag | ciphertext). */
  private seal(plain: string, key: Buffer): string {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
    return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')
  }

  /** Devuelve null si la clave no es la buena (el tag GCM no cuadra). */
  private open(blob: string, key: Buffer): string | null {
    try {
      const raw = Buffer.from(blob, 'base64')
      const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
      d.setAuthTag(raw.subarray(12, 28))
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
    } catch {
      return null
    }
  }

  // --- Cifrado de un secreto (sistema + capa maestra si la hay) -------------

  private encrypt(password: string): string | null {
    try {
      if (this.key) {
        return V2 + safeStorage.encryptString(this.seal(password, this.key)).toString('base64')
      }
      return safeStorage.encryptString(password).toString('base64')
    } catch {
      return null
    }
  }

  private decrypt(secret: string): string | null {
    try {
      if (secret.startsWith(V2)) {
        if (!this.key) return null // boveda bloqueada
        const inner = safeStorage.decryptString(Buffer.from(secret.slice(V2.length), 'base64'))
        return this.open(inner, this.key)
      }
      return safeStorage.decryptString(Buffer.from(secret, 'base64'))
    } catch {
      return null
    }
  }

  /** Cada uso legitimo aplaza el bloqueo automatico. */
  private touch(): void {
    if (!this.isProtected() || !this.key) return
    if (this.lockTimer) clearTimeout(this.lockTimer)
    this.lockTimer = setTimeout(() => this.lock(), AUTOLOCK_MS)
  }

  /** Desbloquea con la contrasena maestra. La prueba es el propio tag GCM. */
  unlock(password: string): boolean {
    const kdf = this.store.data.kdf
    if (!kdf) return true // no hay nada que desbloquear
    const key = this.derive(password, kdf)
    const first = this.store.data.entries.find((e) => e.secret.startsWith(V2))
    if (first) {
      const inner = (() => {
        try {
          return safeStorage.decryptString(Buffer.from(first.secret.slice(V2.length), 'base64'))
        } catch {
          return null
        }
      })()
      if (inner === null || this.open(inner, key) === null) return false
    }
    this.key = key
    this.touch()
    return true
  }

  /** Tira la clave de memoria (manual, por inactividad o al cerrar). */
  lock(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer)
      this.lockTimer = null
    }
    this.key?.fill(0)
    this.key = null
  }

  /**
   * Pone, cambia o quita la contrasena maestra, re-cifrando TODA la boveda.
   * Con `next = null` la quita (los secretos vuelven a solo cifrado del sistema).
   * Si ya estaba protegida hay que estar desbloqueado o dar la actual.
   */
  setMaster(next: string | null, current?: string): { ok: boolean; error?: string } {
    if (!this.available()) return { ok: false, error: 'sin cifrado del sistema' }

    if (this.isProtected()) {
      if (this.key === null) {
        if (!current || !this.unlock(current)) return { ok: false, error: 'contraseña actual incorrecta' }
      } else if (current !== undefined && current !== '' && !this.verifyCurrent(current)) {
        return { ok: false, error: 'contraseña actual incorrecta' }
      }
    }
    if (next !== null && next.length < 8) return { ok: false, error: 'mínimo 8 caracteres' }

    // Descifra TODO con el estado actual antes de tocar nada: si algo falla, la
    // boveda se queda como estaba en vez de a medio convertir.
    const plain: { entry: VaultEntry; password: string }[] = []
    for (const entry of this.store.data.entries) {
      const password = this.decrypt(entry.secret)
      if (password === null) return { ok: false, error: 'no se pudo descifrar la bóveda' }
      plain.push({ entry, password })
    }

    const previous = this.key
    if (next === null) {
      this.key = null
      this.store.data.kdf = null
    } else {
      const kdf: KdfParams = { salt: randomBytes(16).toString('base64'), ...SCRYPT }
      this.key = this.derive(next, kdf)
      this.store.data.kdf = kdf
    }

    for (const { entry, password } of plain) {
      const secret = this.encrypt(password)
      if (secret === null) {
        // Vuelta atras: ni un secreto se queda ilegible.
        this.key = previous
        return { ok: false, error: 'no se pudo re-cifrar la bóveda' }
      }
      entry.secret = secret
      entry.updatedAt = Date.now()
    }
    previous?.fill(0)
    this.store.flush()
    this.touch()
    return { ok: true }
  }

  /** ¿`password` es la maestra actual? (sin cambiar el estado de bloqueo). */
  private verifyCurrent(password: string): boolean {
    const kdf = this.store.data.kdf
    if (!kdf || !this.key) return false
    return this.derive(password, kdf).equals(this.key)
  }

  /** Descifra UNA contrasena (boton "ver" del panel / relleno). */
  reveal(id: string): string | null {
    if (this.isLocked()) return null
    const e = this.store.data.entries.find((x) => x.id === id)
    if (!e) return null
    this.touch()
    return this.decrypt(e.secret)
  }

  /** Credencial completa para rellenar. El que llama DEBE verificar el host. */
  credFor(id: string): { host: string; username: string; password: string } | null {
    if (this.isLocked()) return null
    const e = this.store.data.entries.find((x) => x.id === id)
    if (!e) return null
    const password = this.decrypt(e.secret)
    if (password === null) return null
    this.touch()
    return { host: e.host, username: e.username, password }
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
    // Bloqueada: ni ofrecemos, porque no podriamos guardar aunque dijera que si.
    if (!this.available() || this.isLocked() || !raw || typeof raw !== 'object') return
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
    this.touch()
  }

  private gcPending(): void {
    const now = Date.now()
    for (const [id, p] of this.pending) if (now > p.expiresAt) this.pending.delete(id)
  }

  dispose(): void {
    this.pending.clear()
    this.onOffer = null
    this.lock()
    this.store.dispose()
  }
}
