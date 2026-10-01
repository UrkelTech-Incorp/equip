/// <reference types="vite/client" />

import type { EquipApi } from '../../preload'

declare global {
  interface Window {
    equip: EquipApi
  }
}

export {}
