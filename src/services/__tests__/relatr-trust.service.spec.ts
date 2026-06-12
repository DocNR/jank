import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/client.service', () => {
  return {
    default: {
      subscribe: vi.fn()
    }
  }
})

vi.mock('@/services/fetchers/relay-list.service', () => {
  return {
    default: {
      fetchRelayList: vi.fn()
    }
  }
})

vi.mock('@/services/indexed-db.service', () => {
  return {
    default: {
      getRelatrTrust: vi.fn(),
      putRelatrTrust: vi.fn(),
      iterateRelatrTrust: vi.fn()
    }
  }
})

vi.mock('@/services/context-vm-client.service', () => {
  return {
    default: {
      callTool: vi.fn()
    }
  }
})

import clientService from '@/services/client.service'
import contextVmClient from '@/services/context-vm-client.service'
import relayListService from '@/services/fetchers/relay-list.service'
import indexedDb from '@/services/indexed-db.service'
import relatrTrust from '../relatr-trust.service'

const PUBKEY_A = 'a'.repeat(64)
const PUBKEY_B = 'b'.repeat(64)
const RELATR = '750682303c9f0ddad75941b49edc9d46e3ed306b9ee3335338a21a3e404c5fa3'

function makeTaEvent(targetPubkey: string, rank: string, createdAt: number = 1779600000) {
  return {
    kind: 30382,
    pubkey: RELATR,
    created_at: createdAt,
    tags: [
      ['d', targetPubkey],
      ['rank', rank]
    ],
    content: '',
    id: 'mock-' + targetPubkey.slice(0, 8),
    sig: 'mock-sig'
  }
}

describe('relatrTrust.getRank', () => {
  beforeEach(() => {
    relatrTrust._resetForTests()
    ;(indexedDb.getRelatrTrust as any).mockResolvedValue(null)
    ;(indexedDb.iterateRelatrTrust as any).mockImplementation(async () => {})
    ;(indexedDb.putRelatrTrust as any).mockResolvedValue(undefined)
    ;(relayListService.fetchRelayList as any).mockResolvedValue({
      read: ['wss://relay.contextvm.org'],
      write: ['wss://relay.contextvm.org']
    })
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when Relatr returns no event for the pubkey (EOSE empty)', async () => {
    let oneoseFn: (() => void) | undefined
    ;(clientService.subscribe as any).mockImplementation(
      (_urls: string[], _filter: any, opts: any) => {
        oneoseFn = opts.oneose
        return { close: vi.fn() }
      }
    )
    const promise = relatrTrust.getRank(PUBKEY_A)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 150))
    oneoseFn?.()
    const result = await promise
    expect(result).toBe(null)
  })

  it('returns the rank when Relatr returns a kind-30382 event', async () => {
    let oneventFn: ((evt: any) => void) | undefined
    let oneoseFn: (() => void) | undefined
    ;(clientService.subscribe as any).mockImplementation(
      (_urls: string[], _filter: any, opts: any) => {
        oneventFn = opts.onevent
        oneoseFn = opts.oneose
        return { close: vi.fn() }
      }
    )
    const promise = relatrTrust.getRank(PUBKEY_A)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 150))
    oneventFn?.(makeTaEvent(PUBKEY_A, '88'))
    oneoseFn?.()
    const result = await promise
    expect(result).toBe(88)
  })

  it('batches concurrent getRank calls into one subscription', async () => {
    let oneventFn: ((evt: any) => void) | undefined
    let oneoseFn: (() => void) | undefined
    ;(clientService.subscribe as any).mockImplementation(
      (_urls: string[], _filter: any, opts: any) => {
        oneventFn = opts.onevent
        oneoseFn = opts.oneose
        return { close: vi.fn() }
      }
    )
    const p1 = relatrTrust.getRank(PUBKEY_A)
    const p2 = relatrTrust.getRank(PUBKEY_B)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 150))
    oneventFn?.(makeTaEvent(PUBKEY_A, '88'))
    oneventFn?.(makeTaEvent(PUBKEY_B, '42'))
    oneoseFn?.()
    expect(await p1).toBe(88)
    expect(await p2).toBe(42)
    expect(clientService.subscribe).toHaveBeenCalledTimes(1)
  })

  it('caches results — second getRank for same pubkey makes no new sub', async () => {
    let oneventFn: ((evt: any) => void) | undefined
    let oneoseFn: (() => void) | undefined
    ;(clientService.subscribe as any).mockImplementation(
      (_urls: string[], _filter: any, opts: any) => {
        oneventFn = opts.onevent
        oneoseFn = opts.oneose
        return { close: vi.fn() }
      }
    )
    const p1 = relatrTrust.getRank(PUBKEY_A)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 150))
    oneventFn?.(makeTaEvent(PUBKEY_A, '88'))
    oneoseFn?.()
    await p1
    const result2 = await relatrTrust.getRank(PUBKEY_A)
    expect(result2).toBe(88)
    expect(clientService.subscribe).toHaveBeenCalledTimes(1)
  })

  it('parses out-of-range rank as null (defensive — Relatr should never publish this)', async () => {
    let oneventFn: ((evt: any) => void) | undefined
    let oneoseFn: (() => void) | undefined
    ;(clientService.subscribe as any).mockImplementation(
      (_urls: string[], _filter: any, opts: any) => {
        oneventFn = opts.onevent
        oneoseFn = opts.oneose
        return { close: vi.fn() }
      }
    )
    const promise = relatrTrust.getRank(PUBKEY_A)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 150))
    oneventFn?.(makeTaEvent(PUBKEY_A, '999'))
    oneoseFn?.()
    const result = await promise
    expect(result).toBe(null)
  })

  it('parses non-numeric rank as null', async () => {
    let oneventFn: ((evt: any) => void) | undefined
    let oneoseFn: (() => void) | undefined
    ;(clientService.subscribe as any).mockImplementation(
      (_urls: string[], _filter: any, opts: any) => {
        oneventFn = opts.onevent
        oneoseFn = opts.oneose
        return { close: vi.fn() }
      }
    )
    const promise = relatrTrust.getRank(PUBKEY_A)
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 150))
    oneventFn?.(makeTaEvent(PUBKEY_A, 'abc'))
    oneoseFn?.()
    const result = await promise
    expect(result).toBe(null)
  })

  it('falls open (returns null) when fetchRelayList throws', async () => {
    ;(relayListService.fetchRelayList as any).mockRejectedValue(new Error('no relays'))
    ;(clientService.subscribe as any).mockImplementation(() => ({ close: vi.fn() }))
    const result = await relatrTrust.getRank(PUBKEY_A)
    expect(result).toBe(null)
    const result2 = await relatrTrust.getRank(PUBKEY_B)
    expect(result2).toBe(null)
    expect(clientService.subscribe).not.toHaveBeenCalled()
  })

  it('timeout closes sub + returns null when no EOSE arrives', async () => {
    vi.useFakeTimers()
    const closeSpy = vi.fn()
    ;(clientService.subscribe as any).mockImplementation(() => ({ close: closeSpy }))
    const promise = relatrTrust.getRank(PUBKEY_A)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(150)
    await vi.advanceTimersByTimeAsync(6_000)
    expect(await promise).toBe(null)
    expect(closeSpy).toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('relatrTrust.primeRank + peekRank', () => {
  beforeEach(() => {
    relatrTrust._resetForTests()
    ;(indexedDb.getRelatrTrust as any).mockResolvedValue(null)
    ;(indexedDb.iterateRelatrTrust as any).mockImplementation(async () => {})
    ;(indexedDb.putRelatrTrust as any).mockResolvedValue(undefined)
  })

  it('primeRank lets peekRank read synchronously without network', () => {
    // computedAt must be within CACHE_TTL_MS (3 days) of now — peekRank treats
    // older entries as expired and returns undefined. Use a fresh timestamp,
    // not a hardcoded one, so the test doesn't time-bomb past the TTL.
    relatrTrust.primeRank(PUBKEY_A, 88, Math.floor(Date.now() / 1000))
    expect(relatrTrust.peekRank(PUBKEY_A)).toBe(88)
  })

  it('peekRank returns undefined for unknown pubkeys', () => {
    expect(relatrTrust.peekRank(PUBKEY_A)).toBeUndefined()
  })

  it('primeRank lets a subsequent getRank skip the network', async () => {
    relatrTrust.primeRank(PUBKEY_A, 88, Math.floor(Date.now() / 1000))
    const result = await relatrTrust.getRank(PUBKEY_A)
    expect(result).toBe(88)
  })
})

describe('relatrTrust.warmRanks', () => {
  beforeEach(() => {
    relatrTrust._resetForTests()
    ;(indexedDb.getRelatrTrust as any).mockResolvedValue(null)
    ;(indexedDb.iterateRelatrTrust as any).mockImplementation(async () => {})
    ;(indexedDb.putRelatrTrust as any).mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fetches uncached pubkeys, skips fresh-cached ones, and dedups', async () => {
    const now = Math.floor(Date.now() / 1000)
    relatrTrust.primeRank(PUBKEY_A, 72, now) // fresh positive cache entry
    const getRankSpy = vi.spyOn(relatrTrust, 'getRank').mockResolvedValue(null)

    await relatrTrust.warmRanks([PUBKEY_A, PUBKEY_B, PUBKEY_B])

    expect(getRankSpy).toHaveBeenCalledTimes(1)
    expect(getRankSpy).toHaveBeenCalledWith(PUBKEY_B)
    getRankSpy.mockRestore()
  })

  it('is a no-op for an empty list', async () => {
    const getRankSpy = vi.spyOn(relatrTrust, 'getRank').mockResolvedValue(null)
    await relatrTrust.warmRanks([])
    expect(getRankSpy).not.toHaveBeenCalled()
    getRankSpy.mockRestore()
  })
})

describe('relatrTrust.triggerCompute', () => {
  beforeEach(() => {
    relatrTrust._resetForTests()
    ;(indexedDb.getRelatrTrust as any).mockResolvedValue(null)
    ;(indexedDb.iterateRelatrTrust as any).mockImplementation(async () => {})
    ;(indexedDb.putRelatrTrust as any).mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fires calculate_trust_score MCP and writes result to cache on success', async () => {
    ;(contextVmClient.callTool as any).mockResolvedValue({
      ok: true,
      structuredContent: {
        trustScore: {
          sourcePubkey: RELATR,
          targetPubkey: PUBKEY_A,
          score: 0.5,
          components: {
            socialDistance: 1000,
            normalizedDistance: 0,
            distanceWeight: 0.5,
            validators: {}
          },
          // Fresh timestamp so the cached entry stays within CACHE_TTL_MS and
          // peekRank returns the rank below (a hardcoded past value would
          // time-bomb once it aged past the 3-day TTL).
          computedAt: Math.floor(Date.now() / 1000)
        },
        computationTimeMs: 50
      }
    })
    const stateChanges: string[] = []
    relatrTrust.onComputeStateChange(PUBKEY_A, (s) => stateChanges.push(s))

    relatrTrust.triggerCompute(PUBKEY_A, 'signer-pubkey')
    // Let the in-flight promise resolve.
    await new Promise((r) => setTimeout(r, 10))

    expect(stateChanges).toContain('pending')
    expect(relatrTrust.peekRank(PUBKEY_A)).toBe(50)
    expect(stateChanges[stateChanges.length - 1]).toBe('idle')
  })

  it('transitions to failed on MCP error', async () => {
    ;(contextVmClient.callTool as any).mockResolvedValue({
      ok: false,
      error: { code: -32603, message: 'compute failed' }
    })
    const stateChanges: string[] = []
    relatrTrust.onComputeStateChange(PUBKEY_A, (s) => stateChanges.push(s))

    relatrTrust.triggerCompute(PUBKEY_A, 'signer-pubkey')
    await new Promise((r) => setTimeout(r, 10))

    expect(stateChanges).toContain('pending')
    expect(stateChanges[stateChanges.length - 1]).toBe('failed')
  })

  it('dedups concurrent triggers for same pubkey', async () => {
    let resolveCall: ((v: any) => void) | undefined
    ;(contextVmClient.callTool as any).mockImplementation(
      () => new Promise((r) => (resolveCall = r))
    )

    relatrTrust.triggerCompute(PUBKEY_A, 'signer-pubkey')
    relatrTrust.triggerCompute(PUBKEY_A, 'signer-pubkey')
    expect(contextVmClient.callTool).toHaveBeenCalledTimes(1)

    resolveCall?.({
      ok: true,
      structuredContent: {
        trustScore: {
          sourcePubkey: RELATR,
          targetPubkey: PUBKEY_A,
          score: 0.5,
          components: {
            socialDistance: 1000,
            normalizedDistance: 0,
            distanceWeight: 0.5,
            validators: {}
          },
          computedAt: 0
        },
        computationTimeMs: 0
      }
    })
    await new Promise((r) => setTimeout(r, 10))
  })
})
