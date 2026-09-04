/**
 * INTERFERENCIA — el arcade que vive dentro del tubo de TEK.
 *
 * Ficcion: cuando la senal se corta, el tubo se llena de interferencia y de ella
 * bajan glifos. Tu eres el cursor de TEK (el "+" de Genesis) al fondo del tubo.
 *
 * Este archivo es SOLO datos: tipos, constantes y la forma del mundo. Nadie de
 * aqui toca el DOM ni el canvas, asi que el motor (engine.ts) se puede razonar y
 * probar entero sin navegador.
 */

/**
 * Resolucion LOGICA del tubo. Todo el juego piensa en estas coordenadas y el
 * render la escala al hueco que haya: la dificultad no depende del tamano de la
 * ventana (un bug clasico de los juegos en canvas que se adaptan).
 */
export const W = 420
export const H = 660

/** Linea de vuelo de la nave: fija cerca del fondo, como en un arcade vertical. */
export const NAVE_Y = H - 58

/** Radio de colision de la nave. MUY generoso a su favor: la mitad de lo que
 *  mide el dibujo. Un arcade se siente injusto en cuanto te matan roces que no
 *  parecian roces, y aqui hay balas cruzandose todo el rato. */
export const NAVE_R = 7

/** Velocidad maxima de la nave (px/s). Cruzar el tubo entero lleva ~0.8s: lo
 *  bastante rapido para esquivar, lo bastante lento para que quepa el error. */
export const NAVE_VEL = 520

/** Segundos de invulnerabilidad (parpadeo) tras recibir un impacto. */
export const INVULN = 1.6

/** Cuanto carga el BARRIDO cada muerte, y cuanto al limpiar una oleada. */
export const CARGA_POR_MUERTE = 0.035
export const CARGA_POR_OLEADA = 0.15

/** Duracion del BARRIDO (s): el retrazado sube del fondo a lo alto del tubo. */
export const BARRIDO_DUR = 0.55

/** Multiplicadores de combo. Sube uno cada RACHA_PASO muertes sin recibir dano. */
export const COMBOS = [1, 2, 4, 8] as const
export const RACHA_PASO = 8

/** Armas. La misma arma repetida SUBE de nivel (I..III); otra distinta la cambia. */
export type Arma = 'simple' | 'doble' | 'abanico' | 'rafaga' | 'perforante'

/** Lo que sueltan los enemigos al morir. */
export type PowerKind = Exclude<Arma, 'simple'> | 'escudo' | 'iman' | 'vida'

export type EnemyKind =
  /** Peon: baja en formacion oscilante. */
  | 'ruido'
  /** Se descuelga de la formacion y te cae encima trazando un arco. */
  | 'zumbador'
  /** Al morir se parte en dos crias rapidas. */
  | 'parasito'
  /** Cria del parasito: pequena, rapida, va a por ti en linea. */
  | 'cria'
  /** 3 golpes, no baja de la formacion, dispara rafagas. */
  | 'blindado'
  /** Escudo giratorio: de frente REBOTA tu disparo; hay que pegarle por el hueco. */
  | 'espejo'
  /** Jefe de oleada (cada 5): senal corrupta con nucleo que se abre y se cierra. */
  | 'jefe'

/** En que esta un enemigo. La formacion es el "cuerpo" de la oleada. */
export type EnemyState = 'entrando' | 'formacion' | 'picada' | 'libre'

export interface Enemy {
  id: number
  kind: EnemyKind
  x: number
  y: number
  vx: number
  vy: number
  hp: number
  maxHp: number
  /** Radio de colision. */
  r: number
  /** Edad en segundos (anima el dibujo y las oscilaciones). */
  t: number
  /** Desfase propio para que no respiren todos a la vez. */
  fase: number
  /** Ranura en la formacion (col, fil) -> posicion objetivo. */
  col: number
  fil: number
  estado: EnemyState
  /** Progreso 0..1 de la entrada o de la picada. */
  p: number
  /** Punto de origen de la trayectoria actual (entrada / picada). */
  ax: number
  ay: number
  /** X a la que apunta la picada, y desvio lateral de salida de la curva. */
  tx: number
  swing: number
  /** Cuenta atras hasta el siguiente disparo (s). */
  fuegoEn: number
  /** Fogonazo blanco al recibir un impacto (s restantes). */
  flash: number
  /** Angulo del escudo del espejo (rad). */
  escudo: number
  /** Puntos base (antes del combo). */
  valor: number
  /** Solo el jefe: fase de ataque actual y su cronometro. */
  patron: number
  patronT: number
  /** Solo el jefe: 0..1, cuanto esta abierto el nucleo (x3 de dano). */
  nucleo: number
}

export interface Bullet {
  x: number
  y: number
  vx: number
  vy: number
  /** Dano que hace al impactar. */
  dano: number
  /** Radio de colision. */
  r: number
  /** true = atraviesa a quien mata (arma perforante). */
  perfora: boolean
  /** Enemigos ya golpeados por este disparo perforante (no repite dano).
   *  null en los disparos normales, que mueren en el primer impacto. */
  tocados: Set<number> | null
  /** Largo del trazo al dibujarlo (el perforante es una barra). */
  largo: number
  vivo: boolean
}

export interface EnemyBullet {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  /** Un disparo REBOTADO por un espejo se dibuja distinto (viene de los tuyos). */
  rebote: boolean
  vivo: boolean
}

export interface Power {
  kind: PowerKind
  x: number
  y: number
  vx: number
  vy: number
  t: number
  vivo: boolean
}

/** Chispa de fosforo: se apaga sola, como el fosforo de verdad. */
export interface Chispa {
  x: number
  y: number
  vx: number
  vy: number
  /** Vida restante (s) y vida total, para calcular el desvanecido. */
  vida: number
  vidaMax: number
  /** Grosor del punto. */
  r: number
}

export interface Nave {
  x: number
  vx: number
  vidas: number
  /** Invulnerabilidad restante (s). 0 = expuesta. */
  inv: number
  arma: Arma
  /** Nivel del arma: 1..3. */
  nivel: number
  /** Impactos que absorbe el escudo (0 = sin escudo). */
  escudo: number
  /** Segundos restantes del iman. */
  iman: number
  /** Cuenta atras hasta poder disparar otra vez (s). */
  recarga: number
  /** Carga del BARRIDO, 0..1. */
  carga: number
}

/** Que se esta viendo: el juego corre, esta en pausa, o se acabo. */
export type Fase = 'titulo' | 'jugando' | 'pausa' | 'fin'

/** Lo que el motor lee cada frame. Lo rellena input.ts (teclado + raton). */
export interface Input {
  /** -1 izquierda, 0 quieto, 1 derecha (teclado). */
  eje: number
  /** Posicion X deseada en coordenadas logicas, o null si el raton no manda. */
  raton: number | null
  /** Disparo mantenido. */
  fuego: boolean
  /** Se pidio el BARRIDO en este frame (flanco, lo consume el motor). */
  barrido: boolean
}

/** Todo el estado del juego. Un objeto plano: guardarlo o depurarlo es trivial. */
export interface World {
  fase: Fase
  /** Tiempo total jugado (s). */
  t: number
  nave: Nave
  enemigos: Enemy[]
  balas: Bullet[]
  balasEnemigas: EnemyBullet[]
  powers: Power[]
  chispas: Chispa[]
  /** Oleada actual (1..infinito). */
  oleada: number
  /** Muertes seguidas sin recibir dano (alimenta el combo). */
  racha: number
  /** Indice dentro de COMBOS. */
  combo: number
  puntos: number
  /** Enemigos que faltan por aparecer de la oleada actual. */
  porAparecer: Enemy[]
  /** Cuenta atras hasta soltar el siguiente enemigo de la cola de entrada (s). */
  entradaEn: number
  /** Cuenta atras entre oleada y oleada (s). >0 = cartel de oleada en pantalla. */
  descanso: number
  /** Cuenta atras hasta que alguien se descuelgue a picar (s). */
  picadaEn: number
  /** Deriva horizontal de la formacion (px) y su direccion. */
  formX: number
  formDir: number
  /** Cuanto ha bajado la formacion (px). */
  formY: number
  /** Segundos restantes del BARRIDO (0 = no activo). */
  barrido: number
  /** Sacudida de pantalla restante (s) y su fuerza. */
  shake: number
  shakeF: number
  /** Aberracion cromatica 0..1 (impactos, jefe, barrido). */
  aberr: number
  /** Desenganche vertical del tubo: 0..1 de progreso, y cuanto falta para el proximo. */
  roll: number
  rollEn: number
  /** Cartel efimero ("OLEADA 3", "ABANICO II"...) y lo que le queda (s). */
  cartel: string
  cartelT: number
  /** Puntos maximos de la partida anterior, para pintar "RECORD" en el HUD. */
  record: number
  /** Cuantas veces has muerto en esta partida (solo para el resumen final). */
  bajas: number
}
