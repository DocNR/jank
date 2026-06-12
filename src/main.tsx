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
  document.documentElement.style.setProperty('--vh', `${window.innerHeight}px`)
}
window.addEventListener('resize', setVh)
window.addEventListener('orientationchange', setVh)
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
