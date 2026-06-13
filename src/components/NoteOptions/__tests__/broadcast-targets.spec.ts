import { TRelaySet } from '@/types'
import { describe, expect, it } from 'vitest'
import { computeBroadcastTargets } from '../broadcast-targets'

const relaySet = (name: string, relayUrls: string[]): TRelaySet => ({
  id: name,
  aTag: [],
  name,
  relayUrls
})

describe('computeBroadcastTargets', () => {
  it('always offers the optimal-relays fallback when signed in, even with no sets or relays', () => {
    // The reported blank-menu bug: a signed-in user viewing a foreign note with
    // no favorite relays and no relay sets used to get an EMPTY submenu, because
    // optimal-relays was gated to own-notes and nothing else populated the list.
    const targets = computeBroadcastTargets({
      signedIn: true,
      relaySets: [],
      relayUrls: []
    })

    expect(targets).toEqual([{ kind: 'optimal', separator: false }])
  })

  it('returns an empty list when signed out with no sets or relays (item is then hidden)', () => {
    const targets = computeBroadcastTargets({
      signedIn: false,
      relaySets: [],
      relayUrls: []
    })

    expect(targets).toEqual([])
  })

  it('orders optimal first, then relay sets, then individual relays', () => {
    const targets = computeBroadcastTargets({
      signedIn: true,
      relaySets: [relaySet('My set', ['wss://set.example'])],
      relayUrls: ['wss://relay.example']
    })

    expect(targets.map((t) => t.kind)).toEqual(['optimal', 'relaySet', 'relay'])
  })

  it('puts a separator before the first relay set and first relay, but not on later items', () => {
    const targets = computeBroadcastTargets({
      signedIn: true,
      relaySets: [relaySet('A', ['wss://a']), relaySet('B', ['wss://b'])],
      relayUrls: ['wss://one', 'wss://two']
    })

    expect(targets).toEqual([
      { kind: 'optimal', separator: false },
      { kind: 'relaySet', name: 'A', relayUrls: ['wss://a'], separator: true },
      { kind: 'relaySet', name: 'B', relayUrls: ['wss://b'], separator: false },
      { kind: 'relay', url: 'wss://one', separator: true },
      { kind: 'relay', url: 'wss://two', separator: false }
    ])
  })

  it('filters out relay sets that have no relays', () => {
    const targets = computeBroadcastTargets({
      signedIn: true,
      relaySets: [relaySet('Empty', []), relaySet('Full', ['wss://full'])],
      relayUrls: []
    })

    expect(targets).toEqual([
      { kind: 'optimal', separator: false },
      { kind: 'relaySet', name: 'Full', relayUrls: ['wss://full'], separator: true }
    ])
  })

  it('keeps the first relay-set separator anchored to the first NON-empty set', () => {
    // index===0 is computed after filtering, so an empty set first must not
    // steal the separator from the first set that actually renders.
    const targets = computeBroadcastTargets({
      signedIn: true,
      relaySets: [relaySet('Empty', []), relaySet('First', ['wss://1']), relaySet('Second', ['wss://2'])],
      relayUrls: []
    })

    const sets = targets.filter((t) => t.kind === 'relaySet')
    expect(sets).toEqual([
      { kind: 'relaySet', name: 'First', relayUrls: ['wss://1'], separator: true },
      { kind: 'relaySet', name: 'Second', relayUrls: ['wss://2'], separator: false }
    ])
  })
})
