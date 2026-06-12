import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    'import.meta.env.GIT_COMMIT': '"test"',
    'import.meta.env.APP_VERSION': '"0.0.0"',
    'import.meta.env.VITE_COMMUNITY_RELAY_SETS': '[]',
    'import.meta.env.VITE_COMMUNITY_RELAYS': '[]'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    // happy-dom gives module-load-time `window` access (e.g. the
    // local-storage singleton's init()) a DOM to attach to. Without it,
    // suites whose import graph touches `window` — like schemata-validation
    // via relay.ts → local-storage.service — throw `window is not defined`
    // at collection time.
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts']
  }
})
