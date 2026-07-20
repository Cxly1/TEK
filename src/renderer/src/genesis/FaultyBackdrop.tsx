import { useEffect, useRef } from 'react'

/**
 * Campo de puntos que reacciona al cursor: los puntos cercanos al puntero se
 * iluminan (con tinte fosforo/oro) y el resto queda muy tenue, con un leve
 * latido para que respire aunque no muevas el mouse. Es lo que da vida a Genesis.
 */
export function FaultyBackdrop(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const mouse = useRef({ x: -9999, y: -9999 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const GAP = 28
    const RADIUS = 170
    let w = 0
    let h = 0
    let raf = 0

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const onMove = (e: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect()
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const draw = (t: number): void => {
      raf = requestAnimationFrame(draw)
      ctx.clearRect(0, 0, w, h)
      const breathe = 0.04 + 0.02 * Math.sin(t / 900)
      const mx = mouse.current.x
      const my = mouse.current.y

      // Los puntos LEJOS del cursor comparten color exacto: van todos en un solo
      // path con un unico fillStyle. Solo los ~150 cercanos al puntero (de ~2000)
      // pagan su string de color individual por frame.
      const near: number[] = []
      ctx.fillStyle = `rgba(232,233,235,${breathe})`
      ctx.beginPath()
      for (let y = GAP; y < h; y += GAP) {
        for (let x = GAP; x < w; x += GAP) {
          const d = Math.hypot(x - mx, y - my)
          if (d < RADIUS) near.push(x, y, 1 - d / RADIUS)
          else ctx.rect(x - 0.7, y - 0.7, 1.4, 1.4)
        }
      }
      ctx.fill()

      for (let i = 0; i < near.length; i += 3) {
        const x = near[i]
        const y = near[i + 1]
        const gold = near[i + 2]
        const a = breathe + gold * 0.55
        // color: blanco fosforo, virando a oro cerca del cursor
        const r = Math.round(232 + gold * 12)
        const g = Math.round(233 - gold * 30)
        const b = Math.round(235 - gold * 120)
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`
        const s = 1.4 + gold * 1.6
        ctx.fillRect(x - s / 2, y - s / 2, s, s)
      }
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onMove)
    raf = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  )
}
