/**
 * Firma un instalador de TEK con la clave de scripts/release-key.mjs.
 *
 *   node scripts/sign-update.mjs release/TEK-0.6.0-setup.exe
 *
 * Escribe `TEK-0.6.0-setup.exe.sig` al lado: SUBELO a la release junto al .exe
 * y a latest.yml. Sin el, los TEK instalados rechazan la actualizacion (es justo
 * lo que protege la firma: quien no tiene la clave no puede colar un instalador).
 *
 * Antes de firmar comprueba que el sha512 del .exe es el de release/latest.yml
 * (el que anunciara la release) y despues verifica la firma con la clave
 * publica que lleva TEK dentro (src/main/features/updateKey.ts).
 *
 * MANTENER EN SYNC con Updater.verifyOwnSignature (formato del mensaje).
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const file = process.argv[2]
if (!file || !existsSync(file)) {
  console.error('Uso: node scripts/sign-update.mjs release/TEK-X.Y.Z-setup.exe')
  process.exit(1)
}
const m = /^TEK-(\d+\.\d+\.\d+)-setup\.exe$/.exec(basename(file))
if (!m) {
  console.error('El nombre tiene que ser TEK-X.Y.Z-setup.exe (el de electron-builder).')
  process.exit(1)
}
const version = m[1]
const keyFile = join(homedir(), '.tek-release', 'update-key.pem')
if (!existsSync(keyFile)) {
  console.error(`No hay clave en ${keyFile}: genérala una vez con node scripts/release-key.mjs`)
  process.exit(1)
}

const sha512 = createHash('sha512').update(readFileSync(file)).digest('base64')
const latest = join(dirname(file), 'latest.yml')
if (existsSync(latest)) {
  const y = readFileSync(latest, 'utf8')
  if (!y.includes(`version: ${version}`) || !y.includes(sha512)) {
    console.error('Este .exe no es el que anuncia release/latest.yml (version o sha512 distintos).')
    process.exit(1)
  }
}

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
if (!process.stdin.isTTY) {
  console.error('Esto pide la contraseña de la clave: ejecútalo en tu propia terminal.')
  process.exit(1)
}
const pass = await preguntar('Contraseña de la clave de firma: ')
let key
try {
  key = createPrivateKey({ key: readFileSync(keyFile), passphrase: pass })
} catch {
  console.error('Contraseña incorrecta (o clave dañada).')
  process.exit(1)
}

const message = Buffer.from(`tek-update-v1\n${version}\n${sha512}\n`)
const sig = sign(null, message, key).toString('base64')

// La comprobacion de TEK, aqui mismo: con la clave publica que lleva dentro.
const ts = readFileSync(
  fileURLToPath(new URL('../src/main/features/updateKey.ts', import.meta.url)),
  'utf8'
)
const pem = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/.exec(ts)?.[0]
if (!pem) {
  console.error('src/main/features/updateKey.ts no tiene clave publica: TEK no podria comprobar esto.')
  process.exit(1)
}
if (!verify(null, message, createPublicKey(pem), Buffer.from(sig, 'base64'))) {
  console.error('La firma NO verifica con la clave publica de TEK (¿otra clave?). No se escribe nada.')
  process.exit(1)
}

const out = `${file}.sig`
writeFileSync(out, JSON.stringify({ format: 'tek-update-v1', version, sha512, sig }, null, 2))
console.log(`Firmado: ${out}`)
console.log('Súbelo a la release junto al .exe y latest.yml.')
