'use strict'

const { spawnSync } = require('node:child_process')

/**
 * Firma VMP del paquete (castlabs EVS).
 *
 * TEK corre sobre el fork de Electron de castlabs para tener Widevine. Widevine
 * solo entrega la licencia a un binario cuya firma VMP corresponde con el
 * paquete: firmar `node_modules/electron/dist` sirve para `pnpm dev`, pero el
 * .exe que sale de electron-builder es OTRO paquete y hay que firmarlo aparte.
 * Sin esto, el instalador funciona pero Netflix/Disney+/Prime se quedan en negro.
 *
 * Requiere una cuenta gratuita de castlabs EVS:
 *   pip install castlabs-evs
 *   python -m castlabs_evs.account signup
 *
 * Si no hay credenciales (p. ej. alguien que clona el repo solo para trastear),
 * avisamos y seguimos: el navegador se empaqueta igual, solo pierde el DRM.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const dir = context.appOutDir
  console.log(`  • firma VMP (castlabs EVS)  dir=${dir}`)

  const res = spawnSync('python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', dir], {
    stdio: 'inherit',
    shell: false
  })

  if (res.error || res.status !== 0) {
    console.warn(
      '  ⚠ firma VMP OMITIDA: el paquete funcionará, pero el vídeo con DRM ' +
        '(Netflix, Disney+, Prime) se quedará en negro.\n' +
        '    Instala y regístrate: pip install castlabs-evs && python -m castlabs_evs.account signup'
    )
  }
}
