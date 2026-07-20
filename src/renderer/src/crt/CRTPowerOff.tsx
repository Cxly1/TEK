import { useEffect, useRef } from 'react'
import { useAnimate } from 'motion/react'
import './crt.css'

interface Props {
  onComplete: () => void
}

/**
 * Apagado tipo tele CRT vieja:
 *  1. la pantalla (centro brillante) aparece y el fondo se va a negro
 *  2. colapso vertical -> linea horizontal de fosforo
 *  3. colapso horizontal -> punto central
 *  4. el punto florece y se apaga
 * Todo con transform (scaleY/scaleX), sin canvas ni marcos de color.
 */
export function CRTPowerOff({ onComplete }: Props): React.JSX.Element {
  const [scope, animate] = useAnimate()
  const tubeRef = useRef<HTMLDivElement | null>(null)
  const backRef = useRef<HTMLDivElement | null>(null)
  const easeIn: [number, number, number, number] = [0.76, 0, 0.9, 0.1]

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      const tube = tubeRef.current
      const back = backRef.current
      if (!tube || !back) return

      // 1. aparece la pantalla y el fondo se ennegrece
      animate(back, { opacity: 1 }, { duration: 0.12, ease: 'easeIn' })
      await animate(tube, { opacity: [0, 1] }, { duration: 0.07, ease: 'easeOut' })
      // 2. colapso vertical -> linea
      await animate(tube, { scaleY: 0.006 }, { duration: 0.17, ease: easeIn })
      // 3. colapso horizontal -> punto
      await animate(tube, { scaleX: 0.014 }, { duration: 0.12, ease: easeIn })
      // 4. florece y se apaga
      await animate(
        tube,
        { scaleX: 0.05, scaleY: 0.05, opacity: 0 },
        { duration: 0.18, ease: 'easeOut' }
      )

      if (!cancelled) onComplete()
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [animate, onComplete])

  return (
    <div ref={scope} className="crt-off">
      <div ref={backRef} className="crt-back" />
      <div ref={tubeRef} className="crt-tube">
        <div className="scanlines" />
      </div>
    </div>
  )
}
