/// <reference types="vite/client" />
import type { GitDesktopApi } from '../../preload'

declare global {
  interface Window {
    api: GitDesktopApi
  }
}

export {}
