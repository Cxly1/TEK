/**
 * Mandos de INTERFERENCIA: teclado y raton a la vez.
 *
 * El que se mueve, manda. Si tocas el raton la nave sigue al puntero; en cuanto
 * pulsas una flecha vuelve al teclado. Sin modos que elegir ni ajustes: es lo
 * que espera cualquiera que se siente delante de un arcade.
 */

import type { Input } from './types'
import type { Pintor } from './render'

export interface MandoAcciones {
  /** Primer gesto del jugador: arranca la partida (y el audio, que exige gesto). */
  empezar: () => void
  pausa: () => void
  reiniciar: () => void
  salir: () => void
  alternarMudo: () => void
}

const IZQ = new Set(['arrowleft', 'a'])
const DER = new Set(['arrowright', 'd'])
const FUEGO = new Set([' ', 'arrowup', 'w'])

export class Mandos {
  private readonly pintor: Pintor
  private readonly acciones: MandoAcciones
  private readonly pulsadas = new Set<string>()
  private ratonX: number | null = null
  private fuegoRaton = false
  /** Quien lleva la nave ahora mismo. Lo decide el ultimo que actuo. */
  private modo: 'teclado' | 'raton' = 'raton'
  /** Flanco del BARRIDO: se pone a true al pulsar y lo consume el motor. */
  private pedidoBarrido = false
  private readonly limpiadores: (() => void)[] = []

  constructor(el: HTMLElement, pintor: Pintor, acciones: MandoAcciones) {
    this.pintor = pintor
    this.acciones = acciones

    const onKeyDown = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase()

      // Cualquier tecla saca de la pantalla de titulo (menos las de sistema).
      if (k !== 'escape' && k !== 'tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.acciones.empezar()
      }

      // Las teclas de mando NO siguen su camino: fuera de aqui la 'p' o la 'm'
      // abririan la paleta del navegador con esa letra dentro.
      const mio = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }
      switch (k) {
        case 'escape':
          mio()
          this.acciones.salir()
          return
        case 'p':
          mio()
          this.acciones.pausa()
          return
        case 'm':
          mio()
          this.acciones.alternarMudo()
          return
        case 'r':
          mio()
          this.acciones.reiniciar()
          return
      }

      if (IZQ.has(k) || DER.has(k)) this.modo = 'teclado'
      if (k === 'shift' && !e.repeat) this.pedidoBarrido = true

      // El espacio y las flechas se quedan aqui: fuera de esta superficie
      // significan otra cosa (el shell abre la paleta con cualquier tecla).
      if (IZQ.has(k) || DER.has(k) || FUEGO.has(k) || k === 'shift') {
        e.preventDefault()
        e.stopPropagation()
        this.pulsadas.add(k)
      }
    }

    const onKeyUp = (e: KeyboardEvent): void => {
      this.pulsadas.delete(e.key.toLowerCase())
    }

    // Si la ventana pierde el foco, se sueltan todas las teclas: si no, la nave
    // se queda "andando sola" al volver (clasico de los juegos en navegador).
    const onBlur = (): void => {
      this.pulsadas.clear()
      this.fuegoRaton = false
    }

    const onPointerMove = (e: PointerEvent): void => {
      this.modo = 'raton'
      this.ratonX = this.pintor.aLogico(e.clientX)
    }

    const onPointerDown = (e: PointerEvent): void => {
      this.acciones.empezar()
      this.modo = 'raton'
      this.ratonX = this.pintor.aLogico(e.clientX)
      if (e.button === 2) this.pedidoBarrido = true
      else this.fuegoRaton = true
      e.preventDefault()
    }

    const onPointerUp = (): void => {
      this.fuegoRaton = false
    }

    const onContextMenu = (e: MouseEvent): void => e.preventDefault()

    // El teclado se escucha en captura sobre window: el juego tiene prioridad
    // sobre los atajos del shell mientras esta en pantalla.
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    el.addEventListener('contextmenu', onContextMenu)

    this.limpiadores.push(
      () => window.removeEventListener('keydown', onKeyDown, true),
      () => window.removeEventListener('keyup', onKeyUp, true),
      () => window.removeEventListener('blur', onBlur),
      () => el.removeEventListener('pointermove', onPointerMove),
      () => el.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => el.removeEventListener('contextmenu', onContextMenu)
    )
  }

  /** El estado de los mandos para ESTE frame. Consume el flanco del barrido. */
  leer(): Input {
    let eje = 0
    for (const k of this.pulsadas) {
      if (IZQ.has(k)) eje -= 1
      else if (DER.has(k)) eje += 1
    }
    let fuego = this.fuegoRaton
    if (!fuego) {
      for (const k of this.pulsadas) {
        if (FUEGO.has(k)) {
          fuego = true
          break
        }
      }
    }

    const barrido = this.pedidoBarrido
    this.pedidoBarrido = false

    return {
      eje: Math.sign(eje),
      raton: this.modo === 'raton' ? this.ratonX : null,
      fuego,
      barrido
    }
  }

  /** Suelta todo (al pausar: la nave no debe seguir disparando de fondo). */
  soltar(): void {
    this.pulsadas.clear()
    this.fuegoRaton = false
    this.pedidoBarrido = false
  }

  dispose(): void {
    for (const off of this.limpiadores) off()
    this.limpiadores.length = 0
  }
}
