/**
 * Firma VMP de PRODUCCION para el Electron de desarrollo (node_modules/electron/dist).
 *
 * Widevine solo le da licencias de produccion a un binario con firma VMP de
 * produccion. El Electron de castlabs viene con una firma de DESARROLLO, que solo
 * vale contra servidores de prueba: con ella Spotify se salta canciones (la
 * licencia de cada pista falla y el reproductor pasa a la siguiente; la que llega
 * a sonar se calla a los pocos segundos) y Netflix da E100. El instalador no
 * sufre esto: lo firma `build/afterSign.cjs`.
 *
 * La firma de dev se PIERDE SOLA: pnpm guarda `dist/` (lo que baja el postinstall
 * de electron) en su store y, cada vez que re-enlaza el paquete (un `pnpm install`
 * o `add` que toque el arbol), lo restaura con la firma ORIGINAL de desarrollo.
 * Asi se rompio el 2026-08-18 sin que nadie tocara Electron, y el sintoma se
 * confundio durante semanas con un fallo del defuser de Spotify.
 *
 * Corre en `postinstall` y antes de `pnpm dev`:
 *  1. Mira la firma (1.4 KB, instantaneo). Las de desarrollo llevan en su
 *     certificado la extension de Google 1.3.6.1.4.1.11129.4.1.2 (asi las
 *     distingue castlabs); las de produccion no.
 *  2. Si no es de produccion, re-firma con EVS en modo no interactivo (-n). Si la
 *     firma de este binario ya esta en la cache local de EVS, ni red ni
 *     contrasena; si no, sube el binario con la sesion guardada.
 *  3. Si no se puede (sin Python, sin castlabs-evs o sin sesion), avisa y sigue.
 *
 * Nunca falla (exit 0): quien clone el repo sin cuenta de EVS tiene que poder
 * instalar y arrancar igual, solo que sin DRM de produccion.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIST = fileURLToPath(new URL('../node_modules/electron/dist', import.meta.url))
const EXE = join(DIST, 'electron.exe')
const SIG = join(DIST, 'electron.exe.sig')

// OID 1.3.6.1.4.1.11129.4.1.2 codificado en DER.
const DEV_MARK = Buffer.from([0x2b, 0x06, 0x01, 0x04, 0x01, 0xd6, 0x79, 0x04, 0x01, 0x02])

/** 'prod' | 'dev' | 'none' */
const firma = () => {
  if (!existsSync(SIG)) return 'none'
  return readFileSync(SIG).includes(DEV_MARK) ? 'dev' : 'prod'
}

const avisar = (por) => {
  console.warn(
    `  ⚠ firma VMP de Electron (dev): ${por}. TEK arranca, pero Spotify se saltará\n` +
      '    canciones y Netflix dará E100 (Widevine les niega la licencia). Arreglo, una vez\n' +
      '    por versión de Electron:\n' +
      '      pip install castlabs-evs   (cuenta gratis: python -m castlabs_evs.account signup)\n' +
      '      python -m castlabs_evs.vmp sign-pkg node_modules/electron/dist'
  )
}

// El DRM de castlabs con VMP en Windows es lo unico que TEK empaqueta.
if (process.platform !== 'win32' || !existsSync(EXE)) process.exit(0)

const antes = firma()
if (antes === 'prod') process.exit(0)

console.log(
  `  • firma VMP de Electron (dev): ${antes === 'dev' ? 'de DESARROLLO' : 'no hay'} → firmando con castlabs EVS`
)

// El .sig es un HARD LINK al archivo del store de pnpm (direccionado por su
// hash). EVS escribe la firma en sitio, asi que sin soltarlo antes firmariamos
// tambien la copia del store y la dejariamos corrupta. Leer, borrar el enlace y
// reescribir deja un archivo propio con el mismo contenido.
if (antes === 'dev') {
  try {
    const b = readFileSync(SIG)
    unlinkSync(SIG)
    writeFileSync(SIG, b)
  } catch (err) {
    avisar(`no se pudo preparar el .sig (${err.code ?? err.message}; ¿TEK de dev abierto?)`)
    process.exit(0)
  }
}

const r = spawnSync('python', ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg', DIST], {
  stdio: 'inherit',
  shell: false
})

if (!r.error && r.status === 0 && firma() === 'prod') {
  console.log('  • firma VMP de producción puesta: Spotify y Netflix reproducen en dev')
} else {
  avisar(r.error ? 'Python no está instalado' : 'no se pudo firmar')
}
process.exit(0)
