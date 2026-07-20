import type { DevSettings } from '@shared/ipc'
import { JsonStore } from './jsonStore'

const DEFAULTS: DevSettings = {
  autoDevtoolsLocalhost: false,
  bridgeEnabled: false
}

/** Ajustes de desarrollo de TEK (tek-settings.json). */
export class Settings {
  private readonly store = new JsonStore<DevSettings>('tek-settings.json', DEFAULTS)

  get(): DevSettings {
    return { ...this.store.data }
  }

  set(patch: Partial<DevSettings>): DevSettings {
    // Solo claves conocidas y del tipo correcto: el patch llega por IPC.
    if (typeof patch.autoDevtoolsLocalhost === 'boolean') {
      this.store.data.autoDevtoolsLocalhost = patch.autoDevtoolsLocalhost
    }
    if (typeof patch.bridgeEnabled === 'boolean') {
      this.store.data.bridgeEnabled = patch.bridgeEnabled
    }
    this.store.save()
    return this.get()
  }

  dispose(): void {
    this.store.dispose()
  }
}
