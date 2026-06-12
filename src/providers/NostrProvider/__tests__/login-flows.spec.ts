import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateSecretKey, getPublicKey, nip44 } from 'nostr-tools'
import { bytesToHex } from '@noble/hashes/utils'

// `nostrConnectionLoginMulti` subscribes via client.service and builds a
// BunkerSigner per ack. Mock both: client.service so the test can drive
// synthetic kind:24133 acks into the captured `onevent` handler, and
// bunker.signer so `.login()` resolves without touching the network. The
// other side-effectful module-level imports of login-flows.ts
// (local-storage.service, sonner) are stubbed so importing the module under
// test is clean in the node test env.
const mocks = vi.hoisted(() => ({
  capturedOnEvent: undefined as ((evt: unknown) => void | Promise<void>) | undefined,
  subClose: vi.fn()
}))

vi.mock('@/services/client.service', () => ({
  default: {
    subscribe: vi.fn(
      (_relays: unknown, _filter: unknown, handlers: { onevent: (evt: unknown) => void }) => {
        mocks.capturedOnEvent = handlers.onevent
        return { close: mocks.subClose }
      }
    )
  }
}))

vi.mock('@/services/local-storage.service', () => ({ default: {} }))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('../bunker.signer', () => ({
  BunkerSigner: class {
    signer = { close: vi.fn(() => Promise.resolve()) }
    constructor(_clientSecretKey?: string) {}
    async login(_bunker: string, _isInitialConnection: boolean) {
      return 'mock-signer-pubkey'
    }
  }
}))

import { nostrConnectionLoginMulti, type AccumulatedAck } from '../login-flows'

const CLIENT_SK = generateSecretKey()
const CLIENT_PK = getPublicKey(CLIENT_SK)
const SECRET = 'testsecret123'

/** Build a synthetic, real-NIP-44-encrypted kind:24133 ack from a signer. */
function makeAck(signerSk: Uint8Array, result: string, id = '1') {
  const ck = nip44.v2.utils.getConversationKey(signerSk, CLIENT_PK)
  return {
    id: 'evt-' + bytesToHex(signerSk).slice(0, 12),
    kind: 24133,
    pubkey: getPublicKey(signerSk),
    created_at: 0,
    tags: [['p', CLIENT_PK]],
    content: nip44.v2.encrypt(JSON.stringify({ id, result }), ck),
    sig: ''
  }
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

function startMulti(opts: { windowMs?: number; controller?: AbortController } = {}) {
  const controller = opts.controller ?? new AbortController()
  const onTotalKnown = vi.fn()
  const onAccumulate = vi.fn()
  let settled: 'resolved' | 'rejected' | null = null
  let resolvedValue: AccumulatedAck[] = []
  let rejectedError: unknown

  const promise = nostrConnectionLoginMulti({
    clientSecretKey: CLIENT_SK,
    clientPubkey: CLIENT_PK,
    relays: ['wss://test.relay'],
    secret: SECRET,
    signal: controller.signal,
    windowMs: opts.windowMs ?? 60_000,
    onTotalKnown,
    onAccumulate
  })
  promise.then(
    (v) => {
      settled = 'resolved'
      resolvedValue = v
    },
    (e) => {
      settled = 'rejected'
      rejectedError = e
    }
  )

  return {
    promise,
    controller,
    onTotalKnown,
    onAccumulate,
    get settled() {
      return settled
    },
    get resolvedValue() {
      return resolvedValue
    },
    get rejectedError() {
      return rejectedError
    }
  }
}

describe('nostrConnectionLoginMulti — smart finalize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mocks.capturedOnEvent = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('finalizes immediately on a bare-string ack (non-multi-aware signer)', async () => {
    const m = startMulti()
    const signerSk = generateSecretKey()

    await mocks.capturedOnEvent!(makeAck(signerSk, SECRET))
    await flush()

    // Resolved without the listening window's timer ever firing.
    expect(m.settled).toBe('resolved')
    expect(m.resolvedValue).toHaveLength(1)
    expect(m.resolvedValue[0].signerPubkey).toBe(getPublicKey(signerSk))
    expect(m.resolvedValue[0].name).toBeUndefined()
    expect(m.onTotalKnown).toHaveBeenCalledWith(1)
  })

  it('finalizes after one ack when a JSON result announces total:1', async () => {
    const m = startMulti()
    const signerSk = generateSecretKey()

    await mocks.capturedOnEvent!(
      makeAck(signerSk, JSON.stringify({ echoed_secret: SECRET, name: 'alice', total: 1 }))
    )
    await flush()

    expect(m.settled).toBe('resolved')
    expect(m.resolvedValue).toHaveLength(1)
    expect(m.resolvedValue[0].name).toBe('alice')
    expect(m.onTotalKnown).toHaveBeenCalledWith(1)
  })

  it('with JSON total:2, resolves only after the second ack', async () => {
    const m = startMulti()

    await mocks.capturedOnEvent!(
      makeAck(generateSecretKey(), JSON.stringify({ echoed_secret: SECRET, total: 2 }))
    )
    await flush()
    expect(m.settled).toBeNull()

    await mocks.capturedOnEvent!(
      makeAck(generateSecretKey(), JSON.stringify({ echoed_secret: SECRET, total: 2 }))
    )
    await flush()
    expect(m.settled).toBe('resolved')
    expect(m.resolvedValue).toHaveLength(2)
  })

  it('a late bare-string ack does NOT clobber a real total set by a JSON ack', async () => {
    const m = startMulti()

    // JSON ack announces a batch of 3.
    await mocks.capturedOnEvent!(
      makeAck(generateSecretKey(), JSON.stringify({ echoed_secret: SECRET, total: 3 }))
    )
    await flush()
    expect(m.settled).toBeNull()

    // Bare-string ack arrives — must NOT reset total to 1 (the `total === undefined`
    // guard). If it did, the size>=total check would finalize early at length 2.
    await mocks.capturedOnEvent!(makeAck(generateSecretKey(), SECRET))
    await flush()
    expect(m.settled).toBeNull()

    // Third JSON ack completes the announced batch of 3.
    await mocks.capturedOnEvent!(
      makeAck(generateSecretKey(), JSON.stringify({ echoed_secret: SECRET, total: 3 }))
    )
    await flush()
    expect(m.settled).toBe('resolved')
    expect(m.resolvedValue).toHaveLength(3)
  })

  it('resolves with partial results when the listening window times out', async () => {
    const m = startMulti({ windowMs: 60_000 })

    await mocks.capturedOnEvent!(
      makeAck(generateSecretKey(), JSON.stringify({ echoed_secret: SECRET, total: 5 }))
    )
    await flush()
    expect(m.settled).toBeNull()

    vi.advanceTimersByTime(60_000)
    await flush()
    expect(m.settled).toBe('resolved')
    expect(m.resolvedValue).toHaveLength(1)
  })

  it('rejects with an AbortError when the signal aborts', async () => {
    const controller = new AbortController()
    const m = startMulti({ controller })

    controller.abort()
    await flush()

    expect(m.settled).toBe('rejected')
    expect((m.rejectedError as DOMException).name).toBe('AbortError')
  })
})
