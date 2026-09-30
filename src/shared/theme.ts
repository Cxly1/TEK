/**
 * Apariencias de TEK: Noche (la de siempre), Dia y Borgoña.
 *
 * Los colores de la interfaz viven en `renderer/src/styles/tokens.css` (un juego
 * de tokens por tema, colgado de `<html data-theme>`). Aqui solo lo que tambien
 * necesita el MAIN antes de que haya ningun CSS pintado: el fondo de las
 * ventanas y vistas nativas, y si las paginas web van en claro o en oscuro.
 */
export type ThemeName = 'noche' | 'dia' | 'borgona'

/** Orden del selector del menu (y de Enter, que va pasando al siguiente). */
export const THEME_ORDER: ThemeName[] = ['noche', 'dia', 'borgona']

export interface ThemeInfo {
  /** Como se llama en el menu. */
  label: string
  /** Las paginas con modo oscuro lo usan (prefers-color-scheme: dark). */
  dark: boolean
  /** Fondo de la ventana (= --bg-void): lo que se ve antes de que pinte nada. */
  void: string
  /** Fondo de las barras nativas, como la del mini-player (= --bg-elevated). */
  elevated: string
}

export const THEMES: Record<ThemeName, ThemeInfo> = {
  noche: { label: 'Noche', dark: true, void: '#060607', elevated: '#16181b' },
  dia: { label: 'Día', dark: false, void: '#f6f5f1', elevated: '#ffffff' },
  borgona: { label: 'Borgoña', dark: true, void: '#12070a', elevated: '#25101a' }
}

export function isThemeName(v: unknown): v is ThemeName {
  return v === 'noche' || v === 'dia' || v === 'borgona'
}
