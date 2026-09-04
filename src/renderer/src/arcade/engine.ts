/**
 * El motor de INTERFERENCIA: un `paso(mundo, dt, input)` y nada mas.
 *
 * Reglas que se respetan a rajatabla aqui dentro:
 *  - NO se toca el DOM, ni el canvas, ni `window`. Solo se muta el World.
 *  - El tiempo entra por `dt` (segundos). Nunca se lee el reloj: asi la partida
 *    va igual a 60 que a 144 Hz y se puede pausar de verdad.
 *  - El sonido y el fin de partida salen por `fx`, un puñado de callbacks. El
 *    motor no sabe si hay altavoces ni quien guarda el record.
 */

import {
  BARRIDO_DUR,
  CARGA_POR_MUERTE,
  CARGA_POR_OLEADA,
  COMBOS,
  H,
  INVULN,
  NAVE_R,
  NAVE_VEL,
  NAVE_Y,
  RACHA_PASO,
  W,
  type Arma,
  type Bullet,
  type Enemy,
  type Input,
  type Power,
  type PowerKind,
  type World
} from './types'
import {
  LINEA_MUERTE,
  cadenciaFuego,
  cadenciaPicada,
  componerOleada,
  crearCria,
  derivaFormacion,
  esOleadaJefe,
  ranuraX,
  ranuraY,
  reiniciarIds,
  velFormacion
} from './waves'

export type Sonido =
  | 'disparo'
  | 'boom'
  | 'boomGrande'
  | 'power'
  | 'dano'
  | 'escudo'
  | 'barrido'
  | 'oleada'
  | 'rebote'
  | 'jefe'

/** La unica salida del motor al mundo exterior. */
export interface Fx {
  sonido: (s: Sonido) => void
  /** La partida termino. Llega una sola vez por partida. */
  fin: (puntos: number, oleada: number) => void
}

// --- Utilidades -------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Bezier cubica en una dimension (las trayectorias de entrada y de picada). */
function bez3(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
}

function tocan(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx
  const dy = ay - by
  const r = ar + br
  return dx * dx + dy * dy <= r * r
}

const GRADO = Math.PI / 180

const ROMANO = ['', 'I', 'II', 'III']

const NOMBRE_ARMA: Record<Arma, string> = {
  simple: 'BÁSICA',
  doble: 'DOBLE',
  abanico: 'ABANICO',
  rafaga: 'RÁFAGA',
  perforante: 'PERFORANTE'
}

// --- Construccion -----------------------------------------------------------

export function crearMundo(record: number): World {
  reiniciarIds()
  return {
    fase: 'titulo',
    t: 0,
    nave: {
      x: W / 2,
      vx: 0,
      vidas: 3,
      inv: 0,
      arma: 'simple',
      nivel: 1,
      escudo: 0,
      iman: 0,
      recarga: 0,
      carga: 0
    },
    enemigos: [],
    balas: [],
    balasEnemigas: [],
    powers: [],
    chispas: [],
    oleada: 1,
    racha: 0,
    combo: 0,
    puntos: 0,
    porAparecer: [],
    entradaEn: 0,
    descanso: 1.4,
    picadaEn: 3,
    formX: 0,
    formDir: 1,
    formY: 0,
    barrido: 0,
    shake: 0,
    shakeF: 0,
    aberr: 0,
    roll: 0,
    rollEn: 34 + Math.random() * 26,
    cartel: '',
    cartelT: 0,
    record,
    bajas: 0
  }
}

/** Del titulo al juego (lo dispara el primer clic o tecla del jugador). */
export function empezar(w: World, fx: Fx): void {
  if (w.fase !== 'titulo') return
  w.fase = 'jugando'
  rotulo(w, 'OLEADA 1', 1.6)
  fx.sonido('oleada')
}

function rotulo(w: World, texto: string, seg = 1.3): void {
  w.cartel = texto
  w.cartelT = seg
}

function sacudir(w: World, fuerza: number, seg: number): void {
  // Se queda con la sacudida mas fuerte en marcha: dos explosiones seguidas no
  // suman hasta marear.
  if (fuerza >= w.shakeF) w.shakeF = fuerza
  w.shake = Math.max(w.shake, seg)
}

function chispazo(w: World, x: number, y: number, n: number, fuerza: number): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const v = fuerza * (0.35 + Math.random() * 0.9)
    const vida = 0.25 + Math.random() * 0.5
    w.chispas.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      vida,
      vidaMax: vida,
      r: 0.8 + Math.random() * 1.6
    })
  }
  // Tope duro: las chispas son adorno, jamas deben poder ahogar el frame.
  if (w.chispas.length > 420) w.chispas.splice(0, w.chispas.length - 420)
}

// --- La nave ----------------------------------------------------------------

/** Cadencia (s entre disparos) del arma actual. */
function cadencia(arma: Arma, nivel: number): number {
  switch (arma) {
    case 'simple':
      return 0.19
    case 'doble':
      return 0.185 - (nivel - 1) * 0.015
    case 'abanico':
      return 0.27 - (nivel - 1) * 0.02
    case 'rafaga':
      return 0.078 - (nivel - 1) * 0.014
    case 'perforante':
      return 0.46 - (nivel - 1) * 0.06
  }
}

function bala(
  x: number,
  y: number,
  ang: number,
  vel: number,
  dano: number,
  perfora: boolean,
  largo: number
): Bullet {
  return {
    x,
    y,
    vx: Math.sin(ang) * vel,
    vy: -Math.cos(ang) * vel,
    dano,
    r: perfora ? 5 : 3,
    perfora,
    tocados: perfora ? new Set<number>() : null,
    largo,
    vivo: true
  }
}

function disparar(w: World, fx: Fx): void {
  const n = w.nave
  const y = NAVE_Y - 14
  const lv = n.nivel

  switch (n.arma) {
    case 'simple':
      w.balas.push(bala(n.x, y, 0, 660, 1, false, 13))
      break

    case 'doble': {
      // I: dos canones. II: mas separados. III: una tercera columna al centro.
      const sep = 6 + lv * 2
      w.balas.push(bala(n.x - sep, y, 0, 690, 1, false, 13))
      w.balas.push(bala(n.x + sep, y, 0, 690, 1, false, 13))
      if (lv >= 3) w.balas.push(bala(n.x, y - 6, 0, 690, 1, false, 13))
      break
    }

    case 'abanico': {
      // I: 3 tiros. II: 5. III: 7, y mas abiertos.
      const cuantos = 1 + lv * 2
      const paso = (10 + lv * 3) * GRADO
      const base = -((cuantos - 1) / 2) * paso
      for (let i = 0; i < cuantos; i++) {
        w.balas.push(bala(n.x, y, base + i * paso, 560, 1, false, 12))
      }
      break
    }

    case 'rafaga': {
      // Alterna canon izquierdo/derecho: la rafaga se ve trenzada.
      const lado = Math.floor(w.t * 24) % 2 === 0 ? -1 : 1
      w.balas.push(bala(n.x + lado * 5, y, lado * 1.5 * GRADO, 780, 1, false, 16))
      if (lv >= 3) w.balas.push(bala(n.x - lado * 5, y, -lado * 1.5 * GRADO, 780, 1, false, 16))
      break
    }

    case 'perforante': {
      // Barra lenta y gorda que atraviesa la columna entera.
      const dano = 2 + lv
      w.balas.push(bala(n.x, y, 0, 430 + lv * 40, dano, true, 26 + lv * 6))
      if (lv >= 3) {
        w.balas.push(bala(n.x - 13, y + 4, 0, 430, dano, true, 22))
        w.balas.push(bala(n.x + 13, y + 4, 0, 430, dano, true, 22))
      }
      break
    }
  }
  fx.sonido('disparo')
}

function pasoNave(w: World, dt: number, input: Input, fx: Fx): void {
  const n = w.nave

  // El raton manda si se ha movido hace poco (lo decide input.ts); si no, el
  // teclado. Se persigue el puntero con un muelle acotado a NAVE_VEL: ni el
  // raton teletransporta la nave ni el teclado se siente pastoso.
  if (input.raton !== null) {
    n.vx = clamp((input.raton - n.x) * 15, -NAVE_VEL, NAVE_VEL)
  } else {
    n.vx = input.eje * NAVE_VEL
  }
  n.x = clamp(n.x + n.vx * dt, 14, W - 14)

  if (n.inv > 0) n.inv = Math.max(0, n.inv - dt)
  if (n.iman > 0) n.iman = Math.max(0, n.iman - dt)

  n.recarga -= dt
  if (input.fuego && n.recarga <= 0) {
    disparar(w, fx)
    n.recarga = cadencia(n.arma, n.nivel)
  }
}

// --- Dano al jugador --------------------------------------------------------

function golpear(w: World, fx: Fx): void {
  const n = w.nave
  if (n.inv > 0 || w.barrido > 0 || w.fase !== 'jugando') return

  if (n.escudo > 0) {
    n.escudo--
    n.inv = 0.9
    w.aberr = Math.max(w.aberr, 0.5)
    sacudir(w, 5, 0.18)
    fx.sonido('escudo')
    rotulo(w, 'ESCUDO ROTO', 0.9)
    return
  }

  n.vidas--
  n.inv = INVULN
  w.bajas++
  // El combo es lo primero que se paga: mantenerlo intacto es TODO el juego.
  w.combo = 0
  w.racha = 0
  // Y el arma baja un escalon: perder duele, pero no te desnuda.
  if (n.nivel > 1) n.nivel--
  else n.arma = 'simple'

  chispazo(w, n.x, NAVE_Y, 26, 190)
  sacudir(w, 13, 0.4)
  w.aberr = 1
  fx.sonido('dano')

  if (n.vidas <= 0) {
    w.fase = 'fin'
    fx.fin(w.puntos, w.oleada)
  }
}

// --- Muerte de un enemigo ---------------------------------------------------

const TABLA_POWERS: { kind: PowerKind; peso: number }[] = [
  { kind: 'doble', peso: 22 },
  { kind: 'rafaga', peso: 18 },
  { kind: 'abanico', peso: 18 },
  { kind: 'perforante', peso: 12 },
  { kind: 'escudo', peso: 14 },
  { kind: 'iman', peso: 8 },
  { kind: 'vida', peso: 8 }
]

function powerAlAzar(): PowerKind {
  const total = TABLA_POWERS.reduce((a, p) => a + p.peso, 0)
  let r = Math.random() * total
  for (const p of TABLA_POWERS) {
    r -= p.peso
    if (r <= 0) return p.kind
  }
  return 'doble'
}

function soltarPower(w: World, x: number, y: number, kind = powerAlAzar()): void {
  w.powers.push({ kind, x, y, vx: (Math.random() - 0.5) * 26, vy: 74, t: 0, vivo: true })
}

/** Probabilidad de que un tipo suelte algo al morir. */
function sueltaAlgo(e: Enemy): boolean {
  if (e.kind === 'blindado') return Math.random() < 0.55
  if (e.kind === 'espejo') return Math.random() < 0.5
  if (e.kind === 'parasito') return Math.random() < 0.22
  if (e.kind === 'cria') return false
  return Math.random() < 0.13
}

function matar(w: World, e: Enemy, fx: Fx): void {
  // Picar es arriesgado para ellos: cazar a uno en picada vale el doble.
  const bonus = e.estado === 'picada' ? 2 : 1
  w.puntos += e.valor * bonus * COMBOS[w.combo]

  w.racha++
  if (w.racha % RACHA_PASO === 0 && w.combo < COMBOS.length - 1) {
    w.combo++
    rotulo(w, `COMBO x${COMBOS[w.combo]}`, 1.1)
  }
  w.nave.carga = Math.min(1, w.nave.carga + CARGA_POR_MUERTE)

  if (e.kind === 'jefe') {
    chispazo(w, e.x, e.y, 90, 300)
    sacudir(w, 18, 0.8)
    w.aberr = 1
    fx.sonido('boomGrande')
    // El jefe siempre paga: tres cosas buenas de golpe.
    soltarPower(w, e.x - 30, e.y, 'vida')
    soltarPower(w, e.x, e.y)
    soltarPower(w, e.x + 30, e.y, 'escudo')
    return
  }

  chispazo(w, e.x, e.y, e.kind === 'blindado' ? 22 : 12, e.kind === 'blindado' ? 170 : 130)
  sacudir(w, e.kind === 'blindado' ? 5 : 2.4, 0.14)
  fx.sonido('boom')
  if (e.kind === 'parasito') {
    w.enemigos.push(crearCria(e.x, e.y, -1, w.oleada))
    w.enemigos.push(crearCria(e.x, e.y, 1, w.oleada))
  }
  if (sueltaAlgo(e)) soltarPower(w, e.x, e.y)
}

function danar(w: World, e: Enemy, dano: number, fx: Fx): void {
  e.hp -= dano
  e.flash = 0.07
  if (e.hp <= 0) {
    e.hp = 0
    matar(w, e, fx)
  }
}

// --- Enemigos ---------------------------------------------------------------

function dispararEnemigo(w: World, e: Enemy, apuntado: boolean): void {
  const vel = 190 + w.oleada * 7
  if (!apuntado) {
    w.balasEnemigas.push({ x: e.x, y: e.y + e.r, vx: 0, vy: vel, r: 4, rebote: false, vivo: true })
    return
  }
  const dx = w.nave.x - e.x
  const dy = NAVE_Y - e.y
  const d = Math.hypot(dx, dy) || 1
  w.balasEnemigas.push({
    x: e.x,
    y: e.y + e.r,
    vx: (dx / d) * vel,
    vy: (dy / d) * vel,
    r: 4,
    rebote: false,
    vivo: true
  })
}

function pasoJefe(w: World, e: Enemy, dt: number, fx: Fx): void {
  // Baja a su sitio y a partir de ahi se pasea de lado a lado.
  if (e.y < 116) {
    e.y = Math.min(116, e.y + 46 * dt)
    return
  }
  e.x = W / 2 + Math.sin(e.t * 0.52) * 108
  // El nucleo respira: con el abierto (>0.35) los impactos valen el triple.
  e.nucleo = Math.max(0, Math.sin(e.t * 0.63)) ** 2

  e.patronT -= dt
  if (e.patronT > 0) return
  e.patron = (e.patron + 1) % 3
  e.patronT = Math.max(1.5, 3.4 - w.oleada * 0.09)

  switch (e.patron) {
    case 0: {
      // Abanico ancho de tiros lentos: obliga a moverse, no a esconderse.
      const vel = 130 + w.oleada * 4
      for (let i = -3; i <= 3; i++) {
        const a = i * 13 * GRADO
        w.balasEnemigas.push({
          x: e.x,
          y: e.y + 30,
          vx: Math.sin(a) * vel,
          vy: Math.cos(a) * vel,
          r: 4,
          rebote: false,
          vivo: true
        })
      }
      break
    }
    case 1:
      // Suelta crias por los costados.
      w.enemigos.push(crearCria(e.x - 40, e.y + 20, -1, w.oleada))
      w.enemigos.push(crearCria(e.x + 40, e.y + 20, 1, w.oleada))
      if (w.oleada >= 10) w.enemigos.push(crearCria(e.x, e.y + 30, 0, w.oleada))
      break
    default:
      // Rafaga apuntada: dos seguidos a donde estas AHORA.
      dispararEnemigo(w, e, true)
      dispararEnemigo(w, e, true)
      break
  }
  fx.sonido('jefe')
}

function pasoEnemigos(w: World, dt: number, fx: Fx): void {
  const n = w.oleada

  // Deriva de la formacion: va y viene entre los margenes mientras baja.
  w.formX += derivaFormacion(n) * w.formDir * dt
  if (w.formX > 26) {
    w.formX = 26
    w.formDir = -1
  } else if (w.formX < -26) {
    w.formX = -26
    w.formDir = 1
  }
  w.formY += velFormacion(n) * dt

  for (const e of w.enemigos) {
    e.t += dt
    if (e.flash > 0) e.flash = Math.max(0, e.flash - dt)

    if (e.kind === 'jefe') {
      pasoJefe(w, e, dt, fx)
      continue
    }

    if (e.kind === 'espejo') e.escudo += dt * 1.75

    switch (e.estado) {
      case 'entrando': {
        // Se descuelga por un lado y entra en su ranura con una curva amplia.
        e.p += dt / 1.05
        const sx = ranuraX(e.col) + w.formX
        const sy = ranuraY(e.fil) + w.formY
        const t = Math.min(1, e.p)
        e.x = bez3(e.ax, e.ax + (sx - e.ax) * 0.45, sx, sx, t)
        e.y = bez3(e.ay, e.ay + 210, sy + 90, sy, t)
        if (e.p >= 1) {
          e.estado = 'formacion'
          e.x = sx
          e.y = sy
        }
        break
      }

      case 'formacion': {
        // Quieto en su ranura, respirando con su propio desfase.
        e.x = ranuraX(e.col) + w.formX + Math.sin(w.t * 1.35 + e.fase) * 3
        e.y = ranuraY(e.fil) + w.formY + Math.sin(w.t * 2.1 + e.fase) * 2
        e.fuegoEn -= dt
        if (e.fuegoEn <= 0) {
          e.fuegoEn = cadenciaFuego(n)
          if (e.kind === 'blindado') {
            // El blindado no apunta: suelta una rafaga corta hacia abajo.
            dispararEnemigo(w, e, false)
            dispararEnemigo(w, e, Math.random() < 0.5)
          } else if (e.kind !== 'espejo' && Math.random() < 0.55) {
            dispararEnemigo(w, e, n >= 4 && Math.random() < 0.5)
          }
        }
        break
      }

      case 'picada': {
        // Curva en S hasta salirse por abajo. Al terminar vuelve a entrar por
        // arriba y regresa a su ranura: la formacion nunca se vacia sola.
        e.p += dt / 1.9
        const t = Math.min(1, e.p)
        e.x = bez3(e.ax, e.ax + e.swing, e.tx - e.swing * 0.6, e.tx, t)
        e.y = bez3(e.ay, e.ay + 130, H * 0.62, H + 70, t)
        e.fuegoEn -= dt
        if (e.fuegoEn <= 0 && t < 0.7) {
          e.fuegoEn = 0.55
          dispararEnemigo(w, e, false)
        }
        if (e.p >= 1) {
          e.estado = 'entrando'
          e.p = 0
          e.ax = 40 + Math.random() * (W - 80)
          e.ay = -40
        }
        break
      }

      default: {
        // 'libre': crias y rezagados. Bajan persiguiendo tu columna.
        e.vx = clamp(e.vx + clamp(w.nave.x - e.x, -1, 1) * 55 * dt, -130, 130)
        e.x += e.vx * dt
        e.y += e.vy * dt
        break
      }
    }
  }

  // Alguien se descuelga a picar cada cierto tiempo. Nunca los blindados ni los
  // espejos: esos son artilleria fija y la formacion tiene que sostenerse.
  w.picadaEn -= dt
  if (w.picadaEn <= 0) {
    w.picadaEn = cadenciaPicada(n)
    const candidatos = w.enemigos.filter(
      (e) => e.estado === 'formacion' && (e.kind === 'zumbador' || (n >= 5 && e.kind === 'ruido'))
    )
    const e = candidatos[Math.floor(Math.random() * candidatos.length)]
    if (e) {
      e.estado = 'picada'
      e.p = 0
      e.ax = e.x
      e.ay = e.y
      e.swing = e.x < W / 2 ? 130 : -130
      e.tx = clamp(w.nave.x + (Math.random() - 0.5) * 90, 30, W - 30)
      e.fuegoEn = 0.35
    }
  }

  // Los que se han ido por abajo se retiran (los muertos, al final del paso).
  w.enemigos = w.enemigos.filter((e) => e.y < H + 90)

  // Si la formacion llega a la linea te la cobras con una vida y la empujamos
  // arriba otra vez. En un arcade sin final, morir de golpe aqui seria injusto.
  if (w.formY + ranuraY(0) > LINEA_MUERTE && w.enemigos.some((e) => e.estado === 'formacion')) {
    w.formY -= 150
    golpear(w, fx)
    rotulo(w, 'TE DESBORDAN', 1.2)
  }
}

// --- Proyectiles ------------------------------------------------------------

function pasoBalas(w: World, dt: number, fx: Fx): void {
  for (const b of w.balas) {
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (b.y < -30 || b.x < -20 || b.x > W + 20) b.vivo = false
  }

  for (const b of w.balas) {
    if (!b.vivo) continue
    for (const e of w.enemigos) {
      if (e.hp <= 0) continue
      if (b.tocados?.has(e.id)) continue
      if (!tocan(b.x, b.y, b.r, e.x, e.y, e.r)) continue

      // El espejo devuelve lo que le llega por el arco del escudo. Hay que
      // esperar (o rodear) al hueco: dispararle a lo tonto te come a ti.
      if (e.kind === 'espejo' && !b.perfora) {
        const ang = Math.atan2(b.y - e.y, b.x - e.x)
        let d = ang - e.escudo
        while (d > Math.PI) d -= Math.PI * 2
        while (d < -Math.PI) d += Math.PI * 2
        if (Math.abs(d) < 0.95) {
          b.vivo = false
          w.balasEnemigas.push({
            x: e.x + Math.cos(ang) * (e.r + 5),
            y: e.y + Math.sin(ang) * (e.r + 5),
            vx: -b.vx * 0.5,
            vy: -b.vy * 0.5,
            r: 4,
            rebote: true,
            vivo: true
          })
          e.flash = 0.05
          fx.sonido('rebote')
          break
        }
      }

      // El nucleo abierto del jefe es su punto debil: x3 de dano.
      const critico = e.kind === 'jefe' && e.nucleo > 0.35 && Math.abs(b.x - e.x) < 22
      danar(w, e, b.dano * (critico ? 3 : 1), fx)
      chispazo(w, b.x, b.y, critico ? 6 : 2, critico ? 130 : 70)

      if (b.perfora) b.tocados?.add(e.id)
      else {
        b.vivo = false
        break
      }
    }
  }

  w.balas = w.balas.filter((b) => b.vivo)
}

function pasoBalasEnemigas(w: World, dt: number, fx: Fx): void {
  for (const b of w.balasEnemigas) {
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (b.y > H + 20 || b.y < -20 || b.x < -20 || b.x > W + 20) b.vivo = false
    else if (w.nave.inv <= 0 && tocan(b.x, b.y, b.r, w.nave.x, NAVE_Y, NAVE_R)) {
      b.vivo = false
      golpear(w, fx)
    }
  }
  w.balasEnemigas = w.balasEnemigas.filter((b) => b.vivo)
}

// --- Potenciadores ----------------------------------------------------------

function recoger(w: World, p: Power, fx: Fx): void {
  const n = w.nave
  fx.sonido('power')
  switch (p.kind) {
    case 'vida':
      n.vidas = Math.min(6, n.vidas + 1)
      rotulo(w, '+1 VIDA')
      break
    case 'escudo':
      n.escudo = Math.min(2, n.escudo + 1)
      rotulo(w, 'ESCUDO')
      break
    case 'iman':
      n.iman = Math.min(20, n.iman + 12)
      rotulo(w, 'IMÁN')
      break
    default:
      // Misma arma = sube de nivel. Otra = se cambia y empieza en I.
      if (n.arma === p.kind) n.nivel = Math.min(3, n.nivel + 1)
      else {
        n.arma = p.kind
        n.nivel = 1
      }
      rotulo(w, `${NOMBRE_ARMA[n.arma]} ${ROMANO[n.nivel]}`)
      break
  }
}

function pasoPowers(w: World, dt: number, fx: Fx): void {
  const n = w.nave
  for (const p of w.powers) {
    p.t += dt
    if (n.iman > 0) {
      // El iman los atrae a la nave con fuerza constante, vengan de donde vengan.
      const dx = n.x - p.x
      const dy = NAVE_Y - p.y
      const d = Math.hypot(dx, dy) || 1
      p.vx = clamp(p.vx + (dx / d) * 520 * dt, -340, 340)
      p.vy = clamp(p.vy + (dy / d) * 520 * dt, -340, 340)
    } else {
      p.vx *= 1 - dt * 0.6
      p.vy += 26 * dt
    }
    p.x += p.vx * dt
    p.y += p.vy * dt
    if (p.x < 10 || p.x > W - 10) p.vx *= -1
    if (p.y > H + 20) p.vivo = false
    else if (tocan(p.x, p.y, 11, n.x, NAVE_Y, NAVE_R + 6)) {
      p.vivo = false
      recoger(w, p, fx)
    }
  }
  w.powers = w.powers.filter((p) => p.vivo)
}

// --- Chispas ----------------------------------------------------------------

function pasoChispas(w: World, dt: number): void {
  for (const c of w.chispas) {
    c.x += c.vx * dt
    c.y += c.vy * dt
    c.vx *= 1 - dt * 1.9
    c.vy = c.vy * (1 - dt * 1.9) + 60 * dt
    c.vida -= dt
  }
  w.chispas = w.chispas.filter((c) => c.vida > 0)
}

// --- BARRIDO (el superpoder) ------------------------------------------------

/** Altura de la linea de retrazado para un cronometro dado (baja -> arriba). */
export function lineaBarrido(restante: number): number {
  return -30 + (restante / BARRIDO_DUR) * (H + 40)
}

function pasoBarrido(w: World, dt: number, input: Input, fx: Fx): void {
  if (input.barrido && w.barrido <= 0 && w.nave.carga >= 1) {
    w.barrido = BARRIDO_DUR
    w.nave.carga = 0
    w.aberr = 1
    sacudir(w, 10, BARRIDO_DUR)
    rotulo(w, 'BARRIDO', 1)
    fx.sonido('barrido')
  }
  if (w.barrido <= 0) return

  const abajo = lineaBarrido(w.barrido)
  w.barrido = Math.max(0, w.barrido - dt)
  const arriba = lineaBarrido(w.barrido)

  // Todo lo que la linea cruza en este frame se vaporiza. Al jefe solo le
  // arranca un mordisco: seria un anticlimax matarlo con un boton.
  for (const e of w.enemigos) {
    if (e.hp <= 0 || e.y < arriba || e.y > abajo) continue
    danar(w, e, e.kind === 'jefe' ? 14 : 999, fx)
  }
  for (const b of w.balasEnemigas) {
    if (b.y >= arriba && b.y <= abajo) b.vivo = false
  }
  chispazo(w, Math.random() * W, arriba, 3, 60)
}

// --- Oleadas ----------------------------------------------------------------

function cerrarOleada(w: World, fx: Fx): void {
  w.oleada++
  w.nave.carga = Math.min(1, w.nave.carga + CARGA_POR_OLEADA)
  w.descanso = 2
  rotulo(w, esOleadaJefe(w.oleada) ? '◆ SEÑAL CORRUPTA ◆' : `OLEADA ${w.oleada}`, 1.8)
  fx.sonido('oleada')
}

function pasoOleada(w: World, dt: number): void {
  // Cola de entrada: los enemigos aparecen de uno en uno, no de golpe.
  if (w.porAparecer.length > 0) {
    w.entradaEn -= dt
    if (w.entradaEn <= 0) {
      const e = w.porAparecer.shift()
      if (e) w.enemigos.push(e)
      w.entradaEn = 0.13
    }
    return
  }
  if (w.enemigos.length > 0) return

  // Tubo vacio: descanso corto (con cartel) y a por la siguiente.
  if (w.descanso > 0) {
    w.descanso -= dt
    return
  }
  w.porAparecer = componerOleada(w.oleada)
  w.formX = 0
  w.formY = 0
  w.formDir = 1
  w.entradaEn = 0.2
  w.picadaEn = 3.2
}

// --- El paso ----------------------------------------------------------------

export function paso(w: World, dt: number, input: Input, fx: Fx): void {
  if (w.fase !== 'jugando') return

  // Un dt gigante (la ventana estuvo de fondo, o el portatil durmio) rompe
  // cualquier motor por integracion: se acota antes de tocar nada.
  const d = Math.min(dt, 1 / 30)
  w.t += d

  const habia = w.enemigos.length + w.porAparecer.length

  pasoNave(w, d, input, fx)
  pasoBarrido(w, d, input, fx)
  pasoEnemigos(w, d, fx)
  pasoBalas(w, d, fx)
  pasoBalasEnemigas(w, d, fx)
  pasoPowers(w, d, fx)
  pasoChispas(w, d)

  // Choque cuerpo a cuerpo: bajar hasta ti tambien es un ataque.
  if (w.nave.inv <= 0 && w.barrido <= 0) {
    for (const e of w.enemigos) {
      if (e.hp > 0 && tocan(e.x, e.y, e.r * 0.85, w.nave.x, NAVE_Y, NAVE_R)) {
        if (e.kind !== 'jefe') danar(w, e, 999, fx)
        golpear(w, fx)
        break
      }
    }
  }

  // Los cadaveres salen aqui, despues de TODAS las colisiones: asi la oleada se
  // cierra en el mismo frame de la ultima explosion y el cartel entra pegado.
  w.enemigos = w.enemigos.filter((e) => e.hp > 0)
  if (habia > 0 && w.enemigos.length + w.porAparecer.length === 0 && w.fase === 'jugando') {
    cerrarOleada(w, fx)
  }
  pasoOleada(w, d)

  // Adornos que se apagan solos.
  if (w.shake > 0) {
    w.shake = Math.max(0, w.shake - d)
    if (w.shake === 0) w.shakeF = 0
  }
  if (w.aberr > 0) w.aberr = Math.max(0, w.aberr - d * 2.4)
  if (w.cartelT > 0) w.cartelT = Math.max(0, w.cartelT - d)

  // Desenganche vertical: cada tanto el tubo pierde el enganche y la imagen
  // rueda una vez. Es PURO adorno — no mueve ni una colision — pero es lo que
  // hace que esto parezca un monitor viejo y no un canvas.
  if (w.roll > 0) {
    w.roll += d / 0.75
    if (w.roll >= 1) {
      w.roll = 0
      w.rollEn = 34 + Math.random() * 30
    }
  } else {
    w.rollEn -= d
    if (w.rollEn <= 0) w.roll = 0.0001
  }
}

/** Pausa / reanuda (no hace nada en el titulo ni con la partida terminada). */
export function alternarPausa(w: World): void {
  if (w.fase === 'jugando') w.fase = 'pausa'
  else if (w.fase === 'pausa') w.fase = 'jugando'
}

/** Nombre legible del arma actual, para el HUD. */
export function armaHud(w: World): string {
  return w.nave.arma === 'simple'
    ? NOMBRE_ARMA.simple
    : `${NOMBRE_ARMA[w.nave.arma]} ${ROMANO[w.nave.nivel]}`
}
