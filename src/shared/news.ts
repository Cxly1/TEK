/**
 * Novedades de TEK, una entrada por version publicada.
 *
 * VIVE AQUI, en el codigo, a proposito: viaja dentro de la app, asi que se ve
 * SIN internet, no depende de que GitHub conteste y siempre cuadra con la
 * version que tienes instalada. (Las notas de release que ya lee el updater no
 * sirven para esto: llegan como HTML aplanado y recortado a 400 caracteres —
 * valen para el toast de "hay version nueva" y para nada mas.)
 *
 * AL PUBLICAR UNA VERSION: anade su entrada ARRIBA del array, con el mismo
 * numero que `package.json`. Sin entrada no hay aviso — no pasa nada malo, pero
 * quien actualice no se entera de lo que cambio.
 *
 * COMO SE ESCRIBE (importante, se hizo mal la primera vez): para el PUBLICO, no
 * para quien programa TEK. Una linea corta por punto, lo que la persona GANA, y
 * se acabo. Nada de atajos de teclado, nombres de archivo, causas ni matices —
 * eso es para el commit, no para aqui. Lo que no le cambia el dia a nadie se
 * resume en seco: "arreglos varios", "zoom mejorado". Tres o cuatro puntos por
 * version es de sobra; si hay mas, es que sobran.
 */
export interface NewsEntry {
  /** Igual que la version de package.json (sin la "v"). */
  version: string
  /** ISO corto, para ordenar y mostrar. */
  date: string
  /** Titular de la version, corto. */
  title: string
  /** Que cambio, en frases sueltas. */
  items: string[]
}

export const NEWS: NewsEntry[] = [
  {
    version: '0.3.3',
    date: '2026-07-29',
    title: 'Pestañas más prolijas',
    items: [
      'Los grupos de pestañas ya no se amontonan cuando tienes muchas abiertas.',
      'Los controles de música se quedan siempre a la vista, suene algo o no.'
    ]
  },
  {
    version: '0.3.2',
    date: '2026-07-28',
    title: 'YouTube más limpio',
    items: ['Bloqueo de anuncios en YouTube reforzado: se cuelan muchos menos.']
  },
  {
    version: '0.3.1',
    date: '2026-07-27',
    title: 'Que no se te pase una versión nueva',
    items: [
      'El aviso ya no se pierde: el megáfono sigue encendido hasta que actualices.',
      'Aquí arriba te aparece la versión que te falta, con su botón para instalarla.'
    ]
  },
  {
    version: '0.3.0',
    date: '2026-07-24',
    title: 'Zoom nuevo y arreglos',
    items: [
      'El zoom ahora es una lupa: agranda sin descuadrar la página.',
      'Arreglado el mini-player, que se quedaba en negro.',
      'Menos anuncios desde el primer día.',
      'Nuevo: aquí te cuento qué cambia, y al lado puedes avisarme si algo falla.'
    ]
  },
  {
    version: '0.2.0',
    date: '2026-07-21',
    title: 'Música y actualizaciones',
    items: [
      'Controla lo que suena desde la barra, sin buscar la pestaña.',
      'Las teclas de música del teclado ya funcionan.',
      'TEK se actualiza sola, siempre pidiéndote permiso.',
      'YouTube sin anuncios.'
    ]
  },
  {
    version: '0.1.1',
    date: '2026-07-20',
    title: 'Contraseña maestra',
    items: [
      'Puedes proteger tus contraseñas con una clave tuya.',
      'Arreglos varios.'
    ]
  },
  {
    version: '0.1.0',
    date: '2026-07-20',
    title: 'La primera',
    items: ['TEK sale a la calle.']
  }
]

/** Entradas posteriores a `seen`. Si nunca vio nada, TODAS (lo filtra quien llama). */
export function newsSince(seen: string): NewsEntry[] {
  const i = NEWS.findIndex((n) => n.version === seen)
  return i < 0 ? NEWS : NEWS.slice(0, i)
}
