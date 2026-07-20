import type { TekApi } from '@shared/ipc'

declare global {
  interface Window {
    tek: TekApi
  }
}

export {}
