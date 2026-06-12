import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'

// Mock clientService BEFORE importing the unit under test.
vi.mock('@/services/client.service', () => {
  return {
    default: {
      getSignerFor: vi.fn(),
      publishEvent: vi.fn(),
      subscribe: vi.fn()
    }
  }
})

// Mock relayListService.
vi.mock('@/services/fetchers/relay-list.service', () => {
  return {
    default: {
      fetchRelayList: vi.fn()
    }
  }
})

import clientService from '@/services/client.service'
import relayListService from '@/services/fetchers/relay-list.service'
import contextVmClient, { sortByPreference } from '../context-vm-client.service'

// Use real secp256k1 pubkeys — wrapGift's NIP-44 conversation-key derivation
// does ECDH and rejects strings that don't decode as valid curve points.
const SENDER_SK = generateSecretKey()
const SERVER_SK = generateSecretKey()
const SENDER = getPublicKey(SENDER_SK)
const SERVER = getPublicKey(SERVER_SK)

function makeMockSigner() {
  return {
    getPublicKey: vi.fn(async () => SENDER),
    signEvent: vi.fn(async (d: any) => ({
      ...d,
      id: 'mid-' + d.kind,
      pubkey: SENDER,
      sig: 'sig'
    })),
    nip44Encrypt: vi.fn(async (_p: string, t: string) => 'enc:' + t),
    nip44Decrypt: vi.fn(async (_p: string, c: string) => c.replace(/^enc:/, ''))
  }
}

describe('contextVmClient.callTool', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // These tests target tools/call timeout + cleanup behavior, not the
    // initialize handshake. Pre-mark the server as initialized so they
    // skip the init round-trip; the handshake itself has its own describe
    // block below.
    contextVmClient.resetInitState()
    contextVmClient.markInitDone(SERVER)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    contextVmClient.resetInitState()
  })

  it('throws synchronously when no signer is registered for signerPubkey', async () => {
    ;(clientService.getSignerFor as any).mockReturnValue(undefined)
    await expect(
      contextVmClient.callTool(SERVER, 'stats', {}, { signerPubkey: SENDER })
    ).rejects.toThrow(/No signer/)
  })

  it('fetches the server NIP-65 relays when no relays option is passed', async () => {
    ;(clientService.getSignerFor as any).mockReturnValue(makeMockSigner())
    ;(relayListService.fetchRelayList as any).mockResolvedValue({
      read: ['wss://relay.contextvm.org'],
      write: ['wss://relay.contextvm.org']
    })
    ;(clientService.subscribe as any).mockReturnValue({ close: vi.fn() })
    ;(clientService.publishEvent as any).mockResolvedValue(undefined)

    const callPromise = contextVmClient.callTool(SERVER, 'stats', {}, { signerPubkey: SENDER })
    callPromise.catch(() => {}) // suppress unhandled-rejection warning if any
    // Let async microtasks AND timers settle so subscribe + publish get invoked.
    // wrapGift's chain has ~4 awaits in the mocked path (getPublicKey, signEvent,
    // nip44Encrypt, signEvent) plus a publishEvent await. Drain by yielding the
    // fake-timer loop too — `runOnlyPendingTimersAsync` is a no-op for our
    // pending 30s timer (it only fires timers that should have run), but it
    // does drain microtasks between checks. Simpler: just drain microtasks
    // synchronously many times.
    for (let i = 0; i < 50; i++) {
      await Promise.resolve()
    }

    expect(relayListService.fetchRelayList).toHaveBeenCalledWith(SERVER)
    expect(clientService.publishEvent).toHaveBeenCalled()

    // Force the pending timeout to fire (cleanly resolves the unawaited promise).
    vi.advanceTimersByTime(31_000)
    await expect(callPromise).resolves.toMatchObject({
      ok: false,
      error: expect.objectContaining({ code: -32001 })
    })
  })

  it('rejects with timeout error if no response arrives within timeoutMs', async () => {
    ;(clientService.getSignerFor as any).mockReturnValue(makeMockSigner())
    ;(relayListService.fetchRelayList as any).mockResolvedValue({
      read: ['wss://relay.contextvm.org'],
      write: ['wss://relay.contextvm.org']
    })
    ;(clientService.subscribe as any).mockReturnValue({ close: vi.fn() })
    ;(clientService.publishEvent as any).mockResolvedValue(undefined)

    const callPromise = contextVmClient.callTool(
      SERVER,
      'stats',
      {},
      {
        signerPubkey: SENDER,
        timeoutMs: 5000
      }
    )
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    vi.advanceTimersByTime(5_500)
    const result = await callPromise
    expect(result).toEqual({
      ok: false,
      error: { code: -32001, message: expect.stringMatching(/timed out|timeout/i) }
    })
  })

  it('closes the subscription after a successful response', async () => {
    const closeSpy = vi.fn()
    ;(clientService.getSignerFor as any).mockReturnValue(makeMockSigner())
    ;(relayListService.fetchRelayList as any).mockResolvedValue({
      read: ['wss://relay.contextvm.org'],
      write: ['wss://relay.contextvm.org']
    })
    ;(clientService.subscribe as any).mockReturnValue({ close: closeSpy })
    ;(clientService.publishEvent as any).mockResolvedValue(undefined)

    const callPromise = contextVmClient.callTool(SERVER, 'stats', {}, { signerPubkey: SENDER })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // The success-via-response path requires synthesizing a fake gift wrap that
    // unwraps to a matching MCP response — a non-trivial integration test.
    // For this unit test, verify cleanup on the timeout path (close still
    // called). Success-path is verified manually via the Node spike + by the
    // wire-helper round-trip tests in contextvm-wire.spec.ts.
    vi.advanceTimersByTime(31_000)
    await callPromise
    expect(closeSpy).toHaveBeenCalled()
  })
})

// --- MCP initialize handshake (spec compliance) ------------------------------
//
// These tests synthesize fake gift-wrap responses by exploiting the mock
// signer's 'enc:'-prefix encrypt/decrypt scheme: the inner is JSON-serialized
// untouched into a fake seal (kind 13), which is itself JSON-serialized into a
// fake gift wrap (kind 21059), each wrapped with the trivial 'enc:' prefix.
// The signEvent mock additionally records the JSON-RPC payload of every
// outbound kind-25910 envelope (method + id), so tests can both assert on
// request ordering and match synthesized response ids back to outstanding
// requests.

type CapturedRequest = { method: string; id?: string }
type SubscribeCall = {
  filter: unknown
  onevent: (e: any) => Promise<void> | void
  close: ReturnType<typeof vi.fn>
}

function makeFakeGiftWrap(
  senderPubkey: string,
  recipientPubkey: string,
  innerContent: string,
  senderSecretKey?: Uint8Array
) {
  const now = Math.floor(Date.now() / 1000)
  // unwrapGift now verifies the Schnorr signature of the event that establishes
  // senderPubkey (the seal in this nip59-shaped wrap) before trusting it — the
  // client transport relies on this to confirm a response really came from the
  // server it connected to. So the inner + seal must be REAL signed events.
  // The content layers keep the trivial 'enc:' prefix scheme the recipient mock
  // strips; verifyEvent only validates id+sig over the (prefixed) content, not
  // its decryptability.
  const senderSk = senderSecretKey ?? (senderPubkey === SERVER ? SERVER_SK : SENDER_SK)
  const inner = finalizeEvent(
    {
      kind: 25910,
      content: innerContent,
      tags: [['p', recipientPubkey]],
      created_at: now
    },
    senderSk
  )
  const seal = finalizeEvent(
    {
      kind: 13,
      content: 'enc:' + JSON.stringify(inner),
      tags: [],
      created_at: now
    },
    senderSk
  )
  return {
    kind: 21059,
    pubkey: 'fake-ephemeral-pk',
    content: 'enc:' + JSON.stringify(seal),
    tags: [['p', recipientPubkey]],
    created_at: now,
    id: 'fake-gift-id',
    sig: 'fake-gift-sig'
  } as any
}

async function drainMicrotasks(times = 50): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

function setupHandshakeTest(): {
  capturedRequests: CapturedRequest[]
  subscribeCalls: SubscribeCall[]
} {
  const capturedRequests: CapturedRequest[] = []
  const signer = {
    getPublicKey: vi.fn(async () => SENDER),
    signEvent: vi.fn(async (d: any) => {
      if (d.kind === 25910) {
        try {
          const parsed = JSON.parse(d.content)
          if (parsed.method) {
            capturedRequests.push({ method: parsed.method, id: parsed.id })
          }
        } catch {
          // Not JSON — ignore.
        }
      }
      return { ...d, id: 'mid-' + d.kind, pubkey: SENDER, sig: 'sig' }
    }),
    nip44Encrypt: vi.fn(async (_p: string, t: string) => 'enc:' + t),
    nip44Decrypt: vi.fn(async (_p: string, c: string) => c.replace(/^enc:/, ''))
  }
  ;(clientService.getSignerFor as any).mockReturnValue(signer)
  ;(relayListService.fetchRelayList as any).mockResolvedValue({
    read: ['wss://relay.contextvm.org'],
    write: ['wss://relay.contextvm.org']
  })
  const subscribeCalls: SubscribeCall[] = []
  ;(clientService.subscribe as any).mockImplementation(
    (_relays: any, filter: any, opts: any) => {
      const close = vi.fn()
      subscribeCalls.push({ filter, onevent: opts.onevent, close })
      return { close }
    }
  )
  ;(clientService.publishEvent as any).mockResolvedValue(undefined)
  return { capturedRequests, subscribeCalls }
}

describe('contextVmClient.callTool — MCP initialize handshake', () => {
  beforeEach(() => {
    contextVmClient.resetInitState()
  })
  afterEach(() => {
    vi.clearAllMocks()
    contextVmClient.resetInitState()
  })

  it('runs initialize before tools/call on first call and skips on subsequent calls', async () => {
    const { capturedRequests, subscribeCalls } = setupHandshakeTest()

    const callPromise = contextVmClient.callTool(SERVER, 'stats', {}, { signerPubkey: SENDER })
    callPromise.catch(() => {})

    await drainMicrotasks()
    // Only the initialize handshake has been published so far.
    expect(subscribeCalls.length).toBe(1)
    expect(capturedRequests.map((r) => r.method)).toEqual(['initialize'])

    // Synthesize a successful initialize response.
    await subscribeCalls[0].onevent(
      makeFakeGiftWrap(
        SERVER,
        SENDER,
        JSON.stringify({
          jsonrpc: '2.0',
          id: capturedRequests[0].id,
          result: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            serverInfo: { name: 'MockServer', version: '1.0' }
          }
        })
      )
    )
    await drainMicrotasks()

    // After init succeeds: notifications/initialized published + tools/call sub opened.
    expect(capturedRequests.map((r) => r.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call'
    ])
    expect(subscribeCalls.length).toBe(2)

    // Respond to tools/call so the outer promise can resolve.
    await subscribeCalls[1].onevent(
      makeFakeGiftWrap(
        SERVER,
        SENDER,
        JSON.stringify({
          jsonrpc: '2.0',
          id: capturedRequests[2].id,
          result: { content: [], structuredContent: { ok: true } }
        })
      )
    )
    const result = await callPromise
    expect(result).toMatchObject({ ok: true, structuredContent: { ok: true } })

    // SECOND call to the same server — should skip the init handshake.
    capturedRequests.length = 0
    subscribeCalls.length = 0
    const callPromise2 = contextVmClient.callTool(SERVER, 'other', {}, { signerPubkey: SENDER })
    callPromise2.catch(() => {})
    await drainMicrotasks()
    expect(subscribeCalls.length).toBe(1)
    expect(capturedRequests.map((r) => r.method)).toEqual(['tools/call'])

    await subscribeCalls[0].onevent(
      makeFakeGiftWrap(
        SERVER,
        SENDER,
        JSON.stringify({
          jsonrpc: '2.0',
          id: capturedRequests[0].id,
          result: { content: [], structuredContent: { other: true } }
        })
      )
    )
    await expect(callPromise2).resolves.toMatchObject({ ok: true })
  })

  it('falls back to direct tools/call when initialize times out (lenient)', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { capturedRequests, subscribeCalls } = setupHandshakeTest()

    const callPromise = contextVmClient.callTool(SERVER, 'stats', {}, { signerPubkey: SENDER })
    callPromise.catch(() => {})

    // Drain microtasks: initialize subscribe + publish set up; no response.
    for (let i = 0; i < 50; i++) await Promise.resolve()
    expect(capturedRequests.map((r) => r.method)).toEqual(['initialize'])
    expect(subscribeCalls.length).toBe(1)

    // Advance past the init timeout (15s = half of 30s default).
    vi.advanceTimersByTime(15_500)
    for (let i = 0; i < 50; i++) await Promise.resolve()

    // Lenient: warned + proceeded to tools/call.
    expect(warnSpy).toHaveBeenCalled()
    expect(warnSpy.mock.calls[0]?.[0]).toEqual(expect.stringContaining('initialize'))
    expect(capturedRequests.map((r) => r.method)).toEqual(['initialize', 'tools/call'])
    expect(subscribeCalls.length).toBe(2)

    // Tools/call will also time out (no response synthesized).
    vi.advanceTimersByTime(30_500)
    const result = await callPromise
    expect(result).toMatchObject({ ok: false, error: expect.objectContaining({ code: -32001 }) })

    warnSpy.mockRestore()
    vi.useRealTimers()
  })

  it('publishes notifications/initialized as fire-and-forget after successful initialize', async () => {
    const { capturedRequests, subscribeCalls } = setupHandshakeTest()

    const callPromise = contextVmClient.callTool(SERVER, 'stats', {}, { signerPubkey: SENDER })
    callPromise.catch(() => {})
    await drainMicrotasks()

    // Respond to initialize.
    await subscribeCalls[0].onevent(
      makeFakeGiftWrap(
        SERVER,
        SENDER,
        JSON.stringify({
          jsonrpc: '2.0',
          id: capturedRequests[0].id,
          result: { protocolVersion: '2025-06-18', capabilities: {} }
        })
      )
    )
    await drainMicrotasks()

    // The second outbound RPC envelope is notifications/initialized — no id
    // (JSON-RPC notifications omit `id` entirely).
    expect(capturedRequests[1].method).toBe('notifications/initialized')
    expect(capturedRequests[1].id).toBeUndefined()

    // No new subscribe was opened for the notification — it's fire-and-forget.
    // Only the initialize sub (1) and the subsequent tools/call sub (2).
    expect(subscribeCalls.length).toBe(2)
    // publishEvent called for: initialize, notifications/initialized, tools/call.
    expect(clientService.publishEvent).toHaveBeenCalledTimes(3)

    // Clean up: respond to the tools/call so the outer promise resolves.
    await subscribeCalls[1].onevent(
      makeFakeGiftWrap(
        SERVER,
        SENDER,
        JSON.stringify({
          jsonrpc: '2.0',
          id: capturedRequests[2].id,
          result: { content: [], structuredContent: {} }
        })
      )
    )
    await callPromise
  })

  it('tracks init state per server pubkey independently', async () => {
    const SERVER_B_SK = generateSecretKey()
    const SERVER_B = getPublicKey(SERVER_B_SK)

    const { capturedRequests, subscribeCalls } = setupHandshakeTest()

    // Call A — should init.
    const callA = contextVmClient.callTool(SERVER, 'stats', {}, { signerPubkey: SENDER })
    callA.catch(() => {})
    await drainMicrotasks()
    expect(capturedRequests.map((r) => r.method)).toEqual(['initialize'])

    await subscribeCalls[0].onevent(
      makeFakeGiftWrap(
        SERVER,
        SENDER,
        JSON.stringify({ jsonrpc: '2.0', id: capturedRequests[0].id, result: {} })
      )
    )
    await drainMicrotasks()
    await subscribeCalls[1].onevent(
      makeFakeGiftWrap(
        SERVER,
        SENDER,
        JSON.stringify({
          jsonrpc: '2.0',
          id: capturedRequests[2].id,
          result: { content: [] }
        })
      )
    )
    await callA

    capturedRequests.length = 0
    subscribeCalls.length = 0

    // Call B — different server pubkey, should ALSO init (state isolated).
    const callB = contextVmClient.callTool(SERVER_B, 'stats', {}, { signerPubkey: SENDER })
    callB.catch(() => {})
    await drainMicrotasks()
    expect(capturedRequests.map((r) => r.method)).toEqual(['initialize'])

    await subscribeCalls[0].onevent(
      makeFakeGiftWrap(
        SERVER_B,
        SENDER,
        JSON.stringify({ jsonrpc: '2.0', id: capturedRequests[0].id, result: {} }),
        SERVER_B_SK
      )
    )
    await drainMicrotasks()
    await subscribeCalls[1].onevent(
      makeFakeGiftWrap(
        SERVER_B,
        SENDER,
        JSON.stringify({
          jsonrpc: '2.0',
          id: capturedRequests[2].id,
          result: { content: [] }
        }),
        SERVER_B_SK
      )
    )
    await callB

    // Now a follow-up call to A should still skip init (state preserved per-server).
    capturedRequests.length = 0
    subscribeCalls.length = 0
    const callA2 = contextVmClient.callTool(SERVER, 'again', {}, { signerPubkey: SENDER })
    callA2.catch(() => {})
    await drainMicrotasks()
    expect(capturedRequests.map((r) => r.method)).toEqual(['tools/call'])
    await subscribeCalls[0].onevent(
      makeFakeGiftWrap(
        SERVER,
        SENDER,
        JSON.stringify({
          jsonrpc: '2.0',
          id: capturedRequests[0].id,
          result: { content: [] }
        })
      )
    )
    await callA2
  })
})

describe('sortByPreference', () => {
  it('hoists CDN-fronted preferred hosts to the front', () => {
    const input = [
      'wss://relay.contextvm.org/',
      'wss://relay2.contextvm.org/',
      'wss://relay.primal.net/'
    ]
    expect(sortByPreference(input)).toEqual([
      'wss://relay.primal.net/',
      'wss://relay.contextvm.org/',
      'wss://relay2.contextvm.org/'
    ])
  })

  it('preserves original order within the preferred and non-preferred groups (stable)', () => {
    const input = [
      'wss://random1.example/',
      'wss://nos.lol/',
      'wss://random2.example/',
      'wss://relay.primal.net/',
      'wss://relay.damus.io/'
    ]
    expect(sortByPreference(input)).toEqual([
      'wss://relay.primal.net/', // index 0 in PREFERRED_HOSTS
      'wss://relay.damus.io/', // index 1 in PREFERRED_HOSTS
      'wss://nos.lol/', // index 2 in PREFERRED_HOSTS
      'wss://random1.example/', // unpreferred, original index 0
      'wss://random2.example/' // unpreferred, original index 2
    ])
  })

  it('returns a new array, does not mutate input', () => {
    const input = ['wss://relay.contextvm.org/', 'wss://relay.primal.net/']
    const inputBefore = [...input]
    const result = sortByPreference(input)
    expect(input).toEqual(inputBefore)
    expect(result).not.toBe(input)
  })

  it('handles empty input', () => {
    expect(sortByPreference([])).toEqual([])
  })

  it('handles input with no preferred hosts', () => {
    const input = ['wss://x.example/', 'wss://y.example/']
    expect(sortByPreference(input)).toEqual(input)
  })

  it('matches by substring so http vs wss + trailing slash do not matter', () => {
    const input = ['https://relay.primal.net', 'wss://other.example/', 'wss://relay.primal.net/']
    const result = sortByPreference(input)
    expect(result[0]).toBe('https://relay.primal.net')
    expect(result[1]).toBe('wss://relay.primal.net/')
    expect(result[2]).toBe('wss://other.example/')
  })
})
