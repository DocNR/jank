import { describe, it, expect, vi } from 'vitest'
import type { Event as NEvent, EventTemplate, Filter, VerifiedEvent } from 'nostr-tools'
import type { ISigner } from '@/types'
import { createNip04ChatSubstrate, type Nip04Deps } from '../nip04-impl'

const OWNER = 'a'.repeat(64)
const AGENT = 'b'.repeat(64)
const RELAYS = ['wss://relay.one/', 'wss://relay.two/']

/**
 * Mock signer: NIP-04 "encryption" is a reversible reverse-string with a marker
 * so the round-trip is observable without real crypto. Decrypt rejects content
 * that is not in the expected shape (mimics an undecryptable event).
 */
function makeMockSigner(pubkey: string): ISigner {
  return {
    getPublicKey: vi.fn(async () => pubkey),
    signEvent: vi.fn(async (draft: EventTemplate) => {
      return {
        ...draft,
        id: 'id-' + draft.content.slice(0, 8),
        pubkey,
        sig: 'sig'
      } as unknown as VerifiedEvent
    }),
    nip04Encrypt: vi.fn(async (_pk: string, plain: string) => `enc:${plain}`),
    nip04Decrypt: vi.fn(async (_pk: string, cipher: string) => {
      if (!cipher.startsWith('enc:')) throw new Error('malformed')
      return cipher.slice('enc:'.length)
    }),
    nip44Encrypt: vi.fn(async () => ''),
    nip44Decrypt: vi.fn(async () => '')
  }
}

/** Build a kind:4 event as it would appear on a relay. */
function makeEvent(
  fromPubkey: string,
  toPubkey: string,
  content: string,
  createdAt: number,
  id?: string
): NEvent {
  return {
    id: id ?? `evt-${createdAt}`,
    pubkey: fromPubkey,
    created_at: createdAt,
    kind: 4,
    tags: [['p', toPubkey]],
    content,
    sig: 'sig'
  } as NEvent
}

function makeDeps(overrides: Partial<Nip04Deps> = {}): Nip04Deps {
  return {
    ownerPubkey: OWNER,
    getSigner: () => makeMockSigner(OWNER),
    publish: vi.fn(async () => {}),
    query: vi.fn(async () => []),
    subscribe: vi.fn(() => ({ close: vi.fn() })),
    resolveRelays: vi.fn(async () => RELAYS),
    now: () => 1000,
    ...overrides
  }
}

describe('nip04 ChatSubstrate', () => {
  describe('sendMessage', () => {
    it('encrypts to the agent, signs a kind:4, and publishes to resolved relays', async () => {
      const publish = vi.fn(async (_urls: string[], _event: NEvent) => {})
      const substrate = createNip04ChatSubstrate(makeDeps({ publish }))

      await substrate.sendMessage(AGENT, 'hello agent')

      expect(publish).toHaveBeenCalledTimes(1)
      const [urls, event] = publish.mock.calls[0]
      expect(urls).toEqual(RELAYS)
      expect(event.kind).toBe(4)
      expect(event.pubkey).toBe(OWNER)
      expect(event.content).toBe('enc:hello agent')
      expect(event.tags).toEqual([['p', AGENT]])
      expect(event.created_at).toBe(1000)
    })

    it('throws when no signer is registered for the owner', async () => {
      const substrate = createNip04ChatSubstrate(makeDeps({ getSigner: () => undefined }))
      await expect(substrate.sendMessage(AGENT, 'hi')).rejects.toThrow()
    })
  })

  describe('subscribeMessages', () => {
    it('subscribes with the inbound filter shape { kinds:[4], authors:[agent], #p:[owner] }', async () => {
      let capturedFilter: Filter | Filter[] | undefined
      const subscribe = vi.fn((_urls: string[], filter: Filter | Filter[]) => {
        capturedFilter = filter
        return { close: vi.fn() }
      })
      const substrate = createNip04ChatSubstrate(makeDeps({ subscribe }))

      substrate.subscribeMessages(AGENT, () => {})
      // resolveRelays is async; let the microtask that opens the sub run
      await Promise.resolve()
      await Promise.resolve()

      const filter = Array.isArray(capturedFilter) ? capturedFilter[0] : capturedFilter
      expect(filter).toMatchObject({ kinds: [4], authors: [AGENT], '#p': [OWNER] })
    })

    it('decrypts inbound events and forwards them as ChatMessages', async () => {
      const handlers: { onevent?: (e: NEvent) => void } = {}
      const subscribe = vi.fn((_urls: string[], _filter, h: { onevent?: (e: NEvent) => void }) => {
        handlers.onevent = h.onevent
        return { close: vi.fn() }
      })
      const received: unknown[] = []
      const substrate = createNip04ChatSubstrate(makeDeps({ subscribe }))

      substrate.subscribeMessages(AGENT, (m) => received.push(m))
      await Promise.resolve()
      await Promise.resolve()

      handlers.onevent?.(makeEvent(AGENT, OWNER, 'enc:from agent', 1234, 'inbound-1'))
      // decrypt is async
      await Promise.resolve()
      await Promise.resolve()

      expect(received).toEqual([
        { id: 'inbound-1', fromPubkey: AGENT, text: 'from agent', createdAt: 1234 }
      ])
    })

    it('skips malformed inbound events without throwing', async () => {
      const handlers: { onevent?: (e: NEvent) => void } = {}
      const subscribe = vi.fn((_urls: string[], _filter, h: { onevent?: (e: NEvent) => void }) => {
        handlers.onevent = h.onevent
        return { close: vi.fn() }
      })
      const received: unknown[] = []
      const substrate = createNip04ChatSubstrate(makeDeps({ subscribe }))

      substrate.subscribeMessages(AGENT, (m) => received.push(m))
      await Promise.resolve()
      await Promise.resolve()

      handlers.onevent?.(makeEvent(AGENT, OWNER, 'GARBAGE', 1234, 'bad-1'))
      await Promise.resolve()
      await Promise.resolve()

      expect(received).toEqual([])
    })

    it('returns an unsubscribe that closes the subscription', async () => {
      const close = vi.fn()
      const subscribe = vi.fn(() => ({ close }))
      const substrate = createNip04ChatSubstrate(makeDeps({ subscribe }))

      const unsub = substrate.subscribeMessages(AGENT, () => {})
      await Promise.resolve()
      await Promise.resolve()
      unsub()

      expect(close).toHaveBeenCalled()
    })
  })

  describe('fetchHistory', () => {
    it('queries both directions and merges results chronologically', async () => {
      // owner->agent at t=200, agent->owner at t=100 and t=300, all returned
      // unordered to prove sorting.
      const query = vi.fn(async () => [
        makeEvent(AGENT, OWNER, 'enc:second', 200, 'e-200'),
        makeEvent(OWNER, AGENT, 'enc:first', 100, 'e-100'),
        makeEvent(AGENT, OWNER, 'enc:third', 300, 'e-300')
      ])
      const substrate = createNip04ChatSubstrate(makeDeps({ query }))

      const history = await substrate.fetchHistory(AGENT)

      expect(history.map((m) => m.text)).toEqual(['first', 'second', 'third'])
      expect(history.map((m) => m.createdAt)).toEqual([100, 200, 300])
      expect(history[0].fromPubkey).toBe(OWNER)
      expect(history[1].fromPubkey).toBe(AGENT)
    })

    it('queries with BOTH direction filters', async () => {
      let capturedFilters: Filter | Filter[] | undefined
      const query = vi.fn(async (_urls: string[], filters: Filter | Filter[]) => {
        capturedFilters = filters
        return []
      })
      const substrate = createNip04ChatSubstrate(makeDeps({ query }))

      await substrate.fetchHistory(AGENT, { limit: 50 })

      const filters = Array.isArray(capturedFilters) ? capturedFilters : [capturedFilters]
      // outbound: owner is author, agent is #p; inbound: agent is author, owner is #p
      expect(filters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kinds: [4], authors: [OWNER], '#p': [AGENT], limit: 50 }),
          expect.objectContaining({ kinds: [4], authors: [AGENT], '#p': [OWNER], limit: 50 })
        ])
      )
    })

    it('skips malformed events in history without throwing', async () => {
      const query = vi.fn(async () => [
        makeEvent(OWNER, AGENT, 'enc:good', 100, 'g-1'),
        makeEvent(AGENT, OWNER, 'CORRUPT', 200, 'bad-1')
      ])
      const substrate = createNip04ChatSubstrate(makeDeps({ query }))

      const history = await substrate.fetchHistory(AGENT)

      expect(history.map((m) => m.text)).toEqual(['good'])
    })

    it('deduplicates events that appear in both query result sets', async () => {
      const dup = makeEvent(OWNER, AGENT, 'enc:dup', 100, 'same-id')
      const query = vi.fn(async () => [dup, dup])
      const substrate = createNip04ChatSubstrate(makeDeps({ query }))

      const history = await substrate.fetchHistory(AGENT)

      expect(history).toHaveLength(1)
    })
  })
})
