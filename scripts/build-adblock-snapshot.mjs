// Genera el SNAPSHOT de adblock que se empaqueta con la app (assets/adblock):
//   - lists.txt      todas las listas de filtros concatenadas
//   - resources.json los scriptlets de uBO (los +js(...) que desarman el muro
//                    anti-adblock de YouTube)
//
// Con esto, una instalacion FRESCA tiene proteccion completa desde el primer
// arranque aunque no haya red o la red bloquee GitHub — antes solo llevaba el
// baseline de ~30 dominios y a esa gente le pasaban anuncios.
//
// Corre bajo el runtime de ELECTRON (no node) a proposito: necesita `net.fetch`,
// que usa el stack de Chromium + los certs del sistema. El fetch de node falla
// en redes con SSL interceptado. Lo invoca el script `dist` antes de empaquetar.
//
// MANTENER LISTS EN SYNC con src/main/features/adblock/Adblock.ts.

import { app, net } from 'electron'
import { ElectronBlocker, fetchResources } from '@ghostery/adblocker-electron'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/filters.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/badware.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/privacy.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/quick-fixes.txt',
  'https://ublockorigin.github.io/uAssetsCDN/filters/annoyances-cookies.txt',
  'https://filters.adtidy.org/extension/ublock/filters/14_optimized.txt',
  'https://easylist-downloads.adblockplus.org/easylistspanish.txt'
]

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'adblock')

app.whenReady().then(async () => {
  try {
    const cFetch = (url) => net.fetch(url)

    // Tolerante: cada lista por su cuenta. Si alguna cae, seguimos con las demas.
    const settled = await Promise.allSettled(LISTS.map((u) => cFetch(u).then((r) => r.text())))
    const texts = []
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') texts.push(r.value)
      else console.warn(`[snapshot] no se pudo bajar ${LISTS[i]}: ${r.reason}`)
    })
    if (texts.length === 0) throw new Error('ninguna lista disponible')

    // Sanity check: que las listas parseen a un motor valido antes de guardarlas.
    ElectronBlocker.parse(texts.join('\n'), { enableCompression: true })
    const resources = await fetchResources(cFetch)

    mkdirSync(OUT, { recursive: true })
    writeFileSync(join(OUT, 'lists.txt'), texts.join('\n'), 'utf8')
    writeFileSync(join(OUT, 'resources.json'), resources, 'utf8')
    console.log(`[snapshot] OK: ${texts.length}/${LISTS.length} listas + scriptlets -> ${OUT}`)
    app.exit(0)
  } catch (e) {
    console.error('[snapshot] fallo:', e)
    // Si ya habia un snapshot de un build anterior, no rompemos el build offline.
    if (existsSync(join(OUT, 'lists.txt')) && existsSync(join(OUT, 'resources.json'))) {
      console.warn('[snapshot] uso el snapshot anterior (no habia red)')
      app.exit(0)
    } else {
      app.exit(1)
    }
  }
})
