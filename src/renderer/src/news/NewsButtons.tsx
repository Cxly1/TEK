import { motion } from 'motion/react'
import { useTek } from '@/store'
import { newsDot } from './unseen'

/**
 * Los dos botones de la barra: Novedades y Reportar un fallo.
 *
 * Viven en la FILA DE ARRIBA (la de las pestanas), no en la de navegacion:
 * esa segunda fila solo existe cuando hay una pagina abierta, y justo despues
 * de actualizar caes en pestana nueva — no los verias.
 *
 * Iconos: trazos originales de Lucide (`megaphone` y `bug`, el set que usan
 * skiper-ui/shadcn) pero a grosor 1.8 en vez del 2 de fabrica, que es el del ☰
 * de al lado; con el 2 pesarian mas que el resto de la barra y cantaria.
 * El gesto al pasar por encima esta calcado de lucide-animated (pqoqubbw), con
 * la misma libreria que ya usa TEK.
 */

/** Muelle corto: reacciona al momento y se para, sin rebote de juguete. */
const SPRING = { type: 'spring', stiffness: 400, damping: 22 } as const

export function NewsButton(): React.JSX.Element {
  const openNews = useTek((s) => s.openNews)
  const dot = useTek(newsDot)
  const pending = useTek((s) => s.update.pending)
  return (
    <motion.button
      className="tb-tool no-drag"
      data-tour="news"
      title={
        pending
          ? `Novedades — TEK ${pending} está lista para instalar`
          : dot
            ? 'Novedades — hay cosas nuevas'
            : 'Novedades: qué cambió en cada versión'
      }
      onClick={openNews}
      initial="rest"
      animate="rest"
      whileHover="hover"
      whileTap={{ scale: 0.92 }}
    >
      <motion.svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        // Se levanta para gritar: la boca del megafono sube y avanza un pelo.
        variants={{ rest: { rotate: 0, x: 0 }, hover: { rotate: -10, x: 1 } }}
        transition={SPRING}
      >
        <path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
        <path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14" />
        <path d="M8 6v8" />
      </motion.svg>
      {/* Solo Novedades lleva marca. Late si hay algo sin ver; se queda quieta
          mientras siga habiendo una version sin instalar (ver newsDot). */}
      {dot && <span className={`tb-tool-dot ${dot === 'ping' ? 'is-ping' : ''}`} />}
    </motion.button>
  )
}

export function ReportButton(): React.JSX.Element {
  const openFeedback = useTek((s) => s.openFeedback)
  return (
    <motion.button
      className="tb-tool no-drag"
      title="Reportar un fallo: cuéntame qué se rompió"
      onClick={openFeedback}
      initial="rest"
      animate="rest"
      whileHover="hover"
      whileTap={{ scale: 0.92 }}
    >
      <motion.svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        // Patalea una vez y se queda quieto.
        variants={{ rest: { rotate: 0 }, hover: { rotate: [0, -5, 5, -4, 0] } }}
        transition={{ duration: 0.6, ease: 'easeInOut' }}
      >
        <path d="M12 20v-9" />
        <path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z" />
        <path d="M14.12 3.88 16 2" />
        <path d="M21 21a4 4 0 0 0-3.81-4" />
        <path d="M21 5a4 4 0 0 1-3.55 3.97" />
        <path d="M22 13h-4" />
        <path d="M3 21a4 4 0 0 1 3.81-4" />
        <path d="M3 5a4 4 0 0 0 3.55 3.97" />
        <path d="M6 13H2" />
        <path d="m8 2 1.88 1.88" />
        <path d="M9 7.13V6a3 3 0 1 1 6 0v1.13" />
      </motion.svg>
    </motion.button>
  )
}
