import { useId } from 'react'
import type { MenuIcon } from '@shared/ipc'

/** Iconos de los paneles que no salen en el menu ☰. */
type PanelIcon =
  | 'file'
  | 'file-audio'
  | 'file-video'
  | 'file-image'
  | 'file-text'
  | 'file-archive'
  | 'folder'
  | 'x'
  | 'search'
  | 'brush'

export type GlyphName = MenuIcon | PanelIcon

/** Destello de cuatro puntas: el icono de Borgoña. */
const SPARK =
  'M12 3l1.9 5.6c.2.6.6 1 1.2 1.2L21 12l-5.9 1.9c-.6.2-1 .6-1.2 1.2L12 21l-1.9-5.9c-.2-.6-.6-1-1.2-1.2L3 12l5.9-1.9c.6-.2 1-.6 1.2-1.2Z'

const FILE_BODY = <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
const FILE_FOLD = <path d="M14 2v4a2 2 0 0 0 2 2h4" />

/**
 * Iconos de la capa flotante: juego Lucide (ISC), los mismos trazos que el
 * megafono y el bicho de la barra. Inline para que hereden el color del tema
 * sin dependencias.
 */
const SHAPES: Record<GlyphName, React.JSX.Element> = {
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </>
  ),
  key: (
    <>
      <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
      <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
    </>
  ),
  zap: (
    <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
  ),
  sparkles: (
    <>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  gamepad: (
    <>
      <line x1="6" x2="10" y1="11" y2="11" />
      <line x1="8" x2="8" y1="9" y2="13" />
      <line x1="15" x2="15.01" y1="12" y2="12" />
      <line x1="18" x2="18.01" y1="10" y2="10" />
      <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>
  ),
  spark: <path d={SPARK} />,
  // Solo por completar el juego: la fila de Apariencia pinta ThemeGlyph.
  theme: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  file: (
    <>
      {FILE_BODY}
      {FILE_FOLD}
    </>
  ),
  'file-audio': (
    <>
      <path d="M17.5 22h.5a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3" />
      {FILE_FOLD}
      <path d="M2 19a2 2 0 1 1 4 0v1a2 2 0 1 1-4 0v-4a6 6 0 0 1 12 0v4a2 2 0 1 1-4 0v-1a2 2 0 1 1 4 0" />
    </>
  ),
  'file-video': (
    <>
      {FILE_BODY}
      {FILE_FOLD}
      <path d="m10 11 5 3-5 3v-6Z" />
    </>
  ),
  'file-image': (
    <>
      {FILE_BODY}
      {FILE_FOLD}
      <circle cx="10" cy="12" r="2" />
      <path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22" />
    </>
  ),
  'file-text': (
    <>
      {FILE_BODY}
      {FILE_FOLD}
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  'file-archive': (
    <>
      <path d="M10 12v-1" />
      <path d="M10 18v-2" />
      <path d="M10 7V6" />
      {FILE_FOLD}
      <path d="M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .274 1.01" />
      <circle cx="10" cy="20" r="2" />
    </>
  ),
  folder: (
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  // Cepillo de limpiar ("brush-cleaning"): los botones de limpiar/borrar van
  // solo con icono, sin texto.
  brush: (
    <>
      <path d="m16 22-1-4" />
      <path d="M19 14a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2h-3a1 1 0 0 1-1-1V4a2 2 0 0 0-4 0v5a1 1 0 0 1-1 1H6a2 2 0 0 0-2 2v1a1 1 0 0 0 1 1" />
      <path d="M19 14H5l-1.973 6.767A1 1 0 0 0 4 22h16a1 1 0 0 0 .973-1.233z" />
      <path d="m8 22 1-4" />
    </>
  )
}

export function Glyph({ name, className }: { name: GlyphName; className?: string }): React.JSX.Element {
  return (
    <svg className={`ly-ico ${className ?? ''}`} viewBox="0 0 24 24" aria-hidden>
      {SHAPES[name]}
    </svg>
  )
}

/**
 * El icono de la Apariencia, que se TRANSFORMA al cambiar de tema: la luna se
 * abre en sol (el mordisco se va y salen los rayos) y el sol se vuelve destello.
 * Todo por CSS (menu.css, .mn-morph[data-s]): el SVG no se cambia, se anima.
 */
export function ThemeGlyph({ theme }: { theme: string }): React.JSX.Element {
  const mask = `mn-bite-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`
  return (
    <svg className="ly-ico mn-morph" data-s={theme} viewBox="0 0 24 24" aria-hidden>
      <mask id={mask}>
        <rect x="-10" y="-10" width="44" height="44" fill="#fff" />
        <circle className="mn-bite" cx="17" cy="7" r="7" fill="#000" />
      </mask>
      <circle
        className="mn-body"
        cx="12"
        cy="12"
        r="8"
        fill="currentColor"
        stroke="none"
        mask={`url(#${mask})`}
      />
      <g className="mn-rays">
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </g>
      <path className="mn-spark" d={SPARK} fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Chevron de "entra aqui" (›) y de "volver" (‹). */
export function Chevron({ dir }: { dir: 'left' | 'right' }): React.JSX.Element {
  return (
    <svg className="ly-ico ly-chev" viewBox="0 0 24 24" aria-hidden>
      <path d={dir === 'right' ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6'} />
    </svg>
  )
}

const AUDIO = /\.(mp3|wav|flac|m4a|aac|ogg|opus|wma|aiff?)$/i
const VIDEO = /\.(mp4|mkv|webm|mov|avi|wmv|m4v|mpe?g)$/i
const IMAGE = /\.(jpe?g|png|gif|webp|svg|bmp|ico|heic|avif|tiff?)$/i
const ARCHIVE = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|iso)$/i
const TEXT = /\.(pdf|docx?|odt|rtf|txt|md|csv|xlsx?|pptx?|json|xml|html?)$/i

/** Icono por tipo de archivo (por la extension). */
export function fileGlyph(filename: string): GlyphName {
  if (AUDIO.test(filename)) return 'file-audio'
  if (VIDEO.test(filename)) return 'file-video'
  if (IMAGE.test(filename)) return 'file-image'
  if (ARCHIVE.test(filename)) return 'file-archive'
  if (TEXT.test(filename)) return 'file-text'
  return 'file'
}
