// Worker pool that offloads Schnorr signature verification.
// API: verify(event) -> Promise<boolean>. Internally round-robins postMessage
// across N workers. Falls back to synchronous main-thread verify if workers
// can't be spawned (CSP, ancient browser, page-load race). Idempotent dispose().

import { verifyEvent as syncVerifyEvent } from 'nostr-tools/pure'
import type { Event as NEvent } from 'nostr-tools'
import type { VerifyRequest, VerifyResponse } from '@/workers/verifier.worker'

type Resolver = (valid: boolean) => void

export type VerificationPoolOptions = {
  /** Inject a verifier for tests. Skips real workers entirely. */
  injectedVerifier?: (event: NEvent) => boolean
  /** Force main-thread fallback. Used to exercise the degraded path in tests. */
  forceMainThread?: boolean
  /** Override worker count. Default: min(hardwareConcurrency - 1, 4). */
  workerCount?: number
}

export interface VerificationPool {
  verify(event: NEvent): Promise<boolean>
  preload(): void
  dispose(): void
}

function pickWorkerCount(): number {
  const hc = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4
  return Math.max(1, Math.min(hc - 1, 4))
}

export function createVerificationPool(opts: VerificationPoolOptions = {}): VerificationPool {
  const injected = opts.injectedVerifier
  const forceMain = opts.forceMainThread === true
  const count = opts.workerCount ?? pickWorkerCount()

  // Fast path 1: explicit injected verifier (tests).
  if (injected) {
    return {
      verify: async (event) => injected(event),
      preload: () => {},
      dispose: () => {}
    }
  }

  // Fast path 2: forced main-thread (tests + production fallback when Worker fails).
  if (forceMain) {
    return {
      verify: async (event) => {
        try {
          return syncVerifyEvent(event)
        } catch {
          return false
        }
      },
      preload: () => {},
      dispose: () => {}
    }
  }

  // Real path: spawn workers.
  let nextRequestId = 1
  const pending = new Map<number, Resolver>()
  const workers: { worker: Worker; inFlight: number }[] = []
  let disposed = false
  let degraded = false

  const spawnOne = (): { worker: Worker; inFlight: number } | null => {
    try {
      const w = new Worker(new URL('@/workers/verifier.worker.ts', import.meta.url), {
        type: 'module'
      })
      const slot = { worker: w, inFlight: 0 }
      w.onmessage = (ev: MessageEvent<VerifyResponse>) => {
        const { id, valid } = ev.data
        const resolve = pending.get(id)
        if (resolve) {
          pending.delete(id)
          slot.inFlight = Math.max(0, slot.inFlight - 1)
          resolve(valid)
        }
      }
      w.onerror = (e) => {
        console.warn('[verification-pool] worker error, restarting:', e.message)
        // Fail all pending conservatively → drop those events.
        // With a shared `pending` map keyed by global request id, we can't tell
        // which were assigned to this worker. Simpler model: fail-all then
        // respawn. Acceptable because worker crashes are extremely rare.
        for (const r of pending.values()) r(false)
        pending.clear()
        try {
          slot.worker.terminate()
        } catch {
          // ignore
        }
        const replacement = spawnOne()
        if (replacement) {
          slot.worker = replacement.worker
          slot.inFlight = 0
        } else {
          degraded = true
        }
      }
      return slot
    } catch (err) {
      console.warn('[verification-pool] cannot spawn Worker, falling back to main thread:', err)
      degraded = true
      return null
    }
  }

  const preload = () => {
    if (disposed || workers.length > 0) return
    for (let i = 0; i < count; i++) {
      const slot = spawnOne()
      if (slot) workers.push(slot)
    }
    if (workers.length === 0) degraded = true
  }

  const verify = async (event: NEvent): Promise<boolean> => {
    if (disposed) return false
    if (degraded) {
      try {
        return syncVerifyEvent(event)
      } catch {
        return false
      }
    }
    if (workers.length === 0) preload()
    if (workers.length === 0 || degraded) {
      try {
        return syncVerifyEvent(event)
      } catch {
        return false
      }
    }
    // Pick least-loaded worker.
    let pick = workers[0]
    for (const w of workers) {
      if (w.inFlight < pick.inFlight) pick = w
    }
    const id = nextRequestId++
    pick.inFlight += 1
    const req: VerifyRequest = { id, event }
    const ret = new Promise<boolean>((resolve) => {
      pending.set(id, resolve)
    })
    pick.worker.postMessage(req)
    return ret
  }

  const dispose = () => {
    disposed = true
    for (const w of workers) {
      try {
        w.worker.terminate()
      } catch {
        // ignore
      }
    }
    workers.length = 0
    for (const r of pending.values()) r(false)
    pending.clear()
  }

  return { verify, preload, dispose }
}

// Singleton for app-wide use. Test code should use createVerificationPool directly
// (with an injected verifier) instead of importing this default.
const verificationPool: VerificationPool = createVerificationPool()
export default verificationPool
