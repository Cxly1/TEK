import type { UserProfile } from '@shared/ipc'
import { NEWS } from '@shared/news'

/**
 * ¿Hay novedades sin ver? Lo usan el punto del ☰ y la entrada del menu, asi que
 * vive aparte para que digan LO MISMO siempre.
 *
 * Solo avisa si esta version TIENE entrada escrita: si se publica una sin
 * anotar novedades, no se inventa un aviso vacio. Y en una instalacion nueva
 * `newsSeen` ya viene con la version puesta (Profile.seedNews): estrenar TEK no
 * es una novedad.
 */
export function unseenNews(s: { version: string; profile: UserProfile | null }): boolean {
  if (!s.version || s.profile?.newsSeen === s.version) return false
  return NEWS.some((n) => n.version === s.version)
}
