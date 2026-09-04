/**
 * El dibujo de INTERFERENCIA. Todo es vectorial: ni una imagen, ni un sprite.
 *
 * Se pinta en DOS pasos, que es lo que da el aspecto de monitor viejo:
 *   1. la escena en un lienzo interno de W x H logicos (el "tubo"),
 *   2. el tubo se compone sobre el visible con los defectos del CRT — sacudida,
 *      desenganche vertical, aberracion cromatica, lineas de barrido y viñeta.
 *
 * Separarlo asi tiene una ventaja practica: el juego dibuja SIEMPRE en 420x660,
 * asi que nada depende del tamaño de la ventana, y los efectos son tres
 * `drawImage` sobre un lienzo diminuto (277 mil pixeles) en vez de filtros CSS
 * caros sobre toda la interfaz — ver el aprendizaje de rendimiento del renderer.
 */

import { armaHud, lineaBarrido } from './engine'
import { BARRIDO_DUR, H, NAVE_Y, W, type Enemy, type World } from './types'
import { LINEA_MUERTE, ranuraY } from './waves'

type C2D = CanvasRenderingContext2D

const FOSFORO = '#f2f3f5'
const ORO = '#e3b341'
const ROJO = '#ff4d3d'
const AZUL = '#3da2ff'
const MONO = "'JetBrains Mono', 'Cascadia Code', Consolas, ui-monospace, monospace"

/** Separa los millares con espacio fino: "1 204 500". Sin locales ni sorpresas. */
function num(n: number): string {
  return Math.floor(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/**
 * Traza el camino que haya en curso DOS veces: un halo ancho y tenue y encima la
 * linea nitida. Es el truco de todo el look: imita como el fosforo desborda la
 * linea sin pagar un `shadowBlur` por objeto (que si hunde los fps).
 */
function fosforo(ctx: C2D, color: string, ancho = 1.6, alpha = 1): void {
  ctx.strokeStyle = color
  ctx.lineWidth = ancho + 3.4
  ctx.globalAlpha = alpha * 0.13
  ctx.stroke()
  ctx.lineWidth = ancho
  ctx.globalAlpha = alpha
  ctx.stroke()
  ctx.globalAlpha = 1
}

function relleno(ctx: C2D, color: string, alpha = 1): void {
  ctx.fillStyle = color
  ctx.globalAlpha = alpha
  ctx.fill()
  ctx.globalAlpha = 1
}

function texto(
  ctx: C2D,
  s: string,
  x: number,
  y: number,
  tam: number,
  color = FOSFORO,
  alin: CanvasTextAlign = 'left',
  peso = 500,
  alpha = 1
): void {
  ctx.font = `${peso} ${tam}px ${MONO}`
  ctx.textAlign = alin
  ctx.textBaseline = 'alphabetic'
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.fillText(s, x, y)
  ctx.globalAlpha = 1
}

export class Pintor {
  private readonly vista: HTMLCanvasElement
  private readonly ctx: C2D
  private readonly tubo: HTMLCanvasElement
  private readonly tc: C2D
  /** Copia teñida, solo para la aberracion cromatica (se crea al vuelo). */
  private tinte: HTMLCanvasElement | null = null
  private rayas: CanvasPattern | null = null
  private vinieta: CanvasGradient | null = null
  /** Campo de estatica de fondo: posiciones fijas que se animan con el tiempo. */
  private readonly polvo: { x: number; y: number; r: number; v: number }[] = []
  private ancho = W
  private alto = H

  constructor(vista: HTMLCanvasElement) {
    this.vista = vista
    const ctx = vista.getContext('2d', { alpha: false })
    const tubo = document.createElement('canvas')
    tubo.width = W
    tubo.height = H
    const tc = tubo.getContext('2d')
    if (!ctx || !tc) throw new Error('sin canvas 2d')
    this.ctx = ctx
    this.tubo = tubo
    this.tc = tc

    for (let i = 0; i < 110; i++) {
      this.polvo.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() < 0.85 ? 0.7 : 1.3,
        v: 5 + Math.random() * 22
      })
    }

    // Patron de lineas de barrido: 4px de alto, una oscura. Se cachea una vez.
    const p = document.createElement('canvas')
    p.width = 1
    p.height = 4
    const pc = p.getContext('2d')
    if (pc) {
      pc.fillStyle = 'rgba(0,0,0,0.34)'
      pc.fillRect(0, 2, 1, 1)
      pc.fillStyle = 'rgba(0,0,0,0.16)'
      pc.fillRect(0, 3, 1, 1)
      this.rayas = tc.createPattern(p, 'repeat')
    }

    const g = tc.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.78)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, 'rgba(0,0,0,0.62)')
    this.vinieta = g
  }

  /**
   * Ajusta el lienzo visible al hueco disponible conservando el 420x660 del tubo.
   * Devuelve el tamaño CSS elegido para que el contenedor lo centre.
   */
  redimensionar(cajaW: number, cajaH: number, dpr: number): { w: number; h: number } {
    const escala = Math.max(0.2, Math.min(cajaW / W, cajaH / H))
    this.ancho = Math.round(W * escala)
    this.alto = Math.round(H * escala)
    this.vista.style.width = `${this.ancho}px`
    this.vista.style.height = `${this.alto}px`
    this.vista.width = Math.round(this.ancho * dpr)
    this.vista.height = Math.round(this.alto * dpr)
    return { w: this.ancho, h: this.alto }
  }

  // --- Fondo ----------------------------------------------------------------

  private fondo(w: World, tr: number): void {
    const ctx = this.tc
    ctx.fillStyle = '#060607'
    ctx.fillRect(0, 0, W, H)

    // Estatica: puntos de fosforo que caen. Es el "ruido de portadora" del tubo.
    ctx.fillStyle = FOSFORO
    for (const d of this.polvo) {
      const y = (d.y + tr * d.v) % H
      ctx.globalAlpha = 0.05 + (d.r > 1 ? 0.06 : 0)
      ctx.fillRect(d.x, y, d.r, d.r)
    }
    ctx.globalAlpha = 1

    // Banda de interferencia: una franja mas clara que baja sin parar.
    const by = ((tr * 46) % (H + 160)) - 80
    const g = ctx.createLinearGradient(0, by, 0, by + 70)
    g.addColorStop(0, 'rgba(242,243,245,0)')
    g.addColorStop(0.5, 'rgba(242,243,245,0.045)')
    g.addColorStop(1, 'rgba(242,243,245,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, by, W, 70)

    // La linea de la muerte: hasta donde puede bajar la formacion.
    ctx.beginPath()
    ctx.setLineDash([5, 9])
    ctx.moveTo(0, LINEA_MUERTE)
    ctx.lineTo(W, LINEA_MUERTE)
    ctx.strokeStyle = ROJO
    ctx.globalAlpha = 0.16 + Math.max(0, (w.formY + ranuraY(0) - LINEA_MUERTE + 150) / 150) * 0.2
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  // --- Piezas ---------------------------------------------------------------

  private nave(w: World, tr: number): void {
    const ctx = this.tc
    const n = w.nave
    // Invulnerable = parpadea. Se salta el dibujo en la mitad de los ciclos.
    if (n.inv > 0 && Math.floor(n.inv * 14) % 2 === 0) return

    const x = n.x
    const y = NAVE_Y
    // El "+" de Genesis, con dos alerones: es la nave de TEK, no una generica.
    ctx.beginPath()
    ctx.moveTo(x, y - 13)
    ctx.lineTo(x, y + 8)
    ctx.moveTo(x - 11, y - 1)
    ctx.lineTo(x + 11, y - 1)
    ctx.moveTo(x - 11, y - 1)
    ctx.lineTo(x - 7, y + 9)
    ctx.moveTo(x + 11, y - 1)
    ctx.lineTo(x + 7, y + 9)
    fosforo(ctx, FOSFORO, 2)

    // Llama del propulsor: parpadea con el tiempo, no con los frames.
    const llama = 5 + Math.abs(Math.sin(tr * 32)) * 5
    ctx.beginPath()
    ctx.moveTo(x - 2.5, y + 9)
    ctx.lineTo(x, y + 9 + llama)
    ctx.lineTo(x + 2.5, y + 9)
    fosforo(ctx, AZUL, 1.4, 0.85)

    if (n.escudo > 0) {
      ctx.beginPath()
      ctx.arc(x, y - 1, 19, 0, Math.PI * 2)
      ctx.setLineDash([3, 5])
      ctx.lineDashOffset = -tr * 22
      fosforo(ctx, ORO, 1.4, n.escudo > 1 ? 0.9 : 0.55)
      ctx.setLineDash([])
    }
    if (n.iman > 0) {
      ctx.beginPath()
      ctx.arc(x, y - 1, 26 + Math.sin(tr * 6) * 3, 0, Math.PI * 2)
      fosforo(ctx, ORO, 0.8, 0.18)
    }
  }

  private enemigo(e: Enemy, t: number): void {
    const ctx = this.tc
    const x = e.x
    const y = e.y
    const claro = e.flash > 0
    const col = claro ? '#ffffff' : FOSFORO
    const gr = claro ? 2.6 : 1.5

    switch (e.kind) {
      case 'ruido': {
        // Dos barras desalineadas: se lee como un trozo de imagen rota.
        const d = Math.sin(t * 3 + e.fase) * 2.5
        ctx.beginPath()
        ctx.moveTo(x - 9 + d, y - 4)
        ctx.lineTo(x + 9 + d, y - 4)
        ctx.moveTo(x - 8 - d, y + 1)
        ctx.lineTo(x + 8 - d, y + 1)
        ctx.moveTo(x - 5, y + 6)
        ctx.lineTo(x + 5, y + 6)
        fosforo(ctx, col, gr)
        break
      }

      case 'zumbador': {
        ctx.beginPath()
        ctx.moveTo(x, y - 9)
        ctx.lineTo(x + 8, y)
        ctx.lineTo(x, y + 9)
        ctx.lineTo(x - 8, y)
        ctx.closePath()
        ctx.moveTo(x - 4, y - 6)
        ctx.lineTo(x - 10, y - 13)
        ctx.moveTo(x + 4, y - 6)
        ctx.lineTo(x + 10, y - 13)
        fosforo(ctx, col, gr)
        break
      }

      case 'parasito': {
        ctx.beginPath()
        ctx.arc(x, y, 7, 0, Math.PI * 2)
        fosforo(ctx, col, gr)
        // Las dos crias que lleva dentro, orbitando: avisa de lo que va a pasar.
        for (let i = 0; i < 2; i++) {
          const a = t * 2.4 + e.fase + i * Math.PI
          ctx.beginPath()
          ctx.arc(x + Math.cos(a) * 12, y + Math.sin(a) * 12, 2.2, 0, Math.PI * 2)
          relleno(ctx, col, 0.85)
        }
        break
      }

      case 'cria': {
        ctx.beginPath()
        ctx.moveTo(x, y + 6)
        ctx.lineTo(x + 5, y - 4)
        ctx.lineTo(x - 5, y - 4)
        ctx.closePath()
        fosforo(ctx, col, 1.2)
        break
      }

      case 'blindado': {
        ctx.beginPath()
        ctx.rect(x - 14, y - 11, 28, 22)
        ctx.moveTo(x - 7, y - 4)
        ctx.lineTo(x + 7, y - 4)
        ctx.moveTo(x - 7, y + 3)
        ctx.lineTo(x + 7, y + 3)
        fosforo(ctx, col, gr + 0.5)
        // Blindaje restante en muescas sobre el casco.
        for (let i = 0; i < e.maxHp; i++) {
          const px = x - 12 + i * (24 / Math.max(1, e.maxHp - 1 || 1))
          ctx.beginPath()
          ctx.rect(px - 1.5, y - 16, 3, 3)
          relleno(ctx, col, i < e.hp ? 0.95 : 0.2)
        }
        break
      }

      case 'espejo': {
        ctx.beginPath()
        ctx.arc(x, y, 9, 0, Math.PI * 2)
        fosforo(ctx, col, gr)
        // El escudo giratorio: por donde apunta, rebota. El hueco es la entrada.
        ctx.beginPath()
        ctx.arc(x, y, 15, e.escudo - 0.95, e.escudo + 0.95)
        fosforo(ctx, claro ? '#ffffff' : AZUL, 3)
        break
      }

      case 'jefe': {
        const abierto = e.nucleo
        ctx.beginPath()
        ctx.moveTo(x - 58, y - 22)
        ctx.lineTo(x - 40, y - 32)
        ctx.lineTo(x + 40, y - 32)
        ctx.lineTo(x + 58, y - 22)
        ctx.lineTo(x + 46, y + 26)
        ctx.lineTo(x - 46, y + 26)
        ctx.closePath()
        fosforo(ctx, col, 2.4)

        // Bandas de corrupcion: la imagen del jefe esta "rota" y se desplaza.
        for (let i = 0; i < 3; i++) {
          const by = y - 16 + i * 13
          const d = Math.sin(t * (3 + i) + i) * 9
          ctx.beginPath()
          ctx.moveTo(x - 40 + d, by)
          ctx.lineTo(x + 40 + d, by)
          fosforo(ctx, col, 1, 0.35)
        }

        // Nucleo: cuando se abre es el punto debil (x3). Se ve de lejos.
        ctx.beginPath()
        ctx.arc(x, y, 9 + abierto * 13, 0, Math.PI * 2)
        fosforo(ctx, abierto > 0.35 ? ROJO : col, 2.2, 0.5 + abierto * 0.5)
        if (abierto > 0.35) {
          ctx.beginPath()
          ctx.arc(x, y, 4 + abierto * 6, 0, Math.PI * 2)
          relleno(ctx, ROJO, abierto)
        }

        // Barra de vida del jefe, anclada arriba del tubo.
        const p = Math.max(0, e.hp / e.maxHp)
        ctx.beginPath()
        ctx.rect(60, 52, W - 120, 4)
        fosforo(ctx, col, 1, 0.3)
        ctx.beginPath()
        ctx.rect(60, 52, (W - 120) * p, 4)
        relleno(ctx, p < 0.28 ? ROJO : col, 0.9)
        break
      }
    }
  }

  private balas(w: World): void {
    const ctx = this.tc
    for (const b of w.balas) {
      ctx.beginPath()
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(b.x - b.vx * 0.012, b.y + b.largo)
      fosforo(ctx, b.perfora ? ORO : FOSFORO, b.perfora ? 4 : 1.8)
    }
    for (const b of w.balasEnemigas) {
      ctx.beginPath()
      if (b.rebote) {
        // Un tiro devuelto por un espejo se ve distinto: es TU disparo volviendo.
        ctx.moveTo(b.x - 4, b.y - 4)
        ctx.lineTo(b.x + 4, b.y + 4)
        ctx.moveTo(b.x + 4, b.y - 4)
        ctx.lineTo(b.x - 4, b.y + 4)
        fosforo(ctx, AZUL, 2)
      } else {
        ctx.arc(b.x, b.y, 3.4, 0, Math.PI * 2)
        fosforo(ctx, ROJO, 1.6)
      }
    }
  }

  private powers(w: World): void {
    const ctx = this.tc
    for (const p of w.powers) {
      const pulso = 0.72 + Math.sin(p.t * 7) * 0.28
      ctx.beginPath()
      ctx.rect(p.x - 9, p.y - 9, 18, 18)
      fosforo(ctx, ORO, 1.5, pulso)

      // Iconos dibujados a mano: nada de glifos unicode, que dependen de la
      // fuente del sistema y en un canvas pueden salir como un cuadrado.
      ctx.beginPath()
      switch (p.kind) {
        case 'doble':
          ctx.moveTo(p.x - 3, p.y - 5)
          ctx.lineTo(p.x - 3, p.y + 5)
          ctx.moveTo(p.x + 3, p.y - 5)
          ctx.lineTo(p.x + 3, p.y + 5)
          break
        case 'abanico':
          ctx.moveTo(p.x, p.y + 5)
          ctx.lineTo(p.x - 5, p.y - 5)
          ctx.moveTo(p.x, p.y + 5)
          ctx.lineTo(p.x, p.y - 5)
          ctx.moveTo(p.x, p.y + 5)
          ctx.lineTo(p.x + 5, p.y - 5)
          break
        case 'rafaga':
          ctx.moveTo(p.x - 4, p.y - 4)
          ctx.lineTo(p.x + 4, p.y - 4)
          ctx.moveTo(p.x - 4, p.y)
          ctx.lineTo(p.x + 4, p.y)
          ctx.moveTo(p.x - 4, p.y + 4)
          ctx.lineTo(p.x + 4, p.y + 4)
          break
        case 'perforante':
          ctx.moveTo(p.x, p.y + 5)
          ctx.lineTo(p.x, p.y - 5)
          ctx.moveTo(p.x - 3, p.y - 1)
          ctx.lineTo(p.x, p.y - 5)
          ctx.lineTo(p.x + 3, p.y - 1)
          break
        case 'escudo':
          ctx.arc(p.x, p.y, 5, Math.PI * 0.15, Math.PI * 0.85, true)
          break
        case 'iman':
          ctx.arc(p.x, p.y + 1, 5, Math.PI, 0)
          ctx.moveTo(p.x - 5, p.y + 1)
          ctx.lineTo(p.x - 5, p.y + 5)
          ctx.moveTo(p.x + 5, p.y + 1)
          ctx.lineTo(p.x + 5, p.y + 5)
          break
        default:
          // Vida: el propio glifo de la nave. Se entiende sin leer nada.
          ctx.moveTo(p.x, p.y - 5)
          ctx.lineTo(p.x, p.y + 5)
          ctx.moveTo(p.x - 5, p.y)
          ctx.lineTo(p.x + 5, p.y)
          break
      }
      fosforo(ctx, ORO, 1.6, pulso)
    }
  }

  private chispas(w: World): void {
    const ctx = this.tc
    ctx.fillStyle = FOSFORO
    for (const c of w.chispas) {
      // El fosforo no se apaga de golpe: cae con el cuadrado de lo que le queda.
      const k = c.vida / c.vidaMax
      ctx.globalAlpha = k * k
      ctx.fillRect(c.x - c.r / 2, c.y - c.r / 2, c.r, c.r)
    }
    ctx.globalAlpha = 1
  }

  private barrido(w: World): void {
    if (w.barrido <= 0) return
    const ctx = this.tc
    const y = lineaBarrido(w.barrido)
    const k = w.barrido / BARRIDO_DUR

    // El retrazado: una linea cegadora y la estela caliente que deja detras.
    const g = ctx.createLinearGradient(0, y, 0, y + 90)
    g.addColorStop(0, 'rgba(242,243,245,0.5)')
    g.addColorStop(1, 'rgba(242,243,245,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, y, W, 90)

    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    fosforo(ctx, '#ffffff', 3.5)
    ctx.beginPath()
    ctx.moveTo(0, y + 3)
    ctx.lineTo(W, y + 3)
    fosforo(ctx, ORO, 1.5, 0.5 + k * 0.5)
  }

  // --- HUD ------------------------------------------------------------------

  private hud(w: World, tr: number): void {
    const ctx = this.tc

    texto(ctx, num(w.puntos), 14, 30, 21, FOSFORO, 'left', 600)
    if (w.record > 0) {
      texto(ctx, `RÉCORD ${num(w.record)}`, 14, 43, 9, FOSFORO, 'left', 500, 0.42)
    }
    texto(ctx, `OLEADA ${w.oleada}`, W - 14, 30, 12, FOSFORO, 'right', 600, 0.8)
    if (w.combo > 0) {
      const c = [1, 2, 4, 8][w.combo]
      texto(ctx, `x${c}`, W - 14, 46, 14, ORO, 'right', 700, 0.95)
    }

    // Vidas: el mismo glifo de la nave, para que se lea sin explicaciones.
    for (let i = 0; i < w.nave.vidas; i++) {
      const x = 16 + i * 15
      const y = H - 16
      ctx.beginPath()
      ctx.moveTo(x, y - 5)
      ctx.lineTo(x, y + 4)
      ctx.moveTo(x - 5, y)
      ctx.lineTo(x + 5, y)
      fosforo(ctx, FOSFORO, 1.4, 0.85)
    }

    texto(ctx, armaHud(w), W - 14, H - 12, 10, FOSFORO, 'right', 600, 0.72)

    // Carga del BARRIDO. Llena = late y se anuncia sola.
    const bw = 108
    const bx = W / 2 - bw / 2
    const by = H - 19
    const lleno = w.nave.carga >= 1
    ctx.beginPath()
    ctx.rect(bx, by, bw, 5)
    fosforo(ctx, FOSFORO, 1, 0.25)
    ctx.beginPath()
    ctx.rect(bx, by, bw * w.nave.carga, 5)
    relleno(ctx, lleno ? ORO : FOSFORO, lleno ? 0.75 + Math.sin(tr * 9) * 0.25 : 0.6)
    texto(
      ctx,
      lleno ? 'MAYÚS · BARRIDO' : 'BARRIDO',
      W / 2,
      by - 4,
      8,
      lleno ? ORO : FOSFORO,
      'center',
      600,
      lleno ? 0.95 : 0.35
    )

    // Cartel efimero: entra y sale con su propio desvanecido.
    if (w.cartelT > 0) {
      const a = Math.min(1, w.cartelT * 2.6)
      texto(ctx, w.cartel, W / 2, H * 0.42, 20, FOSFORO, 'center', 700, a * 0.92)
    }
  }

  private velo(alpha = 0.78): void {
    this.tc.fillStyle = `rgba(6,6,7,${alpha})`
    this.tc.fillRect(0, 0, W, H)
  }

  private titulo(w: World, tr: number): void {
    const ctx = this.tc
    this.velo(0.72)
    texto(ctx, 'INTERFERENCIA', W / 2, 150, 27, FOSFORO, 'center', 700)
    texto(ctx, 'la señal se fue. algo baja por el tubo.', W / 2, 173, 10, FOSFORO, 'center', 400, 0.55)

    const filas: [string, string][] = [
      ['← →  /  ratón', 'mover'],
      ['espacio  /  clic', 'disparar'],
      ['mayús  /  clic dcho', 'BARRIDO'],
      ['P', 'pausa'],
      ['M', 'silencio']
    ]
    filas.forEach(([k, v], i) => {
      const y = 260 + i * 26
      texto(ctx, k, W / 2 - 12, y, 11, FOSFORO, 'right', 600, 0.9)
      texto(ctx, v, W / 2 + 12, y, 11, FOSFORO, 'left', 400, 0.5)
    })

    const parpadeo = 0.35 + Math.abs(Math.sin(tr * 3.2)) * 0.65
    texto(ctx, 'PULSA PARA EMPEZAR', W / 2, 470, 14, ORO, 'center', 700, parpadeo)
    if (w.record > 0) {
      texto(ctx, `RÉCORD  ${num(w.record)}`, W / 2, 520, 11, FOSFORO, 'center', 500, 0.5)
    }
  }

  private pausa(): void {
    const ctx = this.tc
    this.velo(0.7)
    texto(ctx, 'PAUSA', W / 2, H / 2 - 6, 26, FOSFORO, 'center', 700)
    texto(ctx, 'P continuar   ·   Esc salir', W / 2, H / 2 + 22, 11, FOSFORO, 'center', 400, 0.55)
  }

  private fin(w: World, tr: number): void {
    const ctx = this.tc
    this.velo(0.82)
    texto(ctx, 'SEÑAL PERDIDA', W / 2, H / 2 - 78, 24, ROJO, 'center', 700)
    texto(ctx, num(w.puntos), W / 2, H / 2 - 26, 40, FOSFORO, 'center', 700)
    texto(
      ctx,
      `oleada ${w.oleada}   ·   ${w.bajas} ${w.bajas === 1 ? 'nave' : 'naves'}`,
      W / 2,
      H / 2 + 2,
      11,
      FOSFORO,
      'center',
      400,
      0.55
    )
    if (w.puntos > w.record) {
      const p = 0.5 + Math.abs(Math.sin(tr * 4)) * 0.5
      texto(ctx, '★  RÉCORD NUEVO  ★', W / 2, H / 2 + 38, 14, ORO, 'center', 700, p)
    } else if (w.record > 0) {
      texto(ctx, `récord ${num(w.record)}`, W / 2, H / 2 + 38, 11, FOSFORO, 'center', 400, 0.4)
    }
    texto(ctx, 'R otra partida   ·   Esc salir', W / 2, H / 2 + 92, 12, FOSFORO, 'center', 500, 0.72)
  }

  // --- Composicion ----------------------------------------------------------

  /** Copia del tubo teñida de un color, para las franjas de aberracion. */
  private tenir(color: string): HTMLCanvasElement {
    if (!this.tinte) {
      this.tinte = document.createElement('canvas')
      this.tinte.width = W
      this.tinte.height = H
    }
    const c = this.tinte.getContext('2d')
    if (!c) return this.tubo
    c.globalCompositeOperation = 'source-over'
    c.clearRect(0, 0, W, H)
    c.drawImage(this.tubo, 0, 0)
    c.globalCompositeOperation = 'multiply'
    c.fillStyle = color
    c.fillRect(0, 0, W, H)
    c.globalCompositeOperation = 'source-over'
    return this.tinte
  }

  private componer(w: World): void {
    const ctx = this.ctx
    const cw = this.vista.width
    const ch = this.vista.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#060607'
    ctx.fillRect(0, 0, cw, ch)

    // Sacudida: en pixeles del tubo, escalados al lienzo visible.
    const k = cw / W
    let sx = 0
    let sy = 0
    if (w.shake > 0) {
      const f = w.shakeF * Math.min(1, w.shake * 3) * k
      sx = (Math.random() - 0.5) * f
      sy = (Math.random() - 0.5) * f
    }

    // Desenganche vertical: la imagen rueda y se ve la costura, como cuando un
    // CRT pierde el enganche. El tubo se pinta dos veces desplazado.
    // El modulo sobre ch EXACTO importa: con roll=1 el desplazamiento vuelve a
    // 0 y la imagen encaja sola. Con cualquier otro factor se ve un salto justo
    // al terminar de rodar.
    const off = w.roll > 0 ? (w.roll * ch) % ch : 0

    const pintarTubo = (fuente: CanvasImageSource, dx: number, dy: number, alpha = 1): void => {
      ctx.globalAlpha = alpha
      ctx.drawImage(fuente, dx, dy, cw, ch)
      if (off > 0) ctx.drawImage(fuente, dx, dy - ch, cw, ch)
      ctx.globalAlpha = 1
    }

    pintarTubo(this.tubo, sx, sy + off)

    // Aberracion cromatica: dos copias teñidas, corridas en sentidos opuestos.
    // Solo cuando hace falta (impactos, jefe, barrido): es lo unico caro de aqui.
    if (w.aberr > 0.02) {
      const d = w.aberr * 3.2 * k
      ctx.globalCompositeOperation = 'screen'
      pintarTubo(this.tenir(ROJO), sx - d, sy + off, w.aberr * 0.75)
      pintarTubo(this.tenir(AZUL), sx + d, sy + off, w.aberr * 0.75)
      ctx.globalCompositeOperation = 'source-over'
    }

    if (off > 0) {
      // Costura del desenganche: la linea brillante del retorno.
      ctx.fillStyle = 'rgba(242,243,245,0.22)'
      ctx.fillRect(0, off - 2 * k, cw, 3 * k)
    }
  }

  /**
   * Un frame entero. `tr` es el reloj de DIBUJO (segundos desde que se abrio el
   * juego), no `w.t`: el del mundo solo corre mientras se juega, asi que atarle
   * los adornos dejaba la pantalla de titulo y la de fin congeladas — sin
   * parpadeo, sin estatica, sin nada.
   */
  pintar(w: World, tr: number): void {
    const ctx = this.tc
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    this.fondo(w, tr)
    this.chispas(w)
    this.powers(w)
    for (const e of w.enemigos) this.enemigo(e, tr)
    this.balas(w)
    if (w.fase !== 'fin') this.nave(w, tr)
    this.barrido(w)
    this.hud(w, tr)

    if (w.fase === 'titulo') this.titulo(w, tr)
    else if (w.fase === 'pausa') this.pausa()
    else if (w.fase === 'fin') this.fin(w, tr)

    // Defectos del propio tubo, encima de todo lo demas.
    if (this.rayas) {
      ctx.fillStyle = this.rayas
      ctx.fillRect(0, 0, W, H)
    }
    if (this.vinieta) {
      ctx.fillStyle = this.vinieta
      ctx.fillRect(0, 0, W, H)
    }

    this.componer(w)
  }

  /** Pasa un punto del lienzo visible a coordenadas del tubo. */
  aLogico(clientX: number): number {
    const r = this.vista.getBoundingClientRect()
    if (r.width === 0) return W / 2
    return ((clientX - r.left) / r.width) * W
  }
}
