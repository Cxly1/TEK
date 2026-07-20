import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { BridgeStatus, SnippetResult } from '@shared/ipc'
import { JsonStore } from './jsonStore'

/**
 * Puente para agentes: un servidor HTTP MINUSCULO que permite a Claude Code (u
 * otra herramienta local) manejar TEK: listar pestanas, abrir URLs, ejecutar JS,
 * sacar screenshots o leer el texto de la pagina.
 *
 * SEGURIDAD (esto puede ejecutar JS con tus cookies, asi que va blindado):
 *  - APAGADO por defecto; se enciende a mano en el panel de automatizacion.
 *  - Solo escucha en 127.0.0.1 (jamas accesible desde la red).
 *  - Token Bearer obligatorio, comparado en tiempo constante. Una pagina web NO
 *    puede mandar el header Authorization cross-origin sin pasar un preflight
 *    CORS… y aqui no hay CORS: el preflight muere y la peticion nunca llega.
 *  - Verifica el header Host (anti DNS-rebinding: un dominio malicioso que
 *    resuelva a 127.0.0.1 llegaria con Host ajeno y se rechaza).
 *  - El token se guarda CIFRADO (safeStorage/DPAPI) en tek-bridge.json: en reposo
 *    no hay nada reutilizable si copian tu disco o un backup. El token EN CLARO y
 *    el puerto solo existen en tek-bridge-runtime.json MIENTRAS el puente corre
 *    (para que las CLI locales lo descubran); ese archivo se BORRA al apagarlo.
 *    Si el sistema no ofrece cifrado, el token vive solo en memoria esta sesion
 *    (se regenera al reiniciar) — nunca en claro permanente en disco.
 */

interface BridgeData {
  /** Token cifrado con safeStorage (DPAPI), en base64. '' si aun no hay. */
  secret: string
}

export interface BridgeDeps {
  listTabs(): { id: string; title: string; url: string; active: boolean }[]
  openTab(url: string): string | null
  activateTab(id: string): void
  closeTab(id: string): void
  navigate(url: string, tabId?: string): void
  evalJs(code: string, tabId?: string): Promise<SnippetResult>
  screenshot(tabId?: string): Promise<Buffer | null>
  pageText(tabId?: string): Promise<{ url: string; title: string; text: string } | null>
}

const PORTS = [4923, 4924, 4925, 4926, 4927, 4928]
const MAX_BODY = 1_048_576 // 1MB

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body demasiado grande'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch {
        reject(new Error('JSON invalido'))
      }
    })
    req.on('error', reject)
  })
}

/** Comparacion en tiempo constante (hash a longitud fija primero). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export class AgentBridge {
  private readonly store = new JsonStore<BridgeData>('tek-bridge.json', { secret: '' })
  /** Archivo efimero con token+puerto en claro para auto-discovery; solo mientras corre. */
  private readonly runtimeFile = join(app.getPath('userData'), 'tek-bridge-runtime.json')
  private server: Server | null = null
  private port = 0
  private deps: BridgeDeps | null = null
  /** Token en claro: SOLO en memoria (en disco va cifrado). */
  private token = ''

  constructor() {
    // Token estable por instalacion: descifra el guardado o genera uno nuevo.
    const stored = this.store.data.secret
    if (stored) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          this.token = safeStorage.decryptString(Buffer.from(stored, 'base64'))
        }
      } catch {
        this.token = '' // secreto corrupto / cuenta distinta: regeneramos
      }
    }
    if (!this.token) {
      this.token = randomBytes(24).toString('base64url')
      this.persistToken()
    }
  }

  /** Guarda el token CIFRADO. Sin cifrado del sistema no se persiste (vive en memoria). */
  private persistToken(): void {
    try {
      if (!safeStorage.isEncryptionAvailable()) return
      // Reemplaza el objeto entero: descarta cualquier {token,port} en claro de un
      // tek-bridge.json de una version anterior (migracion limpia).
      this.store.data = { secret: safeStorage.encryptString(this.token).toString('base64') }
      this.store.flush()
    } catch {
      /* sin cifrado disponible: el token vive solo esta sesion */
    }
  }

  setDeps(deps: BridgeDeps): void {
    this.deps = deps
  }

  status(enabled: boolean): BridgeStatus {
    return {
      enabled,
      running: this.server !== null,
      port: this.port,
      token: this.token
    }
  }

  async start(): Promise<void> {
    if (this.server) return
    for (const port of PORTS) {
      const ok = await this.tryListen(port)
      if (ok) {
        this.port = port
        this.writeRuntime() // las CLI locales descubren puerto+token leyendo el runtime json
        return
      }
    }
    console.error('[TEK Bridge] sin puerto libre; puente no arrancado')
  }

  /** Escribe el archivo efimero de descubrimiento (token+puerto en claro, solo en uso). */
  private writeRuntime(): void {
    try {
      writeFileSync(
        this.runtimeFile,
        JSON.stringify({ token: this.token, port: this.port }),
        'utf8'
      )
    } catch {
      /* sin auto-discovery: el usuario copia el token del panel */
    }
  }

  /** Borra el archivo efimero (al apagar: nada de token en claro en reposo). */
  private clearRuntime(): void {
    try {
      rmSync(this.runtimeFile, { force: true })
    } catch {
      /* ya no estaba */
    }
  }

  private tryListen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer((req, res) => void this.handle(req, res))
      server.once('error', () => {
        server.close()
        resolve(false)
      })
      // SOLO loopback: nunca accesible desde fuera de esta maquina.
      server.listen(port, '127.0.0.1', () => {
        this.server = server
        resolve(true)
      })
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
    this.port = 0
    this.clearRuntime()
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = (code: number, data: unknown): void => {
      const body = JSON.stringify(data)
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
      res.end(body)
    }
    try {
      // Sin CORS a proposito: el preflight de un navegador muere aqui.
      if (req.method === 'OPTIONS') {
        json(403, { error: 'no' })
        return
      }
      // Anti DNS-rebinding: el Host debe ser el loopback que servimos.
      const host = req.headers.host ?? ''
      if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
        json(403, { error: 'host invalido' })
        return
      }
      // Token Bearer obligatorio.
      const auth = req.headers.authorization ?? ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
      if (!token || !safeEqual(token, this.token)) {
        json(401, { error: 'token invalido' })
        return
      }
      if (!this.deps) {
        json(503, { error: 'sin navegador' })
        return
      }

      const url = new URL(req.url ?? '/', `http://${host}`)
      const route = `${req.method} ${url.pathname}`
      const deps = this.deps

      if (route === 'GET /tabs') {
        json(200, { tabs: deps.listTabs() })
      } else if (route === 'POST /open') {
        const body = await readBody(req)
        const target = String(body.url ?? '')
        if (!/^https?:\/\//i.test(target)) {
          json(400, { error: 'url debe ser http(s)' })
          return
        }
        json(200, { id: deps.openTab(target) })
      } else if (route === 'POST /activate') {
        const body = await readBody(req)
        deps.activateTab(String(body.id ?? ''))
        json(200, { ok: true })
      } else if (route === 'POST /close') {
        const body = await readBody(req)
        deps.closeTab(String(body.id ?? ''))
        json(200, { ok: true })
      } else if (route === 'POST /navigate') {
        const body = await readBody(req)
        const target = String(body.url ?? '')
        if (!/^https?:\/\//i.test(target)) {
          json(400, { error: 'url debe ser http(s)' })
          return
        }
        deps.navigate(target, body.id ? String(body.id) : undefined)
        json(200, { ok: true })
      } else if (route === 'POST /eval') {
        const body = await readBody(req)
        const result = await deps.evalJs(String(body.code ?? ''), body.id ? String(body.id) : undefined)
        json(200, result)
      } else if (route === 'GET /screenshot') {
        const png = await deps.screenshot(url.searchParams.get('id') ?? undefined)
        if (!png) {
          json(404, { error: 'sin pestaña' })
          return
        }
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(png)
      } else if (route === 'GET /text') {
        const page = await deps.pageText(url.searchParams.get('id') ?? undefined)
        if (!page) {
          json(404, { error: 'sin pestaña' })
          return
        }
        json(200, page)
      } else {
        json(404, { error: 'ruta desconocida' })
      }
    } catch (err) {
      json(400, { error: err instanceof Error ? err.message : 'error' })
    }
  }

  dispose(): void {
    this.stop()
    this.deps = null
    this.store.dispose()
  }
}
