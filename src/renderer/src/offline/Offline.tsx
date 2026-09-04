import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { prettyHost, hostKey, type OfflineInfo } from '@shared/ipc'
import { useTek } from '@/store'
import './offline.css'

/**
 * La pantalla que sale cuando una pagina no carga.
 *
 * Hasta ahora TEK dejaba ver la de Chromium, que es de otro navegador y esta en
 * un idioma que no es el suyo. Esta dice lo mismo en cristiano, ofrece
 * reintentar, se entera sola de cuando vuelve la red — y mientras tanto tiene un
 * arcade dentro, que es la unica razon decente para alegrarse de un corte.
 */

/** El motivo del fallo, en un idioma que se entiende. */
function explicar(code: number): string {
  switch (code) {
    case -106:
      return 'No hay conexión. Mira el WiFi o el cable.'
    case -105:
    case -137:
      return 'No se encontró el sitio. Comprueba la dirección, o es tu DNS el que no responde.'
    case -102:
      return 'El sitio rechazó la conexión. Puede que el servidor esté caído.'
    case -7:
    case -118:
      return 'El sitio tardó demasiado en responder.'
    case -21:
      return 'La red cambió a media carga.'
    case -109:
      return 'No se puede llegar a esa dirección desde aquí.'
    case -324:
      return 'El servidor cortó sin mandar nada.'
    case -101:
      return 'La conexión se cortó a medias.'
    default:
      if (code <= -200 && code > -300) return 'El certificado del sitio no es válido.'
      return 'TEK no pudo abrir esta página.'
  }
}

/** Segundos que espera antes de reintentar sola cuando vuelve la red. */
const AUTO_REINTENTO = 3

export function Offline({ info }: { info: OfflineInfo }): React.JSX.Element {
  const abrirArcade = useTek((s) => s.openArcade)
  const arcadeOpen = useTek((s) => s.arcadeOpen)
  const [record, setRecord] = useState(0)
  /** Cuenta atras del reintento automatico. null = la red sigue caida. */
  const [vuelta, setVuelta] = useState<number | null>(null)

  const host = hostKey(info.url)
  const reintentar = (): void => void window.tek.navigate(info.url)

  useEffect(() => {
    void window.tek.arcade.stats().then((s) => setRecord(s.record))
  }, [])

  // El propio navegador avisa cuando el equipo vuelve a tener red. Con el juego
  // abierto NO se reintenta solo: nadie quiere perder una partida porque el
  // router se despertara.
  useEffect(() => {
    const alVolver = (): void => setVuelta(AUTO_REINTENTO)
    window.addEventListener('online', alVolver)
    return () => window.removeEventListener('online', alVolver)
  }, [])

  useEffect(() => {
    if (vuelta === null || arcadeOpen) return
    if (vuelta <= 0) {
      reintentar()
      return
    }
    const id = setTimeout(() => setVuelta((v) => (v === null ? null : v - 1)), 1000)
    return () => clearTimeout(id)
  }, [vuelta, arcadeOpen, info.url])

  return (
    <motion.div
      className="off"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22 }}
    >
      <div className="off-rayas" aria-hidden />
      <div className="off-banda" aria-hidden />

      <div className="off-centro">
        <h1 className="off-titulo">SIN SEÑAL</h1>
        <p className="off-host">
          no se pudo llegar a <b>{prettyHost(host) || info.url}</b>
        </p>
        <p className="off-razon">{explicar(info.code)}</p>

        <div className="off-acciones">
          <button className="off-btn off-btn-1" onClick={reintentar}>
            {vuelta !== null && !arcadeOpen ? `Reintentando en ${vuelta}…` : 'Reintentar'}
          </button>
          <button className="off-btn" onClick={abrirArcade}>
            <span className="off-glifo" aria-hidden>
              ▚
            </span>
            Jugar mientras vuelve
          </button>
        </div>

        {record > 0 && <p className="off-record">tu récord en INTERFERENCIA: {record.toLocaleString('es-MX')}</p>}

        <p className="off-tecnico">
          {info.desc || 'ERR_FAILED'} · {info.code}
        </p>
        <p className="off-pista">
          <kbd>⌘K</kbd> para ir a otro sitio
        </p>
      </div>
    </motion.div>
  )
}
