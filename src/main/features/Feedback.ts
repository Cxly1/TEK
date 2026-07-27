import { app, net } from 'electron'
import { release } from 'node:os'
import type { FeedbackDraft, FeedbackResult } from '@shared/ipc'

/**
 * "Reportar un fallo": lo que la persona escribe llega al correo de quien
 * mantiene TEK, sin que tenga que salir de la app ni tener cuenta de nada.
 *
 * VA POR EL MAIN, no por el renderer: la CSP del shell no deja hablar con
 * dominios de fuera, y aqui `net.fetch` ya usa los certificados del sistema (el
 * `fetch` de Node falla en algunas redes — mismo motivo que en Adblock.ts).
 *
 * QUE SE ENVIA, y nada mas: el texto que escribio, el contacto que haya querido
 * dejar, la version de TEK y la de Windows. El sitio donde estaba SOLO si marco
 * la casilla. Ni historial, ni pestanas, ni nada que no se vea en el panel antes
 * de darle a enviar.
 */

/**
 * Clave PUBLICA de Web3Forms (web3forms.com/#start): identifica el buzon de
 * destino, NO da acceso a nada. Esta pensada para ir en codigo de cliente a la
 * vista, por eso puede estar en un repo publico — y por eso el correo de destino
 * NO aparece aqui.
 *
 * VACIA = el envio esta apagado: el panel lo dice y ofrece copiar el reporte.
 */
const ACCESS_KEY = 'f21aac9f-b459-4cc3-a08a-dac97aa45970'

const ENDPOINT = 'https://api.web3forms.com/submit'
/** Tope del mensaje. Lo mismo que muestra el contador del panel. */
const MAX_MESSAGE = 2000
/** Un envio por minuto: ni un dedo nervioso ni un bucle pueden inundar el buzon. */
const MIN_GAP_MS = 60_000
/** Si el servidor no contesta en esto, se da por fallido (y se puede copiar). */
const TIMEOUT_MS = 15_000

export class Feedback {
  private lastSentAt = 0

  constructor(private readonly currentUrl: () => string) {}

  /** Hay a donde enviar (si no, el panel solo deja copiar). */
  get enabled(): boolean {
    return ACCESS_KEY.length > 0
  }

  /** El reporte tal cual, en texto plano: es lo que se manda Y lo que se copia. */
  private compose(draft: FeedbackDraft): string {
    const lines = [
      draft.message.trim().slice(0, MAX_MESSAGE),
      '',
      `TEK ${app.getVersion()}${app.isPackaged ? '' : ' (dev)'}`,
      `Windows ${release()}`
    ]
    if (draft.contact.trim()) lines.push(`Contacto: ${draft.contact.trim().slice(0, 120)}`)
    if (draft.includeSite) {
      const url = this.currentUrl()
      if (url) lines.push(`Sitio: ${url.slice(0, 300)}`)
    }
    return lines.join('\n')
  }

  async send(raw: unknown): Promise<FeedbackResult> {
    // Viene del renderer: se valida entero antes de tocarlo.
    const d = (raw ?? {}) as Partial<FeedbackDraft>
    const draft: FeedbackDraft = {
      message: typeof d.message === 'string' ? d.message : '',
      contact: typeof d.contact === 'string' ? d.contact : '',
      includeSite: d.includeSite === true
    }
    const text = this.compose(draft)
    if (!draft.message.trim()) {
      return { ok: false, note: 'Escribe qué pasó antes de enviarlo.', text }
    }
    if (!this.enabled) {
      return {
        ok: false,
        note: 'El envío todavía no está configurado en esta versión. Copia el reporte y mándamelo por donde quieras.',
        text
      }
    }
    const since = Date.now() - this.lastSentAt
    if (since < MIN_GAP_MS) {
      const wait = Math.ceil((MIN_GAP_MS - since) / 1000)
      return { ok: false, note: `Espera ${wait} s antes de mandar otro reporte.`, text }
    }

    const stop = AbortSignal.timeout(TIMEOUT_MS)
    try {
      const res = await net.fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: stop,
        body: JSON.stringify({
          access_key: ACCESS_KEY,
          subject: `TEK ${app.getVersion()} — reporte de un fallo`,
          from_name: 'TEK',
          // Si dejo un correo, responderle es darle a Responder.
          ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.contact.trim())
            ? { replyto: draft.contact.trim() }
            : {}),
          message: text
        })
      })
      const body = (await res.json().catch(() => null)) as { success?: boolean } | null
      if (!res.ok || !body?.success) {
        return {
          ok: false,
          note: 'El servidor no aceptó el reporte. Puedes copiarlo y mandármelo a mano.',
          text
        }
      }
      this.lastSentAt = Date.now()
      return { ok: true, note: '¡Enviado! Gracias — con esto puedo arreglarlo.', text }
    } catch {
      return {
        ok: false,
        note: 'No se pudo conectar. Revisa tu conexión, o copia el reporte y mándamelo a mano.',
        text
      }
    }
  }
}
