import { useEffect, useRef, useState } from 'react'

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*<>/\\{}[]=+'

interface Props {
  text: string
  /** ms entre pasos de revelado por caracter */
  speed?: number
  /** retraso antes de empezar */
  delay?: number
  className?: string
}

/**
 * Revela el texto descifrandolo de izquierda a derecha: los caracteres aun no
 * resueltos parpadean con glifos aleatorios (estilo terminal CRT).
 */
export function DecryptedText({ text, speed = 38, delay = 0, className }: Props): React.JSX.Element {
  const [output, setOutput] = useState('')
  const revealed = useRef(0)

  useEffect(() => {
    revealed.current = 0
    let raf = 0
    let timer: ReturnType<typeof setTimeout>

    const scrambleRest = (count: number): string => {
      let s = text.slice(0, count)
      for (let i = count; i < text.length; i++) {
        s += text[i] === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      }
      return s
    }

    let last = 0
    const step = (t: number): void => {
      if (!last) last = t
      if (t - last >= speed) {
        last = t
        revealed.current += 1
        setOutput(scrambleRest(revealed.current))
      }
      if (revealed.current <= text.length) raf = requestAnimationFrame(step)
      else setOutput(text)
    }

    timer = setTimeout(() => {
      raf = requestAnimationFrame(step)
    }, delay)

    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [text, speed, delay])

  return <span className={className}>{output || ' '}</span>
}
