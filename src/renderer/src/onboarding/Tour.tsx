import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { motion } from 'motion/react'
import { useTek } from '@/store'
import './onboarding.css'

/** Un paso del tutorial. Sin `target` la tarjeta sale centrada (sin foco). */
interface Step {
  id: string
  /** Valor del atributo data-tour del elemento a resaltar. */
  target?: string
  title: string
  body: string
  /** Lista opcional atajo -> que hace (los pasos "de repaso"). */
  items?: { k: string; v: string }[]
}

/** Rectangulo del foco, ya con su margen. */
interface Hole {
  left: number
  top: number
  width: number
  height: number
}

/** Aire alrededor del elemento resaltado. */
const PAD = 8
/** Separacion entre el foco y la tarjeta. */
const GAP = 18
/** Alto que reservamos a la tarjeta para decidir si cabe debajo del foco. */
const CARD_ROOM = 290
/** Media anchura de la tarjeta: mantiene la tarjeta dentro de la ventana. */
const HALF = 224

function buildSteps(name: string): Step[] {
  const you = name ? `, ${name}` : ''
  return [
    {
      id: 'hello',
      title: `Bienvenido a TEK${you}`,
      body: 'Te enseño lo importante en menos de un minuto. Avanza con → o Enter, vuelve con ←, y sal cuando quieras con Esc.'
    },
    {
      id: 'clock',
      target: 'clock',
      title: 'Tu saludo',
      body: name
        ? `TEK te saluda por tu nombre y cambia según la hora: buenos días, buenas tardes, buenas noches. Puedes cambiarlo al final de este tutorial.`
        : 'Aquí va la hora y un saludo. Si le dices tu nombre, TEK te saludará por él (puedes hacerlo al final de este tutorial).'
    },
    {
      id: 'omnibox',
      target: 'omnibox',
      title: 'Una sola barra para todo',
      body: 'Busca o escribe una dirección aquí. Desde cualquier página se abre con Ctrl+K, y en esta pantalla basta con empezar a escribir.',
      items: [
        { k: 'yt gatos', v: 'busca en YouTube' },
        { k: 'gh react', v: 'busca repos en GitHub' },
        { k: 'g recetas', v: 'busca en Google' }
      ]
    },
    {
      id: 'dial',
      target: 'dial',
      title: 'Tus sitios, ordenados solos',
      body: 'TEK aprende qué abres y a qué hora, y pone delante lo que sueles usar en esta franja del día. Todo se queda en tu equipo; puedes verlo o borrarlo en ☰ → Lo que TEK sabe de ti.'
    },
    {
      id: 'tabs',
      target: 'tabs',
      title: 'Pestañas que se ordenan solas',
      body: 'Las de un mismo sitio se agrupan con su color; toca la etiqueta del grupo para plegarlo. Arrástralas para reordenar y usa el clic derecho para duplicar, silenciar o cerrar.'
    },
    {
      id: 'newtab',
      target: 'newtab',
      title: 'Nueva pestaña',
      body: 'Con este + o con Ctrl+T. ¿Cerraste una sin querer? Ctrl+Shift+T la trae de vuelta.'
    },
    {
      id: 'tools',
      target: 'tools',
      title: 'Todo lo demás vive aquí',
      body: 'Un único menú: historial, descargas, contraseñas (cifradas por tu propio Windows), automatización y el perfil de lo que TEK ha aprendido. Desde aquí también puedes repetir este tutorial.'
    },
    {
      id: 'news',
      target: 'news',
      title: 'Cuando TEK cambie, te enteras',
      body: 'TEK se actualiza sola, nunca sin avisar. Cuando llega una versión nueva, este megáfono se enciende con un punto dorado y dentro te cuento en dos líneas qué cambió; se apaga en cuanto lo abres. El bicho de al lado es para lo contrario: si algo se rompe, escríbeme desde ahí y me llega a mí.'
    },
    {
      id: 'page',
      target: 'address',
      title: 'Cuando abras una web',
      body: 'La barra de arriba se convierte en la dirección del sitio, y a su lado aparecen dos botones.',
      items: [
        { k: '🛡', v: 'anuncios bloqueados — clic para permitirlos en ese sitio' },
        { k: '▭', v: 'mini-player: el vídeo te sigue mientras navegas' },
        { k: 'Ctrl+F', v: 'buscar dentro de la página' },
        { k: 'Ctrl + rueda', v: 'lupa: agranda sin descuadrar la web' }
      ]
    },
    {
      id: 'keys',
      title: 'Los atajos que más vas a usar',
      body: 'No hace falta memorizarlos: están repetidos en los menús.',
      items: [
        { k: 'Ctrl+K', v: 'buscar o ir a una dirección' },
        { k: 'Ctrl+T', v: 'nueva pestaña' },
        { k: 'Ctrl+W', v: 'cerrar pestaña' },
        { k: 'Ctrl+Shift+T', v: 'reabrir la última cerrada' },
        { k: 'Ctrl+Shift+P', v: 'mini-player' },
        { k: 'Ctrl+1…9', v: 'saltar a una pestaña' }
      ]
    },
    {
      id: 'end',
      title: `Listo${you}`,
      body: 'Ya puedes navegar. Si quieres volver a ver esto, está en ☰ → Repetir tutorial.'
    }
  ]
}

/** Mide el elemento del paso; null si ese paso no señala nada (o no está en pantalla). */
function measure(target: string | undefined): Hole | null {
  if (!target) return null
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return null
  return {
    left: r.left - PAD,
    top: r.top - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2
  }
}

/**
 * Tutorial guiado: oscurece TEK, abre un hueco de luz sobre la pieza que explica
 * (el hueco VIAJA de una a otra, con un anillo que se cierra encima = el "zoom")
 * y pone al lado una tarjeta con la explicación.
 *
 * Un paso cuyo elemento no está en pantalla (p. ej. la barra de dirección con
 * una pestaña en blanco) no se rompe: cae a tarjeta centrada sin foco.
 *
 * La capa `tour-block` se come los clics: durante el tutorial no se puede tocar
 * la UI de debajo, así que no hay forma de dejar el tour a medias por accidente.
 */
export function Tour(): React.JSX.Element {
  const profile = useTek((s) => s.profile)
  const setProfile = useTek((s) => s.setProfile)
  const closeTour = useTek((s) => s.closeTour)
  const openWelcome = useTek((s) => s.openWelcome)

  const steps = buildSteps(profile?.name ?? '')
  const [i, setI] = useState(0)
  const [hole, setHole] = useState<Hole | null>(null)
  const step = steps[Math.min(i, steps.length - 1)]
  const last = i === steps.length - 1

  // Medimos al entrar en cada paso. El rAF extra cubre el caso de un elemento
  // que acaba de montarse (el lienzo aparece en el mismo frame que el tour).
  useLayoutEffect(() => {
    const apply = (): void => setHole(measure(step.target))
    apply()
    const raf = requestAnimationFrame(apply)
    window.addEventListener('resize', apply)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', apply)
    }
  }, [step.target])

  const finish = useCallback((): void => {
    void window.tek.profile.set({ tourDone: true }).then(setProfile)
    closeTour()
  }, [closeTour, setProfile])

  /** Cierra el tutorial y vuelve a la pantalla del nombre. */
  const rename = useCallback((): void => {
    void window.tek.profile.set({ tourDone: true }).then(setProfile)
    openWelcome()
  }, [openWelcome, setProfile])

  const next = useCallback((): void => {
    setI((n) => {
      if (n < steps.length - 1) return n + 1
      finish()
      return n
    })
  }, [steps.length, finish])

  // Teclado en captura: el tutorial manda mientras está abierto (el lienzo y los
  // atajos globales ya se apartan al ver `tourOpen`, esto los blinda igual).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key
      if (k === 'ArrowRight' || k === 'Enter' || k === ' ') {
        e.preventDefault()
        e.stopPropagation()
        next()
      } else if (k === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        setI((n) => Math.max(0, n - 1))
      } else if (k === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [next, finish])

  // Sitio de la tarjeta: debajo del foco si cabe, si no encima; sin foco, centrada.
  let anchor: CSSProperties = {}
  let centered = true
  if (hole) {
    centered = false
    const cx = Math.min(Math.max(hole.left + hole.width / 2, HALF + 16), window.innerWidth - HALF - 16)
    anchor =
      hole.top + hole.height + CARD_ROOM < window.innerHeight
        ? { left: cx, top: hole.top + hole.height + GAP }
        : { left: cx, bottom: window.innerHeight - hole.top + GAP }
  }

  return (
    <div className="tour-root">
      <div className="tour-block" />

      {hole ? (
        <>
          <motion.div
            className="tour-hole"
            initial={false}
            animate={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
          />
          {/* El anillo que se cierra sobre la pieza: la sensacion de zoom. */}
          <motion.span
            key={step.id}
            className="tour-ring"
            style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height }}
            initial={{ opacity: 0.9, scale: 1.45 }}
            animate={{ opacity: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </>
      ) : (
        <div className="tour-dim" />
      )}

      <div className={`tour-anchor ${centered ? 'is-center' : ''}`} style={anchor}>
        <motion.div
          key={step.id}
          className="tour-card"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        >
          <span className="tour-count">
            {i + 1} / {steps.length}
          </span>
          <h2 className="tour-title">{step.title}</h2>
          <p className="tour-body">{step.body}</p>

          {step.items && (
            <ul className="tour-list">
              {step.items.map((it) => (
                <li key={it.k}>
                  <kbd>{it.k}</kbd>
                  <span>{it.v}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="tour-dots">
            {steps.map((s, j) => (
              <button
                key={s.id}
                className={`tour-dot ${j === i ? 'is-on' : ''}`}
                aria-label={`Paso ${j + 1}`}
                onClick={() => setI(j)}
              />
            ))}
          </div>

          <div className="tour-actions">
            {/* En el ultimo paso el boton discreto deja de ser "saltar" y pasa a
                ser la unica via para cambiar el nombre despues del primer dia. */}
            <button className="tour-skip" onClick={last ? rename : finish}>
              {last ? 'Cambiar mi nombre' : 'Saltar tutorial'}
            </button>
            <div className="tour-nav">
              {i > 0 && (
                <button className="tour-btn" onClick={() => setI((n) => Math.max(0, n - 1))}>
                  Atrás
                </button>
              )}
              <button className="tour-btn is-primary" onClick={next}>
                {last ? 'Empezar a navegar' : 'Siguiente'}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
