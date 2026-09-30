import { nativeTheme } from 'electron'
import { THEMES, isThemeName, type ThemeName } from '@shared/theme'
import { JsonStore } from './dev/jsonStore'

/**
 * La apariencia de TEK: Noche, Dia o Borgoña (ver shared/theme.ts).
 *
 * Vive en el main y no en el renderer porque hace falta ANTES de pintar nada:
 * el fondo de la ventana al crearla, el preload de cada superficie (la pide
 * sincrona en document-start, asi ninguna enseña un fotograma con otros
 * colores) y el tema de las paginas web. Sobrevive a la ventana, como Media.
 */
export class Appearance {
  private readonly store = new JsonStore<{ theme: ThemeName }>('tek-theme.json', {
    theme: 'noche'
  })
  /** Cambio el tema: el main lo reparte a las superficies y a las ventanas. */
  onChange: ((theme: ThemeName) => void) | null = null

  constructor() {
    this.applyToPages()
  }

  get(): ThemeName {
    const t = this.store.data.theme
    return isThemeName(t) ? t : 'noche'
  }

  set(theme: unknown): ThemeName {
    if (!isThemeName(theme) || theme === this.get()) return this.get()
    this.store.data.theme = theme
    this.store.save()
    this.applyToPages()
    this.onChange?.(theme)
    return theme
  }

  /**
   * Paginas web: en Dia, claras; en Noche y Borgoña, oscuras. Solo cambian los
   * sitios que tienen modo oscuro (siguen prefers-color-scheme); los que no, se
   * ven siempre en blanco, como en cualquier navegador.
   */
  private applyToPages(): void {
    nativeTheme.themeSource = THEMES[this.get()].dark ? 'dark' : 'light'
  }

  dispose(): void {
    this.store.dispose()
  }
}
