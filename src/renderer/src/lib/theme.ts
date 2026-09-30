import { useSyncExternalStore } from 'react'
import type { ThemeName } from '@shared/theme'

/**
 * El tema actual de TEK, reactivo. Lo mantiene el preload (que ademas ya lo
 * marca en <html data-theme>): esto es solo para quien lo necesita en JS, como
 * el selector del menu.
 */
export function useTheme(): ThemeName {
  return useSyncExternalStore(window.tek.theme.onChange, window.tek.theme.get)
}
