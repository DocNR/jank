import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import path from 'path'
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'
import { BRAND } from './src/branding'
import packageJson from './package.json'
import { normalizeUrl } from './src/lib/url'
import { proxyKlipyRequest } from './src/lib/klipy-proxy'

const getGitHash = () => {
  try {
    return JSON.stringify(execSync('git rev-parse --short HEAD').toString().trim())
  } catch (error) {
    console.warn('Failed to retrieve commit hash:', error)
    return '"unknown"'
  }
}

const getAppVersion = () => {
  try {
    return JSON.stringify(packageJson.version)
  } catch (error) {
    console.warn('Failed to retrieve app version:', error)
    return '"unknown"'
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  const injectBrand: PluginOption = {
    name: 'inject-brand',
    transformIndexHtml(html: string) {
      return html
        .replaceAll('%BRAND_NAME%', BRAND.name)
        .replaceAll('%BRAND_DESCRIPTION%', BRAND.description)
        .replaceAll('%BRAND_HOMEPAGE%', BRAND.homepage)
        .replaceAll('%BRAND_KEYWORDS%', BRAND.keywords)
    }
  }

  // Dev-only: mirror the production Cloudflare Pages Function so `npm run dev`
  // can hit /api/klipy/* without exposing KLIPY_API_KEY to the client bundle.
  const klipyDevProxy: PluginOption = {
    name: 'klipy-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/klipy', async (req, res) => {
        try {
          // Connect strips the mount path, so req.url is e.g. "/gifs/search?q=cats".
          const u = new URL(req.url ?? '', 'http://localhost')
          const endpoint = u.pathname.replace(/^\/+/, '')
          let body: string | undefined
          if (req.method === 'POST') {
            body = await new Promise<string>((resolve) => {
              let d = ''
              req.on('data', (c) => (d += c))
              req.on('end', () => resolve(d))
            })
          }
          const result = await proxyKlipyRequest(
            {
              endpoint,
              search: u.searchParams,
              method: req.method ?? 'GET',
              body,
              apiKey: env.KLIPY_API_KEY
            },
            fetch
          )
          res.statusCode = result.status
          res.setHeader('content-type', result.contentType)
          res.end(result.body)
        } catch {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: 'proxy_error' }))
        }
      })
    }
  }

  const plugins: PluginOption[] = [react(), injectBrand, klipyDevProxy]

  // Dev-only bundle analyzer. Enabled with ANALYZE=1 npm run build; writes
  // dist/stats.html (treemap of what lands in each chunk). Never runs in CI/prod
  // builds, so it adds no weight to shipped output.
  if (env.ANALYZE) {
    plugins.push(
      visualizer({
        filename: 'dist/stats.html',
        template: 'treemap',
        gzipSize: true,
        brotliSize: true
      }) as PluginOption
    )
  }

  plugins.push(
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,jpg,svg}'],
        globDirectory: 'dist/',
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Persist external image fetches in the service worker so virtualizer
        // unmount/remount doesn't re-fetch from the network. Survives the
        // in-flight cancellation that the browser HTTP cache can't.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'jank-images',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 30 * 24 * 60 * 60
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true
      },
      manifest: {
        name: BRAND.name,
        short_name: BRAND.shortName,
        icons: [
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable'
          },
          {
            src: '/pwa-monochrome.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'monochrome'
          }
        ],
        start_url: '/',
        display: 'standalone',
        background_color: BRAND.backgroundColor,
        theme_color: BRAND.themeColor,
        description: BRAND.description
      }
    })
  )

  return {
    base: '/',
    define: {
      'import.meta.env.GIT_COMMIT': getGitHash(),
      'import.meta.env.APP_VERSION': getAppVersion(),
      'import.meta.env.VITE_COMMUNITY_RELAY_SETS': JSON.parse(
        JSON.stringify(env.VITE_COMMUNITY_RELAY_SETS ?? '[]')
      ),
      'import.meta.env.VITE_COMMUNITY_RELAYS': (env.VITE_COMMUNITY_RELAYS ?? '')
        .split(',')
        .map((url) => normalizeUrl(url))
        .filter(Boolean)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src')
      }
    },
    plugins,
    build: {
      rollupOptions: {
        output: {
          // Split a few large, stable, critical-path vendors into their own
          // long-cacheable chunks so they aren't re-parsed/re-downloaded with
          // every app-code change. IMPORTANT: only name vendors here that are
          // NOT lazily imported elsewhere — assigning a chunk name forces a
          // module into that (eager) chunk, which would defeat the lazy
          // boundaries for TipTap / lightbox / QR / getalby. Everything not
          // named here falls through to Rollup's automatic per-dynamic-import
          // chunking and stays lazy.
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
              return 'react-vendor'
            }
            if (/[\\/]node_modules[\\/](nostr-tools|@noble|@scure)[\\/]/.test(id)) {
              return 'nostr-vendor'
            }
          }
        }
      }
    }
  }
})
