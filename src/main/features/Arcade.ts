import type { ArcadeStats } from '@shared/ipc'
import { JsonStore } from './dev/jsonStore'

/**
 * Las marcas de INTERFERENCIA, el arcade que TEK enseña cuando una pagina no
 * carga. Mismo patron que el perfil: un JSON diminuto en userData, sin cuentas,
 * sin tablas online y sin salir del equipo. Un record es tuyo o no es nada.
 */
export class Arcade {
  private readonly store = new JsonStore<ArcadeStats>('tek-arcade.json', {
    record: 0,
    oleadaMax: 0,
    partidas: 0,
    mudo: false
  })

  get(): ArcadeStats {
    return { ...this.store.data }
  }

  /**
   * Cierra una partida. Los numeros vienen del renderer, asi que se saneen antes
   * de tocar disco: enteros, no negativos y con un techo que ninguna partida
   * humana alcanza (un JSON corrupto no debe poder plantar un record eterno).
   */
  registrar(puntos: unknown, oleada: unknown): ArcadeStats {
    const p = Math.min(1e12, Math.max(0, Math.floor(Number(puntos) || 0)))
    const o = Math.min(100000, Math.max(0, Math.floor(Number(oleada) || 0)))
    const d = this.store.data
    d.partidas++
    if (p > d.record) d.record = p
    if (o > d.oleadaMax) d.oleadaMax = o
    this.store.save()
    return this.get()
  }

  setMudo(mudo: unknown): ArcadeStats {
    this.store.data.mudo = mudo === true
    this.store.save()
    return this.get()
  }

  dispose(): void {
    this.store.dispose()
  }
}
