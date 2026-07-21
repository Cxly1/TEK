import { app } from 'electron'

/**
 * Compatibilidad de User-Agent POR SITIO. Algunos sitios (WhatsApp Web el
 * primero) miran el UA, ven los tokens `tek/x` y `Electron/x` y concluyen
 * "navegador viejo / no soportado" — con la version REAL de Chrome dentro.
 *
 * La UA "limpia" es la default de Electron quitando SOLO esos dos tokens (el
 * Chrome/138 real se queda; no fingimos ser otro navegador).
 *
 * REGLA DE ORO (decision firme 2026-06-06, [[tek-progress]]): el UA global NO
 * se toca — manipularlo rompio el login de Google tres veces y se revirtio.
 * Por eso esto se aplica UNICAMENTE a la lista de hosts quisquillosos de abajo;
 * Google y el resto del mundo siguen viendo la UA default que ya funciona.
 */

/** Hosts (por sufijo) que rechazan UAs con token Electron. AMPLIAR AQUI. */
// netflix.com: su control de compatibilidad mira el UA; con la version REAL de
// Chrome (sin los tokens tek/Electron) reproduce sin quejarse de "navegador no
// soportado". El DRM en si lo resuelve el CDM de Widevine, no el UA.
// spotify.com: igual que netflix — con la UA limpia sirve el web player de
// ESCRITORIO; con el token Electron degrada a la pagina "preview" estilo movil
// ("Abrir la aplicacion" + barra inferior). El DRM (musica via Widevine) y el
// bloqueo de anuncios se resuelven aparte (CDM + defuser en webview.ts).
// pinterest.com: vive incrustado en apps moviles, asi que husmea el UA para
// decidir si eres un "navegador embebido". Con los tokens tek/Electron caia en
// esa rama —mucho menos probada— y su propia app de React petaba al arrancar
// ("Minified React error #308": leia un Context fuera del render, en SU codigo)
// ademas de hacer el login de Google por un camino que no terminaba nunca.
// Descartados antes de llegar aqui: el adblock (falla igual con el sitio
// permitido) y el defuser de webview.ts (esta acotado a hosts de YouTube).
const PICKY_HOSTS = ['whatsapp.com', 'netflix.com', 'spotify.com', 'pinterest.com']

let cached: string | null = null

/** UA default sin `tek/x` ni `Electron/x` (se calcula una vez). */
export function cleanUserAgent(): string {
  if (cached === null) {
    cached = app.userAgentFallback
      .replace(/\s?tek\/[^\s]+/i, '')
      .replace(/\s?Electron\/[^\s]+/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }
  return cached
}

/** ¿Este host necesita la UA limpia? (sufijo: cubre web.whatsapp.com). */
export function needsCleanUA(host: string): boolean {
  const h = (host || '').toLowerCase().replace(/^www\./, '')
  return PICKY_HOSTS.some((p) => h === p || h.endsWith(`.${p}`))
}
