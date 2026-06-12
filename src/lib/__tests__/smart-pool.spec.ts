import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Event as NEvent } from 'nostr-tools'

// Mock the verification pool with a controllable verifier.
vi.mock('@/services/verification-pool.service', () => ({
  default: {
    verify: vi.fn(),
    preload: vi.fn(),
    dispose: vi.fn()
  }
}))

import { JankRelay, SmartPool } from '@/lib/smart-pool'
import verificationPool from '@/services/verification-pool.service'

const makeEvent = (id: string, created_at = 0): NEvent =>
  ({
    id,
    kind: 1,
    pubkey: 'a'.repeat(64),
    created_at,
    tags: [],
    content: '',
    sig: 'b'.repeat(128)
  }) as NEvent

const makeSub = () => ({
  filters: [{ kinds: [1] }],
  alreadyHaveEvent: vi.fn(() => false),
  receivedEvent: vi.fn(),
  onevent: vi.fn(),
  oninvalidevent: vi.fn(),
  receivedEose: vi.fn(),
  lastEmitted: undefined as number | undefined
})

const fakeRelay = () => {
  // Construct a JankRelay directly without calling connect(). The
  // AbstractRelay constructor only sets fields — it doesn't open a WebSocket
  // until connect() is called. Pass a stub websocketImplementation so the
  // parent constructor doesn't reach for the missing `WebSocket` global in
  // the node test env.
  const r = new JankRelay('wss://test.example', {
    verifyEvent: () => true, // noop — JankRelay owns verify
    enablePing: false,
    enableReconnect: false,
    websocketImplementation: class {}
  } as any)
  return r
}

describe('JankRelay async _onmessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delivers a valid event only after worker says valid', async () => {
    const r = fakeRelay()
    const sub = makeSub()
    r.openSubs.set('sub1', sub as any)

    let resolveVerify: (v: boolean) => void = () => {}
    ;(verificationPool.verify as any).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveVerify = resolve
        })
    )

    const evt = makeEvent('e1')
    // Simulate inbound EVENT from the relay.
    ;(r as any)._onmessage({ data: JSON.stringify(['EVENT', 'sub1', evt]) } as MessageEvent)

    // Before worker resolves, onevent must NOT have fired yet.
    expect(sub.onevent).not.toHaveBeenCalled()

    resolveVerify(true)
    await Promise.resolve() // microtask drain
    await Promise.resolve()

    expect(sub.onevent).toHaveBeenCalledTimes(1)
    expect(sub.onevent.mock.calls[0][0].id).toBe(evt.id)
    expect(sub.oninvalidevent).not.toHaveBeenCalled()
  })

  it('drops an invalid event without firing onevent', async () => {
    const r = fakeRelay()
    const sub = makeSub()
    r.openSubs.set('sub1', sub as any)

    ;(verificationPool.verify as any).mockResolvedValue(false)

    const evt = makeEvent('e2')
    ;(r as any)._onmessage({ data: JSON.stringify(['EVENT', 'sub1', evt]) } as MessageEvent)

    await Promise.resolve()
    await Promise.resolve()

    expect(sub.onevent).not.toHaveBeenCalled()
    expect(sub.oninvalidevent).toHaveBeenCalledTimes(1)
    expect(sub.oninvalidevent.mock.calls[0][0].id).toBe(evt.id)
  })

  it('drops events for unknown subscriptions', async () => {
    const r = fakeRelay()
    ;(verificationPool.verify as any).mockResolvedValue(true)
    const evt = makeEvent('e3')
    ;(r as any)._onmessage({ data: JSON.stringify(['EVENT', 'unknown-sub', evt]) } as MessageEvent)
    await Promise.resolve()
    // No throw, no panic, no verify call.
    expect(verificationPool.verify).not.toHaveBeenCalled()
  })

  it('respects alreadyHaveEvent dedupe (skips verify entirely)', async () => {
    const r = fakeRelay()
    const sub = makeSub()
    sub.alreadyHaveEvent = vi.fn(() => true)
    r.openSubs.set('sub1', sub as any)

    const evt = makeEvent('e4')
    ;(r as any)._onmessage({ data: JSON.stringify(['EVENT', 'sub1', evt]) } as MessageEvent)
    await Promise.resolve()

    expect(verificationPool.verify).not.toHaveBeenCalled()
    expect(sub.onevent).not.toHaveBeenCalled()
  })

  it('defers EOSE until all in-flight verifications for that sub resolve', async () => {
    const r = fakeRelay()
    const sub = makeSub()
    r.openSubs.set('sub1', sub as any)

    let resolveA: (v: boolean) => void = () => {}
    let resolveB: (v: boolean) => void = () => {}
    ;(verificationPool.verify as any)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((r) => {
            resolveA = r
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((r) => {
            resolveB = r
          })
      )

    ;(r as any)._onmessage({
      data: JSON.stringify(['EVENT', 'sub1', makeEvent('a')])
    } as MessageEvent)
    ;(r as any)._onmessage({
      data: JSON.stringify(['EVENT', 'sub1', makeEvent('b')])
    } as MessageEvent)
    ;(r as any)._onmessage({ data: JSON.stringify(['EOSE', 'sub1']) } as MessageEvent)

    // EOSE arrived but both verifications are in flight — must defer.
    await Promise.resolve()
    expect(sub.receivedEose).not.toHaveBeenCalled()

    resolveA(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(sub.receivedEose).not.toHaveBeenCalled() // one still pending

    resolveB(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(sub.receivedEose).toHaveBeenCalledTimes(1) // now drained
  })

  it('advances lastEmitted by event created_at but never past the present', async () => {
    const r = fakeRelay()
    const sub = makeSub()
    r.openSubs.set('sub1', sub as any)
    ;(verificationPool.verify as any).mockResolvedValue(true)

    const past = Math.floor(Date.now() / 1000) - 100
    ;(r as any)._onmessage({
      data: JSON.stringify(['EVENT', 'sub1', makeEvent('p1', past)])
    } as MessageEvent)
    await Promise.resolve()
    await Promise.resolve()
    expect(sub.lastEmitted).toBe(past)

    // A future-dated event must not poison the reconnect-refire watermark
    // (ws.onopen resubscribes with since = lastEmitted + 1).
    const future = Math.floor(Date.now() / 1000) + 7200
    ;(r as any)._onmessage({
      data: JSON.stringify(['EVENT', 'sub1', makeEvent('f1', future)])
    } as MessageEvent)
    await Promise.resolve()
    await Promise.resolve()
    expect(sub.lastEmitted!).toBeLessThanOrEqual(Math.floor(Date.now() / 1000))
  })

  it('passes non-EVENT, non-EOSE messages to parent class unchanged', () => {
    const r = fakeRelay()
    // NOTICE is a simple case — parent class calls this.onnotice.
    const onnoticeSpy = vi.fn()
    r.onnotice = onnoticeSpy
    ;(r as any)._onmessage({ data: JSON.stringify(['NOTICE', 'hello']) } as MessageEvent)
    expect(onnoticeSpy).toHaveBeenCalledWith('hello')
  })
})

// Stand-in for a pooled AbstractRelay, exposing only the surface
// reconnectStaleRelays touches.
const fakePooledRelay = (opts: { connected: boolean; subs: number }) => {
  const openSubs = new Map<string, unknown>()
  for (let i = 0; i < opts.subs; i++) openSubs.set('s' + i, {})
  return {
    connected: opts.connected,
    openSubs,
    ws: {
      onopen: () => {},
      onclose: () => {},
      onerror: () => {},
      onmessage: () => {},
      close: vi.fn()
    } as any,
    connectionPromise: Promise.resolve(),
    _connected: opts.connected,
    reconnectAttempts: 0,
    pingIntervalHandle: undefined as ReturnType<typeof setInterval> | undefined,
    connect: vi.fn().mockResolvedValue(undefined)
  }
}

describe('SmartPool.reconnectStaleRelays', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('forces a fresh socket on a connected relay while preserving its open subs', () => {
    const pool = new SmartPool()
    const relay = fakePooledRelay({ connected: true, subs: 1 })
    const oldWs = relay.ws
    ;(pool as any).relays.set('wss://zombie.example', relay)

    pool.reconnectStaleRelays()

    // Old (possibly zombie) socket is detached and closed.
    expect(oldWs.onclose).toBeNull()
    expect(oldWs.onmessage).toBeNull()
    expect(oldWs.close).toHaveBeenCalledTimes(1)
    // Short-circuit state cleared so connect() actually opens a new socket.
    expect(relay.ws).toBeUndefined()
    expect(relay.connectionPromise).toBeUndefined()
    expect(relay._connected).toBe(false)
    // Marked as a reconnection so ws.onopen resubscribes with since=lastEmitted+1.
    expect(relay.reconnectAttempts).toBeGreaterThanOrEqual(1)
    // Open subs are NOT cleared — they ride the reconnect.
    expect(relay.openSubs.size).toBe(1)
    expect(relay.connect).toHaveBeenCalledTimes(1)
  })

  it('recovers a zombie relay that still reports connected but has dead subs', () => {
    const pool = new SmartPool()
    // connected=true is exactly the zombie case: socket dead, object unaware.
    const relay = fakePooledRelay({ connected: true, subs: 2 })
    ;(pool as any).relays.set('wss://zombie.example', relay)

    pool.reconnectStaleRelays()

    expect(relay.connect).toHaveBeenCalledTimes(1)
    expect(relay.openSubs.size).toBe(2)
  })

  it('skips genuinely idle, disconnected relays with no open subs', () => {
    const pool = new SmartPool()
    const relay = fakePooledRelay({ connected: false, subs: 0 })
    const oldWs = relay.ws
    ;(pool as any).relays.set('wss://idle.example', relay)

    pool.reconnectStaleRelays()

    expect(relay.connect).not.toHaveBeenCalled()
    expect(oldWs.close).not.toHaveBeenCalled()
    expect(relay.ws).toBe(oldWs)
  })
})
