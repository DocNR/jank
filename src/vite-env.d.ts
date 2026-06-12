/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite/client" />
import { TNip07 } from '@/types'

declare global {
  interface Window {
    nostr?: TNip07
  }
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
