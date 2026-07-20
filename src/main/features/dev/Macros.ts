import { randomUUID } from 'node:crypto'
import { WV, type Macro, type MacroStep } from '@shared/ipc'
import { JsonStore } from './jsonStore'

/**
 * Macros: graba un flujo (clics, texto, Enter) sobre la pestana activa y lo
 * reproduce despues. La grabacion vive en el preload de la pagina (selectores
 * robustos, NUNCA el valor de un campo password); la reproduccion corre desde
 * aqui con executeJavaScript paso a paso, esperando a que cada selector exista
 * (las SPA tardan en pintar).
 */

interface MacrosData {
  macros: Macro[]
}

export interface MacroDeps {
  getActiveWc(): Electron.WebContents | null
  /** Abre una pestana nueva para reproducir y devuelve su webContents. */
  openTabForMacro(url: string): Electron.WebContents | null
}

/** Espera maxima a que aparezca un selector al reproducir. */
const WAIT_SELECTOR_MS = 8000
/** Espera maxima a que cargue una navegacion. */
const WAIT_LOAD_MS = 20_000
/** Pausa entre pasos (deja respirar a la pagina). */
const STEP_GAP_MS = 300

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Espera a que el webContents termine de cargar (o agota el tiempo). */
function waitLoaded(wc: Electron.WebContents): Promise<void> {
  return new Promise((resolve) => {
    if (wc.isDestroyed() || !wc.isLoading()) {
      resolve()
      return
    }
    const done = (): void => {
      clearTimeout(timer)
      wc.removeListener('did-stop-loading', done)
      resolve()
    }
    const timer = setTimeout(done, WAIT_LOAD_MS)
    wc.on('did-stop-loading', done)
  })
}

/** JS que corre EN LA PAGINA: espera el selector y ejecuta la accion. */
function stepScript(step: MacroStep): string {
  const sel = JSON.stringify('selector' in step ? step.selector : '')
  const body =
    step.type === 'click'
      ? `el.scrollIntoView({ block: 'center' });
         el.focus && el.focus();
         el.click();`
      : step.type === 'input'
        ? `const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
           const set = Object.getOwnPropertyDescriptor(proto, 'value');
           el.focus && el.focus();
           if (set && set.set) set.set.call(el, ${JSON.stringify(step.type === 'input' ? step.value : '')});
           else el.value = ${JSON.stringify(step.type === 'input' ? step.value : '')};
           el.dispatchEvent(new Event('input', { bubbles: true }));
           el.dispatchEvent(new Event('change', { bubbles: true }));`
        : `const key = ${JSON.stringify(step.type === 'key' ? step.key : 'Enter')};
           el.focus && el.focus();
           for (const t of ['keydown', 'keypress', 'keyup']) {
             el.dispatchEvent(new KeyboardEvent(t, { key, bubbles: true, cancelable: true }));
           }
           if (key === 'Enter' && el.form && el.form.requestSubmit) el.form.requestSubmit();`
  return `(async () => {
    const find = () => document.querySelector(${sel});
    const t0 = Date.now();
    while (!find() && Date.now() - t0 < ${WAIT_SELECTOR_MS}) {
      await new Promise((r) => setTimeout(r, 120));
    }
    const el = find();
    if (!el) return false;
    ${body}
    return true;
  })()`
}

export class Macros {
  private readonly store = new JsonStore<MacrosData>('tek-macros.json', { macros: [] })
  private deps: MacroDeps | null = null
  /** webContents.id de la pestana que esta grabando (null = sin grabacion). */
  private recordingWcId: number | null = null
  private steps: MacroStep[] = []
  private startUrl = ''
  /** Indicador REC del renderer. */
  onRecState: ((recording: boolean) => void) | null = null

  setDeps(deps: MacroDeps): void {
    this.deps = deps
  }

  list(): Macro[] {
    return this.store.data.macros
  }

  get recording(): boolean {
    return this.recordingWcId !== null
  }

  delete(id: string): void {
    this.store.data.macros = this.store.data.macros.filter((m) => m.id !== id)
    this.store.save()
  }

  // --- Grabacion ----------------------------------------------------------------

  startRecording(): boolean {
    if (this.recording) return false
    const wc = this.deps?.getActiveWc() ?? null
    const url = wc && !wc.isDestroyed() ? wc.getURL() : ''
    if (!wc || !url || url === 'about:blank') return false
    this.recordingWcId = wc.id
    this.steps = []
    this.startUrl = url
    wc.send(WV.macroMode, true)
    this.onRecState?.(true)
    return true
  }

  /** Para la grabacion. Con nombre la guarda; con null la descarta. */
  stopRecording(name: string | null): Macro | null {
    if (!this.recording) return null
    const wc = this.deps?.getActiveWc()
    if (wc && !wc.isDestroyed() && wc.id === this.recordingWcId) wc.send(WV.macroMode, false)
    const steps = this.steps
    const startUrl = this.startUrl
    this.recordingWcId = null
    this.steps = []
    this.startUrl = ''
    this.onRecState?.(false)
    if (!name || steps.length === 0) return null
    const macro: Macro = {
      id: randomUUID(),
      name: String(name).trim().slice(0, 80) || 'Macro',
      startUrl,
      steps: steps.slice(0, 200),
      createdAt: Date.now()
    }
    this.store.data.macros.push(macro)
    this.store.save()
    return macro
  }

  /** ¿Este webContents es el que esta grabando? (lo pregunta el preload). */
  isRecordingWc(wcId: number): boolean {
    return this.recordingWcId === wcId
  }

  /** Paso reportado por el preload mientras graba. Valida: viene de la pagina. */
  handleEvent(sender: Electron.WebContents, raw: unknown): void {
    if (sender.id !== this.recordingWcId || !raw || typeof raw !== 'object') return
    const s = raw as Record<string, unknown>
    const selector = typeof s.selector === 'string' ? s.selector.slice(0, 500) : ''
    let step: MacroStep | null = null
    if (s.type === 'click' && selector) step = { type: 'click', selector }
    else if (s.type === 'input' && selector) {
      step = { type: 'input', selector, value: String(s.value ?? '').slice(0, 2000) }
    } else if (s.type === 'key' && selector) {
      step = { type: 'key', selector, key: String(s.key ?? 'Enter').slice(0, 20) }
    }
    if (step && this.steps.length < 200) this.steps.push(step)
  }

  /** La pestana que graba navego: registra el paso y rearma el modo grabacion. */
  handleNavigate(wcId: number, url: string): void {
    if (wcId !== this.recordingWcId || !url || url === 'about:blank') return
    const last = this.steps[this.steps.length - 1]
    // Una navegacion suele ser CONSECUENCIA del clic anterior: solo guardamos
    // goto explicitos (escribir URL) = cuando el paso previo no fue interaccion.
    if (!last || last.type === 'input') this.steps.push({ type: 'goto', url })
  }

  // --- Reproduccion ---------------------------------------------------------------

  async run(id: string): Promise<void> {
    const m = this.store.data.macros.find((x) => x.id === id)
    if (!m || !this.deps || this.recording) return
    const wc = this.deps.openTabForMacro(m.startUrl)
    if (!wc) return
    await waitLoaded(wc)
    await sleep(500)
    for (const step of m.steps) {
      if (wc.isDestroyed()) return
      if (step.type === 'goto') {
        await wc.loadURL(step.url).catch(() => undefined)
        await waitLoaded(wc)
      } else {
        await wc.executeJavaScript(stepScript(step), true).catch(() => undefined)
        // El paso pudo disparar una navegacion (submit, link): esperala.
        await sleep(STEP_GAP_MS)
        await waitLoaded(wc)
      }
    }
  }

  dispose(): void {
    this.onRecState = null
    this.store.dispose()
  }
}
