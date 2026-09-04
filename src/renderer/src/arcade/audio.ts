/**
 * El sonido de INTERFERENCIA, sintetizado en el momento con WebAudio.
 *
 * CERO archivos: ni un wav, ni un mp3, ni un base64 gordo en el bundle. Todo son
 * osciladores y una tabla de ruido blanco de medio segundo que se reutiliza. Eso
 * encaja con TEK (un navegador no debe engordar por un juego) y de paso suena a
 * maquina recreativa, que es justo lo que se busca.
 *
 * El AudioContext NO se crea hasta que el jugador toca algo: los navegadores
 * exigen un gesto para arrancar el audio, y la pantalla de titulo lo garantiza.
 */

import type { Sonido } from './engine'

/** Ventana minima (s) entre dos disparos audibles: la rafaga III dispara a 25/s
 *  y sin freno se convierte en un zumbido plano (y en cientos de nodos). */
const FRENO_DISPARO = 0.045

export class ArcadeAudio {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private ruido: AudioBuffer | null = null
  private ultimoDisparo = 0
  private silencio: boolean

  constructor(silencio = false) {
    this.silencio = silencio
  }

  get mudo(): boolean {
    return this.silencio
  }

  /** Enciende el audio. Hay que llamarlo DENTRO de un gesto del usuario. */
  arrancar(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    type ConVendor = typeof globalThis & { webkitAudioContext?: typeof AudioContext }
    const Ctor = window.AudioContext ?? (globalThis as ConVendor).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    const master = ctx.createGain()
    master.gain.value = this.silencio ? 0 : 0.5
    master.connect(ctx.destination)

    // Tabla de ruido blanco, una vez. La usan todas las explosiones.
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate)
    const datos = buf.getChannelData(0)
    for (let i = 0; i < datos.length; i++) datos[i] = Math.random() * 2 - 1

    this.ctx = ctx
    this.master = master
    this.ruido = buf
  }

  alternarMudo(): boolean {
    this.silencio = !this.silencio
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.silencio ? 0 : 0.5, this.ctx.currentTime, 0.02)
    }
    return this.silencio
  }

  /** Un oscilador con envolvente, que se limpia solo al terminar. */
  private tono(
    tipo: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    retraso = 0
  ): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    const t = ctx.currentTime + retraso
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = tipo
    osc.frequency.setValueAtTime(f0, t)
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    // Ataque muy corto y caida exponencial: el "plop" de las recreativas.
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(g).connect(master)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  /** Ruido filtrado: la base de explosiones, danos y el barrido. */
  private golpe(
    dur: number,
    vol: number,
    f0: number,
    f1: number,
    tipoFiltro: BiquadFilterType = 'lowpass',
    retraso = 0
  ): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || !this.ruido) return
    const t = ctx.currentTime + retraso
    const src = ctx.createBufferSource()
    src.buffer = this.ruido
    const filtro = ctx.createBiquadFilter()
    filtro.type = tipoFiltro
    filtro.Q.value = tipoFiltro === 'bandpass' ? 6 : 1
    filtro.frequency.setValueAtTime(f0, t)
    filtro.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filtro).connect(g).connect(master)
    src.start(t)
    src.stop(t + dur + 0.02)
  }

  reproducir(s: Sonido): void {
    if (this.silencio || !this.ctx) return

    switch (s) {
      case 'disparo': {
        const ahora = this.ctx.currentTime
        if (ahora - this.ultimoDisparo < FRENO_DISPARO) return
        this.ultimoDisparo = ahora
        this.tono('square', 900, 260, 0.07, 0.1)
        break
      }
      case 'boom':
        this.golpe(0.19, 0.32, 1500, 90)
        this.tono('triangle', 200, 60, 0.16, 0.09)
        break
      case 'boomGrande':
        this.golpe(0.75, 0.5, 2600, 60)
        this.tono('sawtooth', 150, 28, 0.7, 0.16)
        this.tono('square', 90, 30, 0.5, 0.1, 0.06)
        break
      case 'power':
        // Arpegio ascendente: se oye "bueno" sin necesidad de leer el cartel.
        this.tono('triangle', 520, 520, 0.08, 0.13)
        this.tono('triangle', 700, 700, 0.08, 0.13, 0.07)
        this.tono('triangle', 1040, 1040, 0.14, 0.14, 0.14)
        break
      case 'dano':
        this.golpe(0.4, 0.4, 900, 60)
        this.tono('sawtooth', 340, 50, 0.42, 0.16)
        break
      case 'escudo':
        this.tono('sine', 1500, 700, 0.16, 0.13)
        this.golpe(0.12, 0.16, 3000, 900, 'bandpass')
        break
      case 'barrido':
        // El retrazado: un barrido de ruido que sube, con un golpe grave debajo.
        this.golpe(0.55, 0.36, 200, 5200, 'bandpass')
        this.tono('sawtooth', 60, 340, 0.5, 0.14)
        this.tono('square', 1200, 90, 0.24, 0.08, 0.42)
        break
      case 'oleada':
        this.tono('square', 620, 620, 0.09, 0.1)
        this.tono('square', 930, 930, 0.16, 0.1, 0.1)
        break
      case 'rebote':
        this.tono('square', 1700, 2200, 0.06, 0.09)
        break
      case 'jefe':
        this.tono('sawtooth', 110, 70, 0.28, 0.11)
        break
    }
  }

  dispose(): void {
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    this.ruido = null
    if (ctx) void ctx.close().catch(() => undefined)
  }
}
