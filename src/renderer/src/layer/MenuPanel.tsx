import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MenuItem, MenuModel, MenuPage } from '@shared/ipc'
import { Chevron, Glyph, ThemeGlyph } from './icons'
import { dropdownPos, useViewportSize } from './position'
import './menu.css'

/** Ancho del panel (px). Fijo: las paginas van lado a lado dentro de el. */
const WIDTH = 244

/** Una fila navegable con teclado: la cabecera "‹ volver" o un item. */
type Entry = { kind: 'back' } | { kind: 'item'; item: MenuItem }

function entriesOf(page: MenuPage): Entry[] {
  const out: Entry[] = page.title ? [{ kind: 'back' }] : []
  for (const group of page.groups) for (const item of group) out.push({ kind: 'item', item })
  return out
}

/**
 * El menu ☰ tal como se ve (en la capa flotante; ver LayerSurface). Aqui solo se
 * pinta y se navega; que hace cada opcion lo decide el shell (ToolsMenu), que es
 * quien arma el modelo. Se remonta en cada apertura: nace en la raiz y sin nada
 * resaltado.
 *
 * "Más opciones" y demas subpaginas se deslizan dentro del mismo panel (como el
 * menu de Firefox): las paginas van lado a lado y el alto se ajusta a la que se
 * ve. Teclado: flechas, Inicio/Fin, Enter, → entra, ← o Esc vuelve.
 */
export function MenuPanel({ model }: { model: MenuModel }): React.JSX.Element | null {
  const pages = model.pages
  const root = pages[0]
  const [pageId, setPageId] = useState(root?.id ?? '')
  const [active, setActive] = useState(-1)
  const [vpH, setVpH] = useState<number | null>(null)
  // Sin transiciones hasta el primer frame: el menu NACE con su alto, no crece
  // desde cero.
  const [ready, setReady] = useState(false)
  const pageEls = useRef(new Map<string, HTMLDivElement>())
  useViewportSize()

  const page = pages.find((p) => p.id === pageId) ?? root
  const entries = page ? entriesOf(page) : []

  const goTo = (id: string, viaKeyboard: boolean): void => {
    const target = pages.find((p) => p.id === id)
    if (!target) return
    setPageId(id)
    // Con teclado se entra resaltando el primer item (no la cabecera "volver").
    setActive(viaKeyboard ? (target.title ? 1 : 0) : -1)
  }
  const goBack = (viaKeyboard: boolean): void => {
    if (!root || !page || page.id === root.id) return
    const from = page.id
    setPageId(root.id)
    // Se vuelve con el resaltado en la entrada de la que se salio.
    setActive(
      viaKeyboard
        ? entriesOf(root).findIndex((en) => en.kind === 'item' && en.item.page === from)
        : -1
    )
  }
  const run = (en: Entry, viaKeyboard: boolean): void => {
    if (en.kind === 'back') {
      goBack(viaKeyboard)
      return
    }
    const it = en.item
    if (it.page) {
      goTo(it.page, viaKeyboard)
      return
    }
    // Un selector (la Apariencia) pasa a la siguiente opcion.
    if (it.choice) {
      const opts = it.choice.options
      const at = opts.findIndex((o) => o.id === it.choice?.value)
      const next = opts[(at + 1) % opts.length]
      if (next) choose(it, next.id)
      return
    }
    // Un interruptor deja el menu abierto (se ve el cambio); lo demas lo cierra.
    window.tek.layer.pick(it.id, it.toggle !== undefined)
  }

  // Elegir una opcion de un selector deja el menu abierto: el cambio se ve.
  function choose(it: MenuItem, option: string): void {
    window.tek.layer.pick(`${it.id}:${option}`, true)
  }

  // Alto del visor = alto de la pagina que se ve (la otra sigue a su lado).
  useLayoutEffect(() => {
    if (!page) return
    const el = pageEls.current.get(page.id)
    if (el) setVpH(el.offsetHeight)
  }, [model, page])

  useEffect(() => {
    if (ready) return
    const raf = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(raf)
  }, [ready])

  // Teclado. La capa tiene el foco mientras el menu esta abierto.
  useEffect(() => {
    if (!page) return
    const n = entries.length
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey) {
        // Un atajo con el menu abierto lo cierra, como un menu nativo.
        if (!['Control', 'Alt', 'Meta', 'Shift'].includes(e.key)) {
          e.preventDefault()
          window.tek.layer.dismiss()
        }
        return
      }
      const down = (): void => setActive((a) => (n ? (a + 1) % n : -1))
      const up = (): void => setActive((a) => (n ? (a <= 0 ? n - 1 : a - 1) : -1))
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          down()
          break
        case 'ArrowUp':
          e.preventDefault()
          up()
          break
        case 'Tab':
          e.preventDefault()
          if (e.shiftKey) up()
          else down()
          break
        case 'Home':
          e.preventDefault()
          setActive(n ? 0 : -1)
          break
        case 'End':
          e.preventDefault()
          setActive(n - 1)
          break
        case 'Enter':
        case ' ': {
          e.preventDefault()
          const en = entries[active]
          if (en) run(en, true)
          break
        }
        case 'ArrowRight': {
          const en = entries[active]
          if (en?.kind === 'item' && en.item.page) {
            e.preventDefault()
            goTo(en.item.page, true)
          }
          break
        }
        case 'ArrowLeft':
        case 'Backspace':
          if (root && page.id !== root.id) {
            e.preventDefault()
            goBack(true)
          }
          break
        case 'Escape':
          e.preventDefault()
          // En una subpagina, Esc vuelve; en la raiz, cierra.
          if (root && page.id !== root.id) goBack(true)
          else window.tek.layer.dismiss()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!page) return null

  const n = pages.length
  const at = Math.max(0, pages.indexOf(page))

  const row = (p: MenuPage, en: Entry, i: number): React.JSX.Element => {
    const here = p.id === page.id
    const props = {
      type: 'button' as const,
      tabIndex: -1,
      'data-active': here && i === active ? 'true' : undefined,
      // pointermove y no pointerenter: si el menu aparece bajo un raton quieto,
      // no se resalta nada hasta que se mueva (gotcha ya visto en TEK).
      onPointerMove: here ? () => i !== active && setActive(i) : undefined,
      onClick: here ? () => run(en, false) : undefined
    }
    if (en.kind === 'back') {
      return (
        <button key="back" className="mn-row mn-back" aria-label={`Volver (${p.title})`} {...props}>
          <Chevron dir="left" />
          <span className="mn-label">{p.title}</span>
        </button>
      )
    }
    const it = en.item
    if (it.choice) {
      const ch = it.choice
      const now = ch.options.find((o) => o.id === ch.value)
      // Una fila con botones dentro no puede ser <button>: es un grupo. El clic
      // en la fila pasa a la siguiente opcion; en un boton, elige esa.
      return (
        <div
          key={it.id}
          className="mn-row mn-choice"
          role="menuitem"
          aria-label={`${it.label}: ${now?.label ?? ''}`}
          title={it.hint}
          data-active={props['data-active']}
          onPointerMove={props.onPointerMove}
          onClick={props.onClick}
        >
          {it.icon === 'theme' ? <ThemeGlyph theme={ch.value} /> : <Glyph name={it.icon} />}
          <span className="mn-label">{it.label}</span>
          <span className="mn-seg" role="radiogroup" aria-label={it.label}>
            {ch.options.map((o) => (
              <button
                key={o.id}
                type="button"
                tabIndex={-1}
                role="radio"
                aria-checked={o.id === ch.value}
                aria-label={o.label}
                title={o.label}
                className={`mn-seg-btn ${o.id === ch.value ? 'is-on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  if (here) choose(it, o.id)
                }}
              >
                <Glyph name={o.icon} />
              </button>
            ))}
          </span>
        </div>
      )
    }
    return (
      <button
        key={it.id}
        className="mn-row"
        role={it.toggle !== undefined ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={it.toggle}
        aria-haspopup={it.page ? 'menu' : undefined}
        title={it.hint}
        {...props}
      >
        <Glyph name={it.icon} />
        <span className="mn-label">{it.label}</span>
        {it.badge ? <span className="ly-badge">{it.badge > 99 ? '99+' : it.badge}</span> : null}
        {it.dot ? <span className="mn-dot" aria-hidden /> : null}
        {it.toggle !== undefined ? (
          <span className={`mn-sw ${it.toggle ? 'is-on' : ''}`} aria-hidden />
        ) : null}
        {it.page ? <Chevron dir="right" /> : null}
      </button>
    )
  }

  return (
    <div
      className="ly-catcher"
      // Clic fuera del panel = cerrar; el clic no llega a la pagina de debajo.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) window.tek.layer.dismiss()
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="ly-panel mn"
        role="menu"
        aria-label="Herramientas"
        style={{ ...dropdownPos(model.anchor, WIDTH), width: WIDTH }}
        onPointerLeave={() => setActive(-1)}
      >
        <div className={`mn-vp ${ready ? 'is-ready' : ''}`} style={vpH != null ? { height: vpH } : undefined}>
          <div
            className={`mn-track ${ready ? 'is-ready' : ''}`}
            style={{ width: `${n * 100}%`, transform: `translateX(-${(at * 100) / n}%)` }}
          >
            {pages.map((p) => {
              const list = entriesOf(p)
              let i = p.title ? 1 : 0
              return (
                <div
                  key={p.id}
                  className="mn-page"
                  style={{ width: `${100 / n}%` }}
                  aria-hidden={p.id !== page.id}
                  ref={(el) => {
                    if (el) pageEls.current.set(p.id, el)
                    else pageEls.current.delete(p.id)
                  }}
                >
                  {p.title ? (
                    <>
                      {row(p, list[0], 0)}
                      <div className="ly-sep" role="separator" />
                    </>
                  ) : null}
                  {p.groups.map((group, gi) => (
                    <Fragment key={gi}>
                      {gi > 0 && <div className="ly-sep" role="separator" />}
                      {group.map((item) => row(p, { kind: 'item', item }, i++))}
                    </Fragment>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
