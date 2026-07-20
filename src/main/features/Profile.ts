import type { UserProfile } from '@shared/ipc'
import { JsonStore } from './dev/jsonStore'

/**
 * Perfil de quien usa TEK: el nombre con el que saluda y si ya vio el tutorial.
 * Es lo MINIMO que TEK guarda de la persona y NUNCA sale del equipo (mismo
 * patron JSON que el resto de ajustes: sobrevive aunque el nativo del cerebro
 * falle). Se pregunta una sola vez, en el primer arranque.
 */
export class Profile {
  private readonly store = new JsonStore<UserProfile>('tek-profile.json', {
    name: '',
    greeted: false,
    tourDone: false,
    createdAt: Date.now()
  })

  get(): UserProfile {
    return { ...this.store.data }
  }

  /** Aplica un cambio parcial y devuelve el perfil resultante. */
  set(patch: Partial<UserProfile>): UserProfile {
    const d = this.store.data
    // El nombre es texto que se pinta en la UI: lo acotamos aqui (una sola
    // linea, sin espacios de sobra y con tope) en vez de fiarnos del input.
    if (typeof patch.name === 'string') {
      d.name = patch.name.replace(/\s+/g, ' ').trim().slice(0, 24)
    }
    if (typeof patch.greeted === 'boolean') d.greeted = patch.greeted
    if (typeof patch.tourDone === 'boolean') d.tourDone = patch.tourDone
    this.store.save()
    return this.get()
  }

  dispose(): void {
    this.store.dispose()
  }
}
