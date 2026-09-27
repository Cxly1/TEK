/** Tamano legible: 1536 -> "1.5 KB", 5_242_880 -> "5 MB". */
export function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 || v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** Etiqueta de dia legible para agrupar el historial: Hoy / Ayer / fecha. */
export function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yest = new Date()
  yest.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, today)) return 'Hoy'
  if (same(d, yest)) return 'Ayer'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Hora corta HH:MM de un instante. */
export function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Cuando fue, en corto: "ahora", "hace 5 min", "hace 2 h", "ayer", "24 sept". */
export function relTime(ts: number, now = Date.now()): string {
  const min = Math.floor((now - ts) / 60_000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const d = new Date(ts)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) return `hace ${Math.floor(min / 60)} h`
  const yest = new Date(now)
  yest.setDate(today.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'ayer'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}
