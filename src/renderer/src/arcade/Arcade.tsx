import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useTek } from '@/store'
import { alternarPausa, crearMundo, empezar, paso, type Fx } from './engine'
import { Pintor } from './render'
import { Mandos, type MandoAcciones } from './input'
import { ArcadeAudio } from './audio'
import type { World } from './types'
import './arcade.css'

/**
 * INTERFERENCIA dentro de TEK.
 *
 * React monta el marco (la cabecera, el pie y el lienzo) y NADA MAS: en cuanto
 * arranca la partida no vuelve a renderizar. El bucle de juego vive entero en un
 * `requestAnimationFrame` que habla con el motor y el pintor por referencia. Si
 * el estado del juego pasara por zustand, cada bala provocaria un render de todo
 * el arbol y esto iria a tirones — el mismo cuidado que ya se tiene en el resto
 * del renderer con los blurs y los selectores.
 */
export function Arcade(): React.JSX.Element {
  const cerrar = useTek((s) => s.closeArcade)
  const cajaRef = useRef<HTMLDivElement>(null)
  const lienzoRef = useRef<HTMLCanvasElement>(null)
  /** Puente al interior del bucle: lo unico que el marco de React necesita tocar. */
  const mudoRef = useRef<(() => void) | null>(null)
  const [record, setRecord] = useState(0)
  const [mudo, setMudo] = useState(false)

  useEffect(() => {
    const lienzo = lienzoRef.current
    const caja = cajaRef.current
    if (!lienzo || !caja) return

    const pintor = new Pintor(lienzo)
    const audio = new ArcadeAudio()
    let mundo: World = crearMundo(0)
    /** Ultimo record confirmado por el main; entra en la partida SIGUIENTE, para
     *  que la pantalla de fin pueda decir "récord nuevo" comparando con el viejo. */
    let recordVigente = 0

    const fx: Fx = {
      sonido: (s) => audio.reproducir(s),
      fin: (puntos, oleada) => {
        void window.tek.arcade.registrar(puntos, oleada).then((st) => {
          recordVigente = st.record
          setRecord(st.record)
        })
      }
    }

    // Marcas guardadas: llegan en unos ms y se inyectan en el mundo ya creado.
    void window.tek.arcade.stats().then((st) => {
      recordVigente = st.record
      mundo.record = st.record
      setRecord(st.record)
      setMudo(st.mudo)
      if (st.mudo && !audio.mudo) audio.alternarMudo()
    })

    const acciones: MandoAcciones = {
      empezar: () => {
        // El primer gesto vale doble: arranca la partida y desbloquea el audio
        // (los navegadores no dejan sonar nada sin una interaccion previa).
        audio.arrancar()
        empezar(mundo, fx)
      },
      pausa: () => {
        alternarPausa(mundo)
        mandos.soltar()
      },
      reiniciar: () => {
        if (mundo.fase !== 'fin') return
        mundo = crearMundo(recordVigente)
        audio.arrancar()
        empezar(mundo, fx)
      },
      salir: () => cerrar(),
      alternarMudo: () => {
        const m = audio.alternarMudo()
        setMudo(m)
        void window.tek.arcade.setMudo(m)
      }
    }
    const mandos = new Mandos(lienzo, pintor, acciones)
    mudoRef.current = acciones.alternarMudo

    const ajustar = (): void => {
      pintor.redimensionar(caja.clientWidth, caja.clientHeight, window.devicePixelRatio || 1)
      pintor.pintar(mundo, performance.now() / 1000)
    }
    ajustar()
    const ro = new ResizeObserver(ajustar)
    ro.observe(caja)

    // Si TEK pierde el foco a media partida, se pausa sola. Volver y encontrarte
    // muerto porque contestaste un mensaje seria una broma pesada.
    const alPerderFoco = (): void => {
      if (mundo.fase === 'jugando') alternarPausa(mundo)
      mandos.soltar()
    }
    window.addEventListener('blur', alPerderFoco)

    let raf = 0
    let anterior = performance.now()
    const bucle = (ahora: number): void => {
      const dt = (ahora - anterior) / 1000
      anterior = ahora
      paso(mundo, dt, mandos.leer(), fx)
      // El reloj de DIBUJO va aparte del mundo: los adornos (estatica, brillos,
      // el "pulsa para empezar") tienen que seguir vivos en el titulo y en la
      // pantalla de fin, donde el reloj del juego esta parado.
      pintor.pintar(mundo, ahora / 1000)
      raf = requestAnimationFrame(bucle)
    }
    raf = requestAnimationFrame(bucle)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('blur', alPerderFoco)
      mudoRef.current = null
      mandos.dispose()
      audio.dispose()
    }
  }, [cerrar])

  return (
    <motion.div
      className="arc-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="arc-bar">
        <span className="arc-marca">INTERFERENCIA</span>
        <span className="arc-sep" />
        {record > 0 && <span className="arc-record">récord {record.toLocaleString('es-MX')}</span>}
        <button
          className="arc-btn"
          onClick={() => mudoRef.current?.()}
          title="Silenciar (M)"
          aria-label="Silenciar"
        >
          {mudo ? '⊘' : '♪'}
        </button>
        <button className="arc-btn" onClick={cerrar} title="Salir (Esc)" aria-label="Salir">
          ✕
        </button>
      </div>

      <div className="arc-caja" ref={cajaRef}>
        <canvas ref={lienzoRef} className="arc-tubo" />
      </div>

      <div className="arc-pie">
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd> o el ratón
        </span>
        <span>
          <kbd>espacio</kbd> disparar
        </span>
        <span>
          <kbd>mayús</kbd> barrido
        </span>
        <span>
          <kbd>P</kbd> pausa
        </span>
        <span>
          <kbd>Esc</kbd> salir
        </span>
      </div>
    </motion.div>
  )
}
