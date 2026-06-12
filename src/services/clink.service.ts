import { TNoffer } from '@/lib/clink'
import dayjs from 'dayjs'
import { Event, finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { Relay } from 'nostr-tools/relay'

export const CLINK_OFFER_KIND = 21001
const RESPONSE_TIMEOUT_MS = 30_000
// How long to keep listening for the service's payment receipt after the
// invoice arrives. External-wallet payments are invisible to the client; the
// receipt (Lightning.Pub sends NIP-44 {"res":"ok"} e-tagged to our request
// on settlement) is the only paid signal we get.
const RECEIPT_TIMEOUT_MS = 5 * 60_000

export type TClinkFailure = {
  error: string
  /** Which leg failed — drives the user-facing message */
  reason: 'connect' | 'publish' | 'timeout' | 'aborted' | 'service' | 'internal'
  /** CLINK error code 1-5, when the service returned a structured error */
  code?: number
  /** Acceptable amount range (code 5) */
  range?: { min?: number; max?: number }
  /** Replacement noffer string (code 3) */
  latest?: string
}
export type TClinkInvoiceResult = { bolt11: string } | TClinkFailure

export function isClinkFailure(result: TClinkInvoiceResult): result is TClinkFailure {
  return !('bolt11' in result)
}

/**
 * CLINK Offers payment round trip
 * (https://github.com/shocknet/CLINK/blob/master/specs/clink-offers.md):
 * send a NIP-44-encrypted kind-21001 request to the offer's relay, get back
 * a BOLT11 invoice (or a structured error) from the receiving service.
 *
 * The whole exchange runs over a DEDICATED relay connection with a
 * single-use ephemeral key — deliberately NOT client.service's pool. The
 * offer's relay URL is attacker-controlled (it comes from note content), and
 * the pool's NIP-42 auth-required fallback signs with the ACTIVE ACCOUNT's
 * key, which would let a hostile relay link the user's real identity to a
 * payment the ephemeral key exists to unlink. Here AUTH challenges are
 * answered with the ephemeral key only.
 */
class ClinkService {
  static instance: ClinkService

  /** Seam for tests */
  connect: (url: string) => Promise<Relay> = (url) =>
    // The connection idles between the invoice response and the payment
    // receipt (the user is off paying in a wallet — minutes, not seconds).
    // Ping keeps proxy idle-timeouts from killing the socket silently;
    // reconnect re-fires the REQ if it dies anyway, shrinking the deaf
    // window for the (ephemeral, never-stored) receipt event.
    Relay.connect(url, { enablePing: true, enableReconnect: true })

  constructor() {
    if (!ClinkService.instance) {
      ClinkService.instance = this
    }
    return ClinkService.instance
  }

  async fetchInvoice(
    offer: TNoffer,
    {
      amountSats,
      signal,
      onPaid
    }: {
      amountSats?: number
      signal?: AbortSignal
      /**
       * When provided, the connection stays open after the invoice resolves
       * (up to 5 min, or until `signal` aborts) and fires once if the service
       * sends a payment receipt for this request.
       */
      onPaid?: () => void
    } = {}
  ): Promise<TClinkInvoiceResult> {
    if (signal?.aborted) {
      return { error: 'aborted', reason: 'aborted' }
    }

    const ephemeralKey = generateSecretKey()
    const ephemeralPubkey = getPublicKey(ephemeralKey)

    let request: Event
    let conversationKey: Uint8Array
    try {
      conversationKey = nip44.utils.getConversationKey(ephemeralKey, offer.pubkey)
      const payload: { offer: string; amount_sats?: number } = { offer: offer.offerId }
      if (amountSats !== undefined) {
        payload.amount_sats = amountSats
      }
      request = finalizeEvent(
        {
          kind: CLINK_OFFER_KIND,
          created_at: dayjs().unix(),
          tags: [
            ['p', offer.pubkey],
            ['clink_version', '1']
          ],
          content: nip44.encrypt(JSON.stringify(payload), conversationKey)
        },
        ephemeralKey
      )
      if (request.pubkey !== ephemeralPubkey) {
        return { error: 'signed with an unexpected key', reason: 'internal' }
      }
    } catch {
      return { error: 'could not build the payment request', reason: 'internal' }
    }

    let relay: Relay
    try {
      relay = await this.connect(offer.relay)
    } catch {
      return { error: 'could not reach the offer relay', reason: 'connect' }
    }

    const signAuth = (evt: Parameters<NonNullable<Relay['onauth']>>[0]) =>
      Promise.resolve(finalizeEvent(evt, ephemeralKey))
    relay.onauth = signAuth

    return await new Promise<TClinkInvoiceResult>((resolve) => {
      let settled = false
      let closed = false
      let invoiceEventId: string | undefined
      let subCloser: { close: () => void } | undefined
      let timer: ReturnType<typeof setTimeout>

      const cleanup = () => {
        if (closed) return
        closed = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        try {
          subCloser?.close()
        } catch {
          // already closed
        }
        try {
          relay.close()
        } catch {
          // already closed
        }
      }

      const settle = (result: TClinkInvoiceResult) => {
        if (settled) return
        settled = true
        resolve(result)
      }

      const finish = (result: TClinkInvoiceResult) => {
        settle(result)
        cleanup()
      }

      timer = setTimeout(
        () => finish({ error: 'no response from the payment service', reason: 'timeout' }),
        RESPONSE_TIMEOUT_MS
      )
      const onAbort = () => finish({ error: 'aborted', reason: 'aborted' })
      signal?.addEventListener('abort', onAbort)
      // An abort fired between fetchInvoice entry and this registration
      // (e.g. during the connect await) would otherwise be lost
      if (signal?.aborted) {
        onAbort()
        return
      }

      try {
        // Subscribe on the open socket BEFORE publishing: kind 21001 is
        // ephemeral (not stored), so a response that beats the REQ is lost
        subCloser = relay.subscribe(
          [{ kinds: [CLINK_OFFER_KIND], authors: [offer.pubkey], '#p': [ephemeralPubkey] }],
          {
            onevent: (response: Event) => {
              try {
                if (response.pubkey !== offer.pubkey) return
                if (!response.tags.some((t) => t[0] === 'e' && t[1] === request.id)) return
                // The spec says responses carry ["clink_version","1"], but the
                // reference implementation (Lightning.Pub) omits it — verified
                // live against strfry.shock.network 2026-06-11. Accept absent;
                // reject only an explicit unsupported version. Correlation
                // safety comes from the author + e-tag + signature checks.
                const version = response.tags.find((t) => t[0] === 'clink_version')?.[1]
                if (version !== undefined && version !== '1') return
                // The relay layer verifies signatures, but this check is the
                // root of the anti-spoofing model (the relay itself is
                // untrusted and can fabricate any JSON) — assert it locally
                // so a transport refactor can't silently drop it.
                if (!verifyEvent(response)) return

                if (response.id === invoiceEventId) return

                const parsed = JSON.parse(nip44.decrypt(response.content, conversationKey))
                if (settled) {
                  // Invoice already delivered — we are only listening for the
                  // payment receipt now (Lightning.Pub sends {"res":"ok"})
                  if (parsed?.res === 'ok') {
                    onPaid?.()
                    cleanup()
                  }
                  return
                }
                if (typeof parsed?.bolt11 === 'string' && parsed.bolt11.length > 0) {
                  if (onPaid) {
                    // Resolve the invoice but keep the connection open to
                    // catch the settlement receipt
                    invoiceEventId = response.id
                    settle({ bolt11: parsed.bolt11 })
                    clearTimeout(timer)
                    timer = setTimeout(cleanup, RECEIPT_TIMEOUT_MS)
                  } else {
                    finish({ bolt11: parsed.bolt11 })
                  }
                } else if (parsed?.error !== undefined || parsed?.code !== undefined) {
                  finish({
                    error: String(parsed.error ?? 'unknown error'),
                    reason: 'service',
                    code: typeof parsed.code === 'number' ? parsed.code : undefined,
                    range:
                      parsed.range && typeof parsed.range === 'object'
                        ? { min: parsed.range.min, max: parsed.range.max }
                        : undefined,
                    latest: typeof parsed.latest === 'string' ? parsed.latest : undefined
                  })
                }
                // Anything else (e.g. a payment receipt) is not the invoice
                // response — keep waiting for one until the timeout
              } catch {
                // Undecryptable or malformed event from the (untrusted)
                // relay — ignore it and keep waiting
              }
            }
          }
        )
      } catch {
        finish({ error: 'could not subscribe to the offer relay', reason: 'connect' })
        return
      }

      const publish = async () => {
        try {
          await relay.publish(request)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (/auth-required/i.test(message)) {
            // The challenge usually arrives at connect; auth with the
            // ephemeral key and retry once
            try {
              await relay.auth(signAuth)
              await relay.publish(request)
              return
            } catch {
              // fall through to the publish failure
            }
          }
          finish({ error: 'the offer relay rejected the request', reason: 'publish' })
        }
      }
      void publish()
    })
  }
}

const instance = new ClinkService()
export default instance
