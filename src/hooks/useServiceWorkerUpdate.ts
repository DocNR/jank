import { markIntentionalReload } from '@/lib/reload-coordinator'
import { useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { shouldCheckForUpdate } from './useServiceWorkerUpdate.helpers'

const POLL_INTERVAL_MS = 5 * 60 * 1000
const FOCUS_THROTTLE_MS = 60 * 1000

export function useServiceWorkerUpdate(): {
  needRefresh: boolean
  reload: () => void
} {
  const registrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined)
  const lastCheckRef = useRef<number>(0)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      registrationRef.current = registration
    }
  })

  useEffect(() => {
    const check = () => {
      const now = Date.now()
      if (!shouldCheckForUpdate(lastCheckRef.current, now, FOCUS_THROTTLE_MS)) return
      lastCheckRef.current = now
      registrationRef.current?.update().catch(() => {})
    }
    const interval = setInterval(check, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // The actual reload is driven asynchronously by workbox's `controlling`
  // listener (`window.location.reload()`) once the waiting SW takes control.
  // Mark it intentional first so the unsaved-deck `beforeunload` guard stands
  // down and the reload isn't interrupted by the native "Leave site?" prompt.
  return {
    needRefresh,
    reload: () => {
      markIntentionalReload()
      updateServiceWorker(true)
    }
  }
}
