/**
 * `pnpm dev:prueba` — TEK de dev sobre una COPIA de tu perfil.
 *
 * Para probar cambios con tus datos de verdad (pestanas, historial, logins,
 * contrasenas) sin arriesgar el perfil real: hay cambios que son de un solo
 * sentido (cookies cifradas, un Chromium mas nuevo que migra la base) y con
 * esto se prueban en una copia. Como el candado de instancia unica es por
 * perfil, puede correr a la vez que tu TEK instalado.
 *
 * La copia vive en %APPDATA%\tek-prueba y se REUTILIZA entre arranques (lo que
 * hagas en la prueba se queda en la prueba). `pnpm dev:prueba --nueva` la tira y
 * copia otra vez el perfil real. No se copian las caches de Chromium (se
 * regeneran solas) y un archivo bloqueado (TEK abierto) se salta con aviso.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const appdata = process.env.APPDATA
if (!appdata) {
  console.error('  ⚠ sin %APPDATA%: dev:prueba solo funciona en Windows')
  process.exit(1)
}
const real = join(appdata, 'tek')
const copia = join(appdata, 'tek-prueba')

/** Carpetas de cache de Chromium: pesan mucho y se rehacen solas. */
const SIN_COPIAR = /(^|[\\/])(Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|ShaderCache|GrShaderCache|Crashpad|blob_storage)$/i

let saltados = 0
const copiar = (src, dst) => {
  mkdirSync(dst, { recursive: true })
  for (const name of readdirSync(src)) {
    const from = join(src, name)
    const to = join(dst, name)
    let st
    try {
      st = statSync(from)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      if (SIN_COPIAR.test(relative(real, from))) continue
      copiar(from, to)
    } else {
      try {
        copyFileSync(from, to)
      } catch {
        saltados++ // bloqueado por un TEK abierto: se rehace solo
      }
    }
  }
}

if (process.argv.includes('--nueva') && existsSync(copia)) {
  rmSync(copia, { recursive: true, force: true })
}
if (!existsSync(copia)) {
  if (!existsSync(real)) {
    console.log('  • no hay perfil real que copiar: la prueba empieza con uno nuevo')
  } else {
    console.log(`  • copiando tu perfil a ${copia} (una vez; --nueva para rehacerla)…`)
    copiar(real, copia)
    if (saltados) console.log(`  ⚠ ${saltados} archivos bloqueados no se copiaron (¿TEK abierto?)`)
  }
} else {
  console.log(`  • perfil de prueba: ${copia} (--nueva para copiar otra vez el real)`)
}

const bin = join('node_modules', '.bin', process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite')
// Un .cmd en Windows solo arranca con shell; con la orden entera en un texto
// (sin lista de argumentos aparte) Node no se queja.
const child = spawn(`"${bin}" dev`, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, TEK_PERFIL: copia }
})
child.on('exit', (code) => process.exit(code ?? 0))
