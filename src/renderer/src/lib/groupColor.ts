/**
 * Color determinista por dominio para distinguir grupos de pestanas de un
 * vistazo. El mismo host devuelve siempre el mismo tono.
 */
export function groupColor(host: string): string {
  let h = 0
  for (let i = 0; i < host.length; i++) {
    h = (h * 31 + host.charCodeAt(i)) >>> 0
  }
  const hue = h % 360
  return `hsl(${hue} 58% 62%)`
}
