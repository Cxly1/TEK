/** Saludo dependiente de la hora local. */
export function greetingForHour(hour: number = new Date().getHours()): string {
  if (hour >= 5 && hour < 12) return 'buenos días'
  if (hour >= 12 && hour < 20) return 'buenas tardes'
  return 'buenas noches'
}

/**
 * Saludo por hora con el nombre de quien usa TEK, si lo dijo: "buenos días,
 * Ana". Sin nombre devuelve el saludo pelado, asi que sirve para cualquier
 * sitio donde antes se usaba greetingForHour.
 */
export function greetingForUser(name: string | undefined, hour?: number): string {
  const g = greetingForHour(hour)
  const n = (name ?? '').trim()
  return n ? `${g}, ${n}` : g
}

/** Saludo de la pantalla de encendido. Con nombre: "Buenos días, Ana." */
export function fullGreeting(name?: string): string {
  const n = (name ?? '').trim()
  if (!n) return `Hola, ${greetingForHour()}.`
  const g = greetingForHour()
  return `${g.charAt(0).toUpperCase()}${g.slice(1)}, ${n}.`
}
