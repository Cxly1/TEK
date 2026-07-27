import type { UpdateState, UserProfile } from '@shared/ipc'
import { NEWS } from '@shared/news'

/**
 * ¿Hay novedades sin ver? Solo avisa si esta version TIENE entrada escrita: si
 * se publica una sin anotar novedades, no se inventa un aviso vacio. Y en una
 * instalacion nueva `newsSeen` ya viene con la version puesta
 * (Profile.seedNews): estrenar TEK no es una novedad.
 */
export function unseenNews(s: { version: string; profile: UserProfile | null }): boolean {
  if (!s.version || s.profile?.newsSeen === s.version) return false
  return NEWS.some((n) => n.version === s.version)
}

/** Como se pinta la marca del megafono. `null` = sin marca. */
export type NewsDot = 'ping' | 'dot' | null

/**
 * La marca del megafono, que dice DOS cosas con el mismo punto: hay novedades
 * sin leer, o tienes una version vieja. Es a proposito — las dos son "hay algo
 * que contarte", y las dos se resuelven abriendo Novedades.
 *
 * - `ping` (punto que late): hay algo que no has visto todavia.
 * - `dot` (punto quieto): ya lo viste, pero SIGUE pendiente de instalar. El
 *   punto no se apaga hasta que actualices de verdad — que es justo lo que
 *   faltaba: quien cerraba el aviso se quedaba sin ninguna senal. Dejar de
 *   latir es lo que evita que de la lata durante dias.
 */
export function newsDot(s: {
  version: string
  profile: UserProfile | null
  update: UpdateState
}): NewsDot {
  if (unseenNews(s)) return 'ping'
  if (!s.update.pending) return null
  return s.profile?.updateSeen === s.update.pending ? 'dot' : 'ping'
}
