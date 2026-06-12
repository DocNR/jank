import { NofferPriceType, TNoffer } from '@/lib/clink'
import { Event, finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { v2 as nip44 } from 'nostr-tools/nip44'
import { afterEach, describe, expect, it, vi } from 'vitest'
import clink, { isClinkFailure } from './clink.service'

const serviceKey = generateSecretKey()
const servicePubkey = getPublicKey(serviceKey)

const OFFER: TNoffer = {
  pubkey: servicePubkey,
  relay: 'wss://fake.relay',
  offerId: 'test-offer',
  priceType: NofferPriceType.Spontaneous
}

type FakeSubParams = { onevent: (evt: Event) => void }

/**
 * A fake relay whose publish() side plays the CLINK receiving service:
 * decrypt the request with the service key, hand the decrypted payload to
 * `respond`, and emit whatever events it returns back through the
 * subscription — exercising the real NIP-44 round trip end to end.
 */
function fakeRelay({
  respond,
  publishError
}: {
  respond?: (payload: { offer: string; amount_sats?: number }, request: Event) => Event[]
  publishError?: string
}) {
  let subParams: FakeSubParams | undefined
  const relay = {
    onauth: undefined as unknown,
    closed: false,
    published: [] as Event[],
    subscribe(_filters: unknown, params: FakeSubParams) {
      subParams = params
      return { close: () => {} }
    },
    async publish(request: Event) {
      this.published.push(request)
      if (publishError) {
        throw new Error(publishError)
      }
      const conversationKey = nip44.utils.getConversationKey(serviceKey, request.pubkey)
      const payload = JSON.parse(nip44.decrypt(request.content, conversationKey))
      for (const evt of respond?.(payload, request) ?? []) {
        subParams?.onevent(evt)
      }
      return 'ok'
    },
    async auth() {
      throw new Error('no challenge')
    },
    close() {
      this.closed = true
    }
  }
  return relay
}

function serviceResponse(
  request: Event,
  payload: unknown,
  {
    signer = serviceKey,
    tags
  }: {
    signer?: Uint8Array
    tags?: string[][]
  } = {}
): Event {
  const conversationKey = nip44.utils.getConversationKey(serviceKey, request.pubkey)
  return finalizeEvent(
    {
      kind: 21001,
      created_at: request.created_at + 1,
      tags: tags ?? [
        ['p', request.pubkey],
        ['e', request.id],
        ['clink_version', '1']
      ],
      content: nip44.encrypt(JSON.stringify(payload), conversationKey)
    },
    signer
  )
}

function useFakeRelay(relay: ReturnType<typeof fakeRelay>) {
  clink.connect = vi.fn(async () => relay as never)
  return relay
}

const realConnect = clink.connect

afterEach(() => {
  clink.connect = realConnect
  vi.useRealTimers()
})

describe('clink.service fetchInvoice', () => {
  it('returns the bolt11 from a valid encrypted response', async () => {
    const relay = useFakeRelay(
      fakeRelay({ respond: (_payload, req) => [serviceResponse(req, { bolt11: 'lnbc100n1fake' })] })
    )
    const result = await clink.fetchInvoice(OFFER, { amountSats: 100 })
    expect(result).toEqual({ bolt11: 'lnbc100n1fake' })
    expect(relay.closed).toBe(true)
  })

  it('sends offer id and amount_sats in the encrypted request payload', async () => {
    let seenPayload: { offer: string; amount_sats?: number } | undefined
    useFakeRelay(
      fakeRelay({
        respond: (payload, req) => {
          seenPayload = payload
          return [serviceResponse(req, { bolt11: 'lnbc1fake' })]
        }
      })
    )
    await clink.fetchInvoice(OFFER, { amountSats: 21 })
    expect(seenPayload).toEqual({ offer: 'test-offer', amount_sats: 21 })
  })

  it('tags the request with the receiver and clink_version 1', async () => {
    const relay = useFakeRelay(
      fakeRelay({ respond: (_p, req) => [serviceResponse(req, { bolt11: 'lnbc1fake' })] })
    )
    await clink.fetchInvoice(OFFER, { amountSats: 1 })
    const request = relay.published[0]
    expect(request.kind).toBe(21001)
    expect(request.tags).toContainEqual(['p', servicePubkey])
    expect(request.tags).toContainEqual(['clink_version', '1'])
    // ephemeral key: never an account key, fresh per request
    expect(request.pubkey).not.toBe(servicePubkey)
  })

  it('uses a fresh ephemeral key per request', async () => {
    const relay = useFakeRelay(
      fakeRelay({ respond: (_p, req) => [serviceResponse(req, { bolt11: 'lnbc1fake' })] })
    )
    await clink.fetchInvoice(OFFER, { amountSats: 1 })
    await clink.fetchInvoice(OFFER, { amountSats: 1 })
    expect(relay.published[0].pubkey).not.toBe(relay.published[1].pubkey)
  })

  it('maps a structured service error through', async () => {
    useFakeRelay(
      fakeRelay({
        respond: (_p, req) => [
          serviceResponse(req, {
            error: 'Invalid Amount',
            code: 5,
            range: { min: 10, max: 1000 }
          })
        ]
      })
    )
    const result = await clink.fetchInvoice(OFFER, { amountSats: 1 })
    expect(result).toEqual({
      error: 'Invalid Amount',
      reason: 'service',
      code: 5,
      range: { min: 10, max: 1000 },
      latest: undefined
    })
  })

  it('surfaces the code-3 latest offer string', async () => {
    useFakeRelay(
      fakeRelay({
        respond: (_p, req) => [
          serviceResponse(req, { error: 'Offer moved', code: 3, latest: 'noffer1newoffer' })
        ]
      })
    )
    const result = await clink.fetchInvoice(OFFER, {})
    expect(isClinkFailure(result) && result.latest).toBe('noffer1newoffer')
  })

  it('ignores a response signed by a key other than the service (spoof guard)', async () => {
    vi.useFakeTimers()
    const attacker = generateSecretKey()
    useFakeRelay(
      fakeRelay({
        respond: (_p, req) => {
          // pubkey field claims the service, but the signature is the
          // attacker's. JSON round trip = wire-faithful: it strips the
          // verifiedSymbol cache finalizeEvent sets on its own output.
          const spoofed = serviceResponse(req, { bolt11: 'lnbc1evil' }, { signer: attacker })
          return [JSON.parse(JSON.stringify({ ...spoofed, pubkey: servicePubkey }))]
        }
      })
    )
    const pending = clink.fetchInvoice(OFFER, { amountSats: 1 })
    await vi.advanceTimersByTimeAsync(31_000)
    const result = await pending
    expect(isClinkFailure(result) && result.reason).toBe('timeout')
  })

  it('accepts a response missing the clink_version tag (Lightning.Pub omits it)', async () => {
    useFakeRelay(
      fakeRelay({
        respond: (_p, req) => [
          serviceResponse(
            req,
            { bolt11: 'lnbc1fake' },
            {
              tags: [
                ['p', req.pubkey],
                ['e', req.id]
              ]
            }
          )
        ]
      })
    )
    const result = await clink.fetchInvoice(OFFER, { amountSats: 1 })
    expect(result).toEqual({ bolt11: 'lnbc1fake' })
  })

  it('ignores a response with an unsupported clink_version', async () => {
    vi.useFakeTimers()
    useFakeRelay(
      fakeRelay({
        respond: (_p, req) => [
          serviceResponse(
            req,
            { bolt11: 'lnbc1fake' },
            {
              tags: [
                ['p', req.pubkey],
                ['e', req.id],
                ['clink_version', '2']
              ]
            }
          )
        ]
      })
    )
    const pending = clink.fetchInvoice(OFFER, { amountSats: 1 })
    await vi.advanceTimersByTimeAsync(31_000)
    const result = await pending
    expect(isClinkFailure(result) && result.reason).toBe('timeout')
  })

  it('keeps waiting past an unrelated event (e.g. for another request)', async () => {
    useFakeRelay(
      fakeRelay({
        respond: (_p, req) => [
          serviceResponse(req, { bolt11: 'lnbc1other' }, {
            tags: [
              ['p', req.pubkey],
              ['e', 'someoneelsesrequestid'],
              ['clink_version', '1']
            ]
          }),
          serviceResponse(req, { bolt11: 'lnbc1mine' })
        ]
      })
    )
    const result = await clink.fetchInvoice(OFFER, { amountSats: 1 })
    expect(result).toEqual({ bolt11: 'lnbc1mine' })
  })

  it('fails fast with reason connect when the relay is unreachable', async () => {
    clink.connect = vi.fn(async () => {
      throw new Error('connection refused')
    })
    const result = await clink.fetchInvoice(OFFER, {})
    expect(isClinkFailure(result) && result.reason).toBe('connect')
  })

  it('fails with reason publish when the relay rejects the request', async () => {
    useFakeRelay(fakeRelay({ publishError: 'blocked: not welcome here' }))
    const result = await clink.fetchInvoice(OFFER, {})
    expect(isClinkFailure(result) && result.reason).toBe('publish')
  })

  it('times out when the service never responds', async () => {
    vi.useFakeTimers()
    useFakeRelay(fakeRelay({ respond: () => [] }))
    const pending = clink.fetchInvoice(OFFER, {})
    await vi.advanceTimersByTimeAsync(31_000)
    const result = await pending
    expect(isClinkFailure(result) && result.reason).toBe('timeout')
  })

  it('fires onPaid when the service sends a payment receipt, then closes', async () => {
    const relay = useFakeRelay(
      fakeRelay({
        respond: (_p, req) => [
          serviceResponse(req, { bolt11: 'lnbc1fake' }),
          // Lightning.Pub settlement receipt: {"res":"ok"}, e-tagged to the request
          serviceResponse(req, { res: 'ok' })
        ]
      })
    )
    const onPaid = vi.fn()
    const result = await clink.fetchInvoice(OFFER, { amountSats: 1, onPaid })
    expect(result).toEqual({ bolt11: 'lnbc1fake' })
    expect(onPaid).toHaveBeenCalledTimes(1)
    expect(relay.closed).toBe(true)
  })

  it('keeps the connection open for the receipt when onPaid is provided', async () => {
    const relay = useFakeRelay(
      fakeRelay({ respond: (_p, req) => [serviceResponse(req, { bolt11: 'lnbc1fake' })] })
    )
    const onPaid = vi.fn()
    const result = await clink.fetchInvoice(OFFER, { amountSats: 1, onPaid })
    expect(result).toEqual({ bolt11: 'lnbc1fake' })
    expect(onPaid).not.toHaveBeenCalled()
    expect(relay.closed).toBe(false)
    relay.close()
  })

  it('ignores a non-receipt follow-up event', async () => {
    const relay = useFakeRelay(
      fakeRelay({
        respond: (_p, req) => [
          serviceResponse(req, { bolt11: 'lnbc1fake' }),
          serviceResponse(req, { something: 'else' })
        ]
      })
    )
    const onPaid = vi.fn()
    await clink.fetchInvoice(OFFER, { amountSats: 1, onPaid })
    expect(onPaid).not.toHaveBeenCalled()
    expect(relay.closed).toBe(false)
    relay.close()
  })

  it('resolves aborted when the caller aborts mid-flight', async () => {
    useFakeRelay(fakeRelay({ respond: () => [] }))
    const controller = new AbortController()
    const pending = clink.fetchInvoice(OFFER, { signal: controller.signal })
    controller.abort()
    const result = await pending
    expect(isClinkFailure(result) && result.reason).toBe('aborted')
  })
})
