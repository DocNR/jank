// Web Worker that verifies Nostr events off the main thread.
// One worker handles one verify request at a time (sequential message loop);
// parallelism comes from the pool spawning multiple workers.

import { verifyEvent } from 'nostr-tools/pure'
import type { Event as NEvent } from 'nostr-tools'

export type VerifyRequest = { id: number; event: NEvent }
export type VerifyResponse = { id: number; valid: boolean }

self.onmessage = (ev: MessageEvent<VerifyRequest>) => {
  const { id, event } = ev.data
  let valid = false
  try {
    valid = verifyEvent(event)
  } catch {
    valid = false
  }
  const reply: VerifyResponse = { id, valid }
  ;(self as DedicatedWorkerGlobalScope).postMessage(reply)
}
