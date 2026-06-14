import i18n from '@/i18n'
import { kinds } from 'nostr-tools'
import { toast } from 'sonner'

// Signers that require manual approval — NIP-46 remote signers (bunker /
// nostr-connect) and NIP-07 browser extensions configured to prompt — forward
// a sign request to the user's signer and wait. Without any feedback the user
// has no idea a signature is pending and may forget to approve it.
//
// We show a deliberately low-key hint: after a short delay (so instant
// auto-approvals stay silent), a small loading toast appears in the corner and
// auto-dismisses once the signature comes back. Concurrent sign requests are
// reference-counted into a single toast so frequent signing never stacks up.
//
// We also bound the wait with a timeout: if the signer never responds (offline
// bunker, closed extension popup, etc.) the request rejects instead of hanging
// forever. The window is generous so a user manually approving still makes it.

const SHOW_DELAY_MS = 1000
const TIMEOUT_MS = 30_000
const TOAST_ID = 'signer-approval-waiting'

// NIP-42 relay AUTH (kind 22242) and NIP-98 HTTP AUTH (kind 27235) are signed
// automatically in the background — relay-connection AUTH, media-upload and
// translation HTTP auth — never as a user-initiated action. They must not surface
// an approval-wait toast or be bounded by the user-approval timeout: an AUTH-gated
// relay the user never manually approves would otherwise spam the toast and reject
// every background AUTH at the 30s mark.
const BACKGROUND_SIGN_KINDS = new Set<number>([kinds.ClientAuth, kinds.HTTPAuth])

let pending = 0
let timer: ReturnType<typeof setTimeout> | null = null
let shown = false

function scheduleShow() {
  timer = setTimeout(() => {
    timer = null
    if (pending > 0) {
      shown = true
      toast.loading(i18n.t('Waiting for signer approval...'), {
        id: TOAST_ID,
        duration: Infinity
      })
    }
  }, SHOW_DELAY_MS)
}

function hide() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (shown) {
    shown = false
    toast.dismiss(TOAST_ID)
  }
}

export async function withSignerApproval<T>(
  promise: Promise<T>,
  kind?: number,
  timeout = TIMEOUT_MS
): Promise<T> {
  // Background auth signs pass straight through — no toast, no timeout.
  if (kind !== undefined && BACKGROUND_SIGN_KINDS.has(kind)) {
    return promise
  }
  if (pending === 0) {
    scheduleShow()
  }
  pending++

  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(
      () => reject(new Error(i18n.t('Signer did not respond in time'))),
      timeout
    )
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutTimer)
    pending--
    if (pending === 0) {
      hide()
    }
  }
}
