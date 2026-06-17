import { i18nReady } from './i18n'
import './index.css'
import './polyfill'
import './services/lightning.service'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import storage from './services/local-storage.service'

const setVh = () => {
  // iOS Safari's 100vh counts the area behind the dynamic toolbar, so the shell
  // is sized against this --vh instead (the classic workaround). We read
  // window.innerHeight, NOT visualViewport.height, on purpose: visualViewport
  // shrinks when the on-screen keyboard opens, which would collapse the whole
  // app shell. innerHeight stays put across keyboard toggles.
  document.documentElement.style.setProperty('--vh', `${window.innerHeight}px`)
}
// rAF-defer so the read happens after the browser has settled the new layout
// (innerHeight is briefly stale immediately after orientationchange on iOS).
const scheduleVh = () => requestAnimationFrame(setVh)
window.addEventListener('resize', scheduleVh)
window.addEventListener('orientationchange', scheduleVh)
// visualViewport fires on the Safari toolbar collapse/expand that a plain
// resize event can miss, keeping --vh in step as the chrome animates.
window.visualViewport?.addEventListener('resize', scheduleVh)
setVh()

const root = createRoot(document.getElementById('root')!)

// Wait for both IndexedDB hydration AND the detected locale's resource bundle
// before the first render. i18nReady never rejects (init failure still resolves
// after applying direction); hydrate failures are logged but non-fatal.
Promise.all([
  storage.hydrate().catch((err) => {
    console.error('[main] storage hydrate failed:', err)
  }),
  i18nReady.catch((err) => {
    console.error('[main] i18n init failed:', err)
  })
]).finally(() => {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
})
