import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'
import {
  parseHashtagRoute,
  parseProfileRoute,
  parseRelayRoute,
  routeOpensOwnColumn,
  toHashtag,
  toNoteList,
  toProfile,
  toRelay
} from '@/lib/link'

const PK = getPublicKey(generateSecretKey())
const NPUB = nip19.npubEncode(PK)
const NPROFILE = nip19.nprofileEncode({ pubkey: PK, relays: [] })

describe('parseProfileRoute', () => {
  it('decodes a bare /users/<npub> route to a hex pubkey', () => {
    expect(parseProfileRoute(`/users/${NPUB}`)).toBe(PK)
  })

  it('decodes a bare /users/<nprofile> route to a hex pubkey', () => {
    expect(parseProfileRoute(`/users/${NPROFILE}`)).toBe(PK)
  })

  it('returns null for the /users/:id/following sub-route', () => {
    expect(parseProfileRoute(`/users/${NPUB}/following`)).toBeNull()
  })

  it('returns null for the /users/:id/relays sub-route', () => {
    expect(parseProfileRoute(`/users/${NPUB}/relays`)).toBeNull()
  })

  it('returns null for non-/users routes', () => {
    expect(parseProfileRoute('/notes/abc123')).toBeNull()
    expect(parseProfileRoute('/search')).toBeNull()
  })

  it('returns null for an undecodable id', () => {
    expect(parseProfileRoute('/users/not-a-bech32-id')).toBeNull()
  })
})

describe('parseHashtagRoute', () => {
  it('decodes a bare /notes?t=<tag> route to a normalized tag', () => {
    expect(parseHashtagRoute('/notes?t=clave')).toBe('clave')
  })

  it('lowercases mixed-case tags', () => {
    expect(parseHashtagRoute('/notes?t=Clave')).toBe('clave')
    expect(parseHashtagRoute('/notes?t=BITCOIN')).toBe('bitcoin')
  })

  it('round-trips the URL produced by toNoteList({ hashtag })', () => {
    const url = toNoteList({ hashtag: 'nostr' })
    expect(parseHashtagRoute(url)).toBe('nostr')
  })

  it('returns null for kind-filtered hashtag feeds (long-form article tag chips)', () => {
    // /notes?t=tag&k=30023 — kind 1 Hashtag column body can't represent this.
    expect(parseHashtagRoute(toNoteList({ hashtag: 'nostr', kinds: [30023] }))).toBeNull()
  })

  it('returns null when other filter params are present', () => {
    expect(parseHashtagRoute('/notes?t=foo&s=query')).toBeNull()
    expect(parseHashtagRoute('/notes?t=foo&d=example.com')).toBeNull()
  })

  it('returns null when t is absent', () => {
    expect(parseHashtagRoute('/notes?s=query')).toBeNull()
    expect(parseHashtagRoute('/notes')).toBeNull()
    expect(parseHashtagRoute('/notes?')).toBeNull()
  })

  it('returns null for non-/notes paths', () => {
    expect(parseHashtagRoute('/users/abc?t=foo')).toBeNull()
    expect(parseHashtagRoute('/search?t=hashtag&q=foo')).toBeNull()
    expect(parseHashtagRoute(`/users/${NPUB}`)).toBeNull()
  })

  it('returns null for tags that fail the Unicode-letter grammar', () => {
    // normalizeHashtag rejects punctuation, spaces, leading-only-#, etc.
    expect(parseHashtagRoute('/notes?t=')).toBeNull()
    expect(parseHashtagRoute('/notes?t=foo%20bar')).toBeNull() // space
    expect(parseHashtagRoute('/notes?t=foo.bar')).toBeNull() // dot
  })

  it('strips a leading # if one slipped through encoding', () => {
    // toNoteList already strips, but normalizeHashtag handles it defensively.
    expect(parseHashtagRoute('/notes?t=%23clave')).toBe('clave')
  })
})

describe('toProfile (canonical /p/<npub>)', () => {
  it('emits /p/<npub> for a bech32 npub input', () => {
    expect(toProfile(NPUB)).toBe(`/p/${NPUB}`)
  })

  it('emits /p/<npub> for a bech32 nprofile input', () => {
    expect(toProfile(NPROFILE)).toBe(`/p/${NPROFILE}`)
  })

  it('encodes a hex pubkey to an npub before emitting', () => {
    expect(toProfile(PK)).toBe(`/p/${NPUB}`)
  })
})

describe('parseProfileRoute (canonical + legacy)', () => {
  it('decodes the canonical /p/<npub> route to a hex pubkey', () => {
    expect(parseProfileRoute(`/p/${NPUB}`)).toBe(PK)
  })

  it('decodes the canonical /p/<nprofile> route to a hex pubkey', () => {
    expect(parseProfileRoute(`/p/${NPROFILE}`)).toBe(PK)
  })

  it('still decodes the legacy /users/<npub> route (back-compat)', () => {
    expect(parseProfileRoute(`/users/${NPUB}`)).toBe(PK)
  })

  it('returns null for /p/<id>/following sub-route', () => {
    expect(parseProfileRoute(`/p/${NPUB}/following`)).toBeNull()
  })

  it('returns null for an undecodable canonical id', () => {
    expect(parseProfileRoute('/p/not-a-bech32-id')).toBeNull()
  })
})

describe('toHashtag (canonical /t/<tag>)', () => {
  it('returns /t/<tag>', () => {
    expect(toHashtag('nostr')).toBe('/t/nostr')
  })

  it('encodes special characters in the tag', () => {
    // Real hashtags should always be plain unicode letters per normalizeHashtag,
    // but encodeURIComponent is the safety net on the emit side.
    expect(toHashtag('café')).toBe('/t/caf%C3%A9')
  })
})

describe('parseHashtagRoute (canonical + legacy)', () => {
  it('decodes the canonical /t/<tag> route', () => {
    expect(parseHashtagRoute('/t/nostr')).toBe('nostr')
  })

  it('lowercases mixed-case canonical tags', () => {
    expect(parseHashtagRoute('/t/Clave')).toBe('clave')
  })

  it('decodes percent-encoded unicode in canonical', () => {
    expect(parseHashtagRoute('/t/caf%C3%A9')).toBe('café')
  })

  it('still decodes the legacy /notes?t=<tag> route (back-compat)', () => {
    expect(parseHashtagRoute('/notes?t=nostr')).toBe('nostr')
  })

  it('returns null for /t with empty tag', () => {
    expect(parseHashtagRoute('/t/')).toBeNull()
    expect(parseHashtagRoute('/t')).toBeNull()
  })
})

describe('toRelay (canonical /r/<encoded-url>)', () => {
  it('encodes the relay URL', () => {
    expect(toRelay('wss://nos.lol')).toBe('/r/wss%3A%2F%2Fnos.lol')
  })
})

describe('parseRelayRoute (canonical + legacy)', () => {
  it('decodes the canonical /r/<encoded> route', () => {
    expect(parseRelayRoute('/r/wss%3A%2F%2Fnos.lol')).toBe('wss://nos.lol')
  })

  it('round-trips toRelay output', () => {
    const url = 'wss://relay.damus.io'
    expect(parseRelayRoute(toRelay(url))).toBe(url)
  })

  it('still decodes the legacy bare /relays/<encoded> route (back-compat)', () => {
    expect(parseRelayRoute('/relays/wss%3A%2F%2Fnos.lol')).toBe('wss://nos.lol')
  })

  it('returns null for the /relays/<encoded>/reviews sub-route', () => {
    expect(parseRelayRoute('/relays/wss%3A%2F%2Fnos.lol/reviews')).toBeNull()
  })

  it('returns null for unrelated routes', () => {
    expect(parseRelayRoute(`/p/${NPUB}`)).toBeNull()
    expect(parseRelayRoute('/t/nostr')).toBeNull()
    expect(parseRelayRoute('/notes/abc')).toBeNull()
  })
})

describe('routeOpensOwnColumn — Detail-column replace-mode delegation policy', () => {
  // TRUE: routes the deck turns into a standing / content column. Inside a
  // Detail column these must delegate to the deck-level push (spawn/focus
  // their own column) rather than drill inline — both because they're
  // column-shaped surfaces and because the inline SECONDARY_ROUTES table only
  // knows the LEGACY url forms, so the canonical forms the app now emits would
  // silently no-op if drilled.
  describe('canonical surfaces the app emits today (the reported bug)', () => {
    it('returns true for a canonical /p/<npub> profile route', () => {
      expect(routeOpensOwnColumn(`/p/${NPUB}`)).toBe(true)
    })

    it('returns true for a canonical /p/<nprofile> profile route', () => {
      expect(routeOpensOwnColumn(`/p/${NPROFILE}`)).toBe(true)
    })

    it('returns true for a canonical /t/<tag> hashtag route', () => {
      expect(routeOpensOwnColumn('/t/nostr')).toBe(true)
    })

    it('returns true for a canonical /r/<encoded> relay route', () => {
      expect(routeOpensOwnColumn(toRelay('wss://nos.lol'))).toBe(true)
    })
  })

  describe('legacy surfaces (back-compat — still column-shaped)', () => {
    it('returns true for a legacy /users/<npub> profile route', () => {
      expect(routeOpensOwnColumn(`/users/${NPUB}`)).toBe(true)
    })

    it('returns true for a legacy /notes?t=<tag> hashtag route', () => {
      expect(routeOpensOwnColumn('/notes?t=nostr')).toBe(true)
    })

    it('returns true for a legacy /relays/<encoded> relay route', () => {
      expect(routeOpensOwnColumn('/relays/wss%3A%2F%2Fnos.lol')).toBe(true)
    })
  })

  describe('singleton standing surfaces', () => {
    it('returns true for the bare /search route', () => {
      expect(routeOpensOwnColumn('/search')).toBe(true)
    })

    it('returns true for a pre-populated /search?q=foo route', () => {
      expect(routeOpensOwnColumn('/search?q=foo')).toBe(true)
    })

    it('returns true for /notifications', () => {
      expect(routeOpensOwnColumn('/notifications')).toBe(true)
    })

    it('returns true for /bookmarks', () => {
      expect(routeOpensOwnColumn('/bookmarks')).toBe(true)
    })

    it('returns true for /mutes', () => {
      expect(routeOpensOwnColumn('/mutes')).toBe(true)
    })

    it('returns true for the /me self-profile shorthand', () => {
      expect(routeOpensOwnColumn('/me')).toBe(true)
    })

    it('returns true for the /profile self-profile shorthand', () => {
      expect(routeOpensOwnColumn('/profile')).toBe(true)
    })
  })

  // FALSE: genuine detail pages that drill inline within the Detail column's
  // own stack (this is what replace-mode is FOR).
  describe('detail pages that drill inline', () => {
    it('returns false for a /notes/<id> thread route (the core inline drill)', () => {
      expect(routeOpensOwnColumn('/notes/note1abcdef')).toBe(false)
    })

    it('returns false for the /users/<npub>/following sub-page', () => {
      expect(routeOpensOwnColumn(`/users/${NPUB}/following`)).toBe(false)
    })

    it('returns false for the /users/<npub>/relays sub-page', () => {
      expect(routeOpensOwnColumn(`/users/${NPUB}/relays`)).toBe(false)
    })

    it('returns false for the /relays/<encoded>/reviews sub-page', () => {
      expect(routeOpensOwnColumn('/relays/wss%3A%2F%2Fnos.lol/reviews')).toBe(false)
    })

    it('returns false for a /settings page', () => {
      expect(routeOpensOwnColumn('/settings')).toBe(false)
    })

    it('returns false for an /external-content page', () => {
      expect(routeOpensOwnColumn('/external-content?id=abc')).toBe(false)
    })
  })
})
