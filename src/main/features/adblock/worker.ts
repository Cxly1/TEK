import { FiltersEngine } from '@ghostery/adblocker'

/**
 * Proceso aparte (utilityProcess) que convierte las listas de filtros en el
 * motor del bloqueador.
 *
 * Parsear ~7 MB de listas cuesta 1–1,5 s de CPU. Hecho en el proceso principal
 * (como hasta ahora) congelaba TEK entero ese rato, ~6 s despues de cada
 * arranque y cada 12 h: ninguna pagina podia empezar a cargar y la barra no
 * respondia. Aqui se parsea en otro proceso y al principal solo vuelve el motor
 * ya serializado, que cargar cuesta ~40 ms (medido: __ztest__/probe-uworker.mjs).
 *
 * Importa el motor PURO (`@ghostery/adblocker`), no el adaptador de Electron:
 * ese trae ipcMain y aqui no hay. El formato serializado es el mismo, asi que
 * el principal lo abre con ElectronBlocker.deserialize.
 */

interface Job {
  /** Listas ya filtradas y unidas. */
  text: string
  /** resources.json del INSTALADOR (scriptlets) y su huella, o null. */
  resources: string | null
  checksum: string
}

process.parentPort.on('message', (e) => {
  const job = e.data as Job
  try {
    const engine = FiltersEngine.parse(job.text, { enableCompression: true })
    if (job.resources) engine.updateResources(job.resources, job.checksum)
    process.parentPort.postMessage({ ok: true, buf: engine.serialize() })
  } catch (err) {
    process.parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
