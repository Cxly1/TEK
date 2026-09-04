/**
 * De que esta hecha cada oleada. Aqui vive TODA la curva de dificultad, para
 * poder afinarla sin abrir el motor: que tipos aparecen, cuantos, con cuanta
 * vida y cada cuanto disparan.
 *
 * La progresion no tiene techo: a partir de la oleada 8 la composicion se repite
 * con los numeros escalados, asi que se puede jugar hasta que te canses.
 */

import { H, W, type Enemy, type EnemyKind } from './types'

/** Rejilla de la formacion: 6 columnas por 4 filas como mucho. */
export const COLS = 6
export const FILAS = 4

/** Centro de la ranura (col, fil) de la formacion, sin contar su deriva. */
export function ranuraX(col: number): number {
  return W / 2 + (col - (COLS - 1) / 2) * 58
}
export function ranuraY(fil: number): number {
  return 96 + fil * 46
}

let siguienteId = 1

/** Reinicia los identificadores (partida nueva = numeracion limpia). */
export function reiniciarIds(): void {
  siguienteId = 1
}

/** Cada 5 oleadas manda un jefe y nadie mas. */
export function esOleadaJefe(n: number): boolean {
  return n % 5 === 0
}

/** Factor global de velocidad/agresividad. Crece rapido al principio y se aplana. */
function escala(n: number): number {
  return Math.min(2.3, 1 + (n - 1) * 0.062)
}

/** Vida de cada tipo, ya escalada por oleada. */
function vidaDe(kind: EnemyKind, n: number): number {
  switch (kind) {
    case 'ruido':
      return 1
    case 'zumbador':
      return 1
    case 'cria':
      return 1
    case 'parasito':
      return 2
    case 'espejo':
      return 2 + Math.floor(n / 8)
    case 'blindado':
      return 3 + Math.floor(n / 6)
    case 'jefe':
      return 42 + n * 13
  }
}

/** Puntos base. El combo los multiplica despues. */
function valorDe(kind: EnemyKind): number {
  switch (kind) {
    case 'ruido':
      return 100
    case 'zumbador':
      return 150
    case 'cria':
      return 60
    case 'parasito':
      return 220
    case 'espejo':
      return 360
    case 'blindado':
      return 420
    case 'jefe':
      return 5000
  }
}

/** Radio de colision por tipo. */
function radioDe(kind: EnemyKind): number {
  switch (kind) {
    case 'cria':
      return 7
    case 'blindado':
      return 15
    case 'espejo':
      return 14
    case 'jefe':
      return 46
    default:
      return 12
  }
}

/**
 * Crea un enemigo listo para entrar. `entrada` decide por que esquina de arriba
 * se descuelga: las oleadas alternan lados para que el barrido de entrada se lea
 * como una coreografia y no como un goteo.
 */
export function crearEnemigo(
  kind: EnemyKind,
  col: number,
  fil: number,
  n: number,
  entrada: 'izq' | 'der' | 'alto'
): Enemy {
  const s = escala(n)
  const hp = vidaDe(kind, n)
  const ax = entrada === 'izq' ? -50 : entrada === 'der' ? W + 50 : ranuraX(col)
  const ay = entrada === 'alto' ? -60 : -30 - fil * 18
  return {
    id: siguienteId++,
    kind,
    x: ax,
    y: ay,
    vx: 0,
    vy: 0,
    hp,
    maxHp: hp,
    r: radioDe(kind),
    t: 0,
    fase: Math.random() * Math.PI * 2,
    col,
    fil,
    estado: kind === 'jefe' ? 'libre' : 'entrando',
    p: 0,
    ax,
    ay,
    tx: ranuraX(col),
    swing: 0,
    // Los que disparan empiezan con la recarga a medias, escalonada, para que la
    // primera andanada no salga toda a la vez.
    fuegoEn: (2.6 + Math.random() * 3.4) / s,
    flash: 0,
    escudo: Math.random() * Math.PI * 2,
    valor: valorDe(kind),
    patron: 0,
    patronT: 2,
    nucleo: 0
  }
}

/** Cria que suelta el parasito al reventar: sale disparada desde donde murio. */
export function crearCria(x: number, y: number, dir: number, n: number): Enemy {
  const e = crearEnemigo('cria', 0, 0, n, 'alto')
  e.x = x
  e.y = y
  e.estado = 'libre'
  e.vx = dir * (60 + Math.random() * 40)
  e.vy = 120 + escala(n) * 40
  return e
}

/**
 * Que tipo va en cada ranura. Los duros ocupan la fila de atras (arriba) y los
 * peones la de delante: asi la formacion se lee de un vistazo y las picadas
 * salen siempre de la primera linea, que es lo que se espera de un arcade.
 */
function tipoPara(fil: number, filas: number, n: number): EnemyKind {
  const atras = fil === 0
  const delante = fil === filas - 1
  const r = Math.random()

  if (atras && n >= 4 && r < 0.34) return 'blindado'
  if (atras && n >= 7 && r < 0.55) return 'espejo'
  if (!delante && n >= 3 && r < 0.3) return 'parasito'
  if (delante && n >= 2 && r < 0.45) return 'zumbador'
  if (n >= 2 && r < 0.2) return 'zumbador'
  return 'ruido'
}

/**
 * La oleada entera, en orden de aparicion. Devolver la lista (en vez de ir
 * creando enemigos sobre la marcha) deja al motor con una sola regla: soltar uno
 * cada cierto tiempo hasta vaciar la cola.
 */
export function componerOleada(n: number): Enemy[] {
  if (esOleadaJefe(n)) {
    const jefe = crearEnemigo('jefe', 0, 0, n, 'alto')
    jefe.x = W / 2
    jefe.y = -60
    jefe.ax = W / 2
    jefe.ay = -60
    return [jefe]
  }

  const total = Math.min(COLS * FILAS, 11 + n * 2)
  const filas = Math.min(FILAS, Math.ceil(total / COLS))
  const out: Enemy[] = []
  let puestos = 0

  // Se rellena de atras hacia delante y en zig-zag por filas: la entrada dibuja
  // una S en el tubo en vez de un goteo por la misma esquina.
  for (let fil = 0; fil < filas && puestos < total; fil++) {
    const izqPrimero = fil % 2 === 0
    for (let i = 0; i < COLS && puestos < total; i++) {
      const col = izqPrimero ? i : COLS - 1 - i
      const kind = tipoPara(fil, filas, n)
      out.push(crearEnemigo(kind, col, fil, n, izqPrimero ? 'izq' : 'der'))
      puestos++
    }
  }
  return out
}

/** Cada cuanto (s) se descuelga alguien a picar. Se acorta con las oleadas. */
export function cadenciaPicada(n: number): number {
  return Math.max(0.85, 3.4 - n * 0.13) * (0.7 + Math.random() * 0.6)
}

/** Cada cuanto (s) vuelve a disparar un enemigo de tierra. */
export function cadenciaFuego(n: number): number {
  return Math.max(0.9, 3.6 - n * 0.12) * (0.6 + Math.random() * 0.9)
}

/** Velocidad de bajada de la formacion (px/s). */
export function velFormacion(n: number): number {
  return 2.6 + n * 0.5
}

/** Deriva horizontal de la formacion (px/s). */
export function derivaFormacion(n: number): number {
  return 16 + n * 2.2
}

/** Hasta donde puede bajar la formacion antes de que se acabe la partida. */
export const LINEA_MUERTE = H - 96
