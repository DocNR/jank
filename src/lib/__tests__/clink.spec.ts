import { bech32 } from '@scure/base'
import { describe, expect, it } from 'vitest'
import { decodeNoffer } from '../clink'

// Live fixture: the offer Vitor Pamplona posted in note b4f20ec2..., decoded
// by hand against shocknet/CLINK specs/clink-offers.md (Gate 1 evidence).
const VITOR_NOFFER =
  'noffer1qszqqqqqvspszqqzg3jnzwfexscrzdnrxgexywp5x4nrzwrzvscrqve5v4jnzv3jxucr2wphv3jnxce5v33rsvtzx5envvnpvs6r2cfjxdsnxv3exp3rsde5xvurxcsprfmhxue69uhhxarjvee8jtnndphkx6ewdejhgam0wf4sqgrka4zlqr820wk9nkxsklfqfpy02vva0wtvzs8lkm7t424s5y75fck942h6'
const VITOR_PUBKEY = '76ed45f00cea7bac59d8d0b7d204848f5319d7b96c140ffb6fcbaaab0a13d44e'
const VITOR_RELAY = 'wss://strfry.shock.network'
const VITOR_OFFER_ID = 'e1994016c22b845f18bd0034ee12270587de3c4db81b5362ad45a23a3290b874383b'

function tlv(type: number, value: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + value.length)
  out[0] = type
  out[1] = value.length
  out.set(value, 2)
  return out
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function uintBE(n: number, len: number): Uint8Array {
  const out = new Uint8Array(len)
  for (let i = len - 1; i >= 0; i--) {
    out[i] = n & 0xff
    n = Math.floor(n / 256)
  }
  return out
}

function encodeNofferForTest(parts: Uint8Array[]): string {
  const total = parts.reduce((acc, p) => acc + p.length, 0)
  const data = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    data.set(p, offset)
    offset += p.length
  }
  return bech32.encode('noffer', bech32.toWords(data), 5000)
}

const REQUIRED = (pubkey = VITOR_PUBKEY) => [
  tlv(0, hexBytes(pubkey)),
  tlv(1, utf8('wss://relay.example.com')),
  tlv(2, utf8('offer-abc'))
]

describe('decodeNoffer', () => {
  it('decodes the live fixture (fixed 100-sat offer)', () => {
    const offer = decodeNoffer(VITOR_NOFFER)
    expect(offer).toEqual({
      pubkey: VITOR_PUBKEY,
      relay: VITOR_RELAY,
      offerId: VITOR_OFFER_ID,
      priceType: 0,
      price: 100
    })
  })

  it('accepts a nostr:-prefixed string', () => {
    const offer = decodeNoffer(`nostr:${VITOR_NOFFER}`)
    expect(offer?.pubkey).toBe(VITOR_PUBKEY)
  })

  it('accepts an all-uppercase string (QR convention)', () => {
    const offer = decodeNoffer(VITOR_NOFFER.toUpperCase())
    expect(offer?.pubkey).toBe(VITOR_PUBKEY)
  })

  it('defaults to spontaneous (type 2) when TLV 3 and 4 are absent', () => {
    const s = encodeNofferForTest(REQUIRED())
    expect(decodeNoffer(s)).toEqual({
      pubkey: VITOR_PUBKEY,
      relay: 'wss://relay.example.com',
      offerId: 'offer-abc',
      priceType: 2
    })
  })

  it('treats TLV 4 without TLV 3 as spontaneous with a suggested amount', () => {
    // CLINK leaves this case undefined and calls TLV 4 "primarily for display
    // purposes" — reading it as a suggested amount is the non-blocking choice.
    const s = encodeNofferForTest([...REQUIRED(), tlv(4, uintBE(2100, 2))])
    const offer = decodeNoffer(s)
    expect(offer?.priceType).toBe(2)
    expect(offer?.price).toBe(2100)
  })

  it('decodes a variable offer with currency', () => {
    const s = encodeNofferForTest([
      ...REQUIRED(),
      tlv(3, uintBE(1, 1)),
      tlv(4, uintBE(5, 1)),
      tlv(5, utf8('USD'))
    ])
    const offer = decodeNoffer(s)
    expect(offer?.priceType).toBe(1)
    expect(offer?.price).toBe(5)
    expect(offer?.currency).toBe('USD')
  })

  it('decodes a spontaneous offer with a suggested price', () => {
    const s = encodeNofferForTest([...REQUIRED(), tlv(3, uintBE(2, 1)), tlv(4, uintBE(21, 1))])
    const offer = decodeNoffer(s)
    expect(offer?.priceType).toBe(2)
    expect(offer?.price).toBe(21)
  })

  it('skips unknown TLV types (forward compat)', () => {
    const s = encodeNofferForTest([...REQUIRED(), tlv(99, utf8('future'))])
    expect(decodeNoffer(s)?.pubkey).toBe(VITOR_PUBKEY)
  })

  it('tolerates duplicated unknown TLV types (forward compat)', () => {
    const s = encodeNofferForTest([...REQUIRED(), tlv(99, utf8('a')), tlv(99, utf8('b'))])
    expect(decodeNoffer(s)?.pubkey).toBe(VITOR_PUBKEY)
  })

  describe('returns null on malformed input (silently)', () => {
    it('rejects garbage', () => {
      expect(decodeNoffer('noffer1notbech32atall')).toBeNull()
      expect(decodeNoffer('')).toBeNull()
      expect(decodeNoffer('noffer1')).toBeNull()
    })

    it('rejects a corrupted checksum', () => {
      const corrupted = VITOR_NOFFER.slice(0, -1) + (VITOR_NOFFER.endsWith('6') ? '7' : '6')
      expect(decodeNoffer(corrupted)).toBeNull()
    })

    it('rejects a wrong HRP', () => {
      const s = bech32.encode('nother', bech32.toWords(hexBytes(VITOR_PUBKEY)), 5000)
      expect(decodeNoffer(s)).toBeNull()
    })

    it('rejects a truncated TLV (length byte past the end)', () => {
      const bad = new Uint8Array([0, 32, 1, 2, 3]) // claims 32 bytes, has 3
      const s = bech32.encode('noffer', bech32.toWords(bad), 5000)
      expect(decodeNoffer(s)).toBeNull()
    })

    it('rejects a pubkey that is not 32 bytes', () => {
      const s = encodeNofferForTest([
        tlv(0, hexBytes(VITOR_PUBKEY).slice(0, 31)),
        tlv(1, utf8('wss://relay.example.com')),
        tlv(2, utf8('offer-abc'))
      ])
      expect(decodeNoffer(s)).toBeNull()
    })

    it('rejects when a required TLV is missing', () => {
      const noPubkey = encodeNofferForTest([
        tlv(1, utf8('wss://relay.example.com')),
        tlv(2, utf8('offer-abc'))
      ])
      const noRelay = encodeNofferForTest([tlv(0, hexBytes(VITOR_PUBKEY)), tlv(2, utf8('o'))])
      const noOfferId = encodeNofferForTest([
        tlv(0, hexBytes(VITOR_PUBKEY)),
        tlv(1, utf8('wss://relay.example.com'))
      ])
      expect(decodeNoffer(noPubkey)).toBeNull()
      expect(decodeNoffer(noRelay)).toBeNull()
      expect(decodeNoffer(noOfferId)).toBeNull()
    })

    it('rejects a relay that is not a websocket URL', () => {
      const s = encodeNofferForTest([
        tlv(0, hexBytes(VITOR_PUBKEY)),
        tlv(1, utf8('https://not-a-relay.example.com')),
        tlv(2, utf8('offer-abc'))
      ])
      expect(decodeNoffer(s)).toBeNull()
    })

    it('rejects an unknown price type', () => {
      const s = encodeNofferForTest([...REQUIRED(), tlv(3, uintBE(3, 1))])
      expect(decodeNoffer(s)).toBeNull()
    })

    it('rejects a duplicated known TLV type (payee-confusion guard)', () => {
      // A checksum-valid offer with two pubkeys decodes to different payees
      // in first-wins vs last-wins decoders — refuse it outright.
      const otherKey = '8125b911ed0e94dbe3008a0be48cfe5cd0c0b05923cfff917ae7e87da8400883'
      const dupPubkey = encodeNofferForTest([tlv(0, hexBytes(otherKey)), ...REQUIRED()])
      const dupOfferId = encodeNofferForTest([...REQUIRED(), tlv(2, utf8('second-offer-id'))])
      expect(decodeNoffer(dupPubkey)).toBeNull()
      expect(decodeNoffer(dupOfferId)).toBeNull()
    })

    it('rejects a priceType value that is not exactly 1 byte', () => {
      const s = encodeNofferForTest([...REQUIRED(), tlv(3, uintBE(2, 2)), tlv(4, uintBE(1, 1))])
      expect(decodeNoffer(s)).toBeNull()
    })

    it('rejects an explicit fixed offer without a price', () => {
      // Type 0 is defined as "price stated in TLV 4" — without it the card
      // could neither display an amount nor validate the invoice.
      const s = encodeNofferForTest([...REQUIRED(), tlv(3, uintBE(0, 1))])
      expect(decodeNoffer(s)).toBeNull()
    })

    it('rejects a pubkey that is not on the secp256k1 curve', () => {
      const s = encodeNofferForTest([
        tlv(0, hexBytes('ff'.repeat(32))),
        tlv(1, utf8('wss://relay.example.com')),
        tlv(2, utf8('offer-abc'))
      ])
      expect(decodeNoffer(s)).toBeNull()
    })

    it('rejects a currency on a non-variable offer', () => {
      const s = encodeNofferForTest([
        ...REQUIRED(),
        tlv(3, uintBE(0, 1)),
        tlv(4, uintBE(100, 1)),
        tlv(5, utf8('USD'))
      ])
      expect(decodeNoffer(s)).toBeNull()
    })

    it('rejects a price wider than 6 bytes (overflow guard)', () => {
      const s = encodeNofferForTest([...REQUIRED(), tlv(3, uintBE(0, 1)), tlv(4, new Uint8Array(8))])
      expect(decodeNoffer(s)).toBeNull()
    })
  })
})
