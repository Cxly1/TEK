/**
 * Genera, UNA SOLA VEZ, la clave con la que se firman las actualizaciones de TEK.
 *
 *  - La PRIVADA queda cifrada con tu contrasena en
 *    %USERPROFILE%\.tek-release\update-key.pem. HAZ UNA COPIA (USB, gestor de
 *    contrasenas): sin ella no se pueden firmar mas versiones y los TEK
 *    instalados rechazaran las actualizaciones nuevas (habria que bajar el
 *    instalador a mano).
 *  - La PUBLICA se escribe en src/main/features/updateKey.ts: va en el repo y
 *    dentro de TEK, que con ella comprueba cada actualizacion.
 *
 * Uso, en tu PowerShell (pide contrasena; desde Claude Code no se puede):
 *   node scripts/release-key.mjs
 * `--forzar` sustituye una clave existente (los TEK ya instalados solo
 * aceptaran actualizaciones firmadas con la clave que llevan dentro).
 */
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const dir = join(homedir(), '.tek-release')
const keyFile = join(dir, 'update-key.pem')
const tsFile = fileURLToPath(new URL('../src/main/features/updateKey.ts', import.meta.url))

/** Pregunta sin enseñar lo que se escribe. */
const preguntar = (texto) =>
  new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (s) => {
      if (s.includes(texto)) rl.output.write(texto)
    }
    rl.question(texto, (r) => {
      rl.close()
      process.stdout.write('\n')
      resolve(r)
    })
  })

if (existsSync(keyFile) && !process.argv.includes('--forzar')) {
  console.error(`Ya hay una clave en ${keyFile}. Si de verdad quieres otra: --forzar`)
  process.exit(1)
}
if (!process.stdin.isTTY) {
  console.error('Esto pide una contraseña: ejecútalo en tu propia terminal.')
  process.exit(1)
}

const pass = await preguntar('Contraseña para la clave de firma (mín. 10): ')
const otra = await preguntar('Repítela: ')
if (pass !== otra) {
  console.error('No coinciden.')
  process.exit(1)
}
if (pass.length < 10) {
  console.error('Muy corta: al menos 10 caracteres.')
  process.exit(1)
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
mkdirSync(dir, { recursive: true })
writeFileSync(
  keyFile,
  privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: pass }),
  { mode: 0o600 }
)
const pub = String(publicKey.export({ type: 'spki', format: 'pem' })).trim()
writeFileSync(
  tsFile,
  `/**
 * Clave PUBLICA con la que TEK comprueba que una actualizacion la firmo quien
 * publica TEK, y no cualquiera que llegue a la cuenta (o al token) de GitHub.
 *
 * La genero \`node scripts/release-key.mjs\`. La privada vive cifrada con
 * contrasena en %USERPROFILE%\\.tek-release y NUNCA en el repo. Cada instalador
 * se firma con \`node scripts/sign-update.mjs\` y su \`.sig\` se sube a la release
 * junto al .exe (ver Updater.verifyOwnSignature).
 */
export const UPDATE_PUBLIC_KEY = \`${pub}\`
`
)
console.log(`Clave privada (cifrada): ${keyFile}`)
console.log(`Clave publica escrita en: ${tsFile}`)
console.log('HAZ UNA COPIA de la privada y guarda la contraseña: sin ellas no se puede firmar.')
