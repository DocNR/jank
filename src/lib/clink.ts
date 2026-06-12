import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bech32 } from '@scure/base'

/**
 * CLINK Offers (https://github.com/shocknet/CLINK/blob/master/specs/clink-offers.md)
 *
 * A `noffer1...` string is a static Lightning payment code: bech32-encoded TLV
 * data identifying a receiving service (pubkey + relay + opaque offer id) plus
 * optional pricing info. Paying one is a kind-21001 NIP-44 round trip that
 * yields a BOLT11 invoice (see clink.service.ts).
 */

export enum NofferPriceType {
  /** Price stated in the offer's price field (sats) */
  Fixed = 0,
  /** Price determined by the service at request time (e.g. fiat conversion) */
  Variable = 1,
  /** Payer specifies the amount */
  Spontaneous = 2
}

export type TNoffer = {
  /** 32-byte hex pubkey of the receiving service (TLV 0) */
  pubkey: string
  /** Relay URL where the service listens for payment requests (TLV 1) */
  relay: string
  /** Opaque offer identifier defined by the service (TLV 2) */
  offerId: string
  /** Pricing type (TLV 3); defaults per spec when absent */
  priceType: NofferPriceType
  /** Price (TLV 4) — sats, or `currency` units for variable offers */
  price?: number
  /** Currency code (TLV 5) — only valid on variable offers */
  currency?: string
}

const TLV_PUBKEY = 0
const TLV_RELAY = 1
const TLV_OFFER_ID = 2
const TLV_PRICE_TYPE = 3
const TLV_PRICE = 4
const TLV_CURRENCY = 5

// Matches nostr-tools' nip19 Bech32MaxSize
const BECH32_MAX_SIZE = 5000

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Decode a CLINK Offer string. Tolerates an optional `nostr:` prefix and
 * all-uppercase input (QR convention). Returns null on ANY malformed input —
 * never throws, never logs (note content is hostile; see the PR #56
 * malformed-bolt11 lesson).
 */
export function decodeNoffer(noffer: string): TNoffer | null {
  try {
    let s = noffer
    if (s.toLowerCase().startsWith('nostr:')) {
      s = s.slice(6)
    }
    if (s === s.toUpperCase()) {
      s = s.toLowerCase()
    }
    if (!s.startsWith('noffer1')) return null

    const { prefix, words } = bech32.decode(s as `${string}1${string}`, BECH32_MAX_SIZE)
    if (prefix !== 'noffer') return null
    const data = bech32.fromWords(words)

    // Walk the TLV stream. A duplicated KNOWN type is rejected outright: a
    // checksum-valid offer carrying two pubkeys would pay different parties
    // in first-wins vs last-wins decoders. Unknown types skip (forward compat).
    const seen = new Map<number, Uint8Array>()
    let i = 0
    while (i < data.length) {
      if (i + 2 > data.length) return null
      const type = data[i]
      const length = data[i + 1]
      if (i + 2 + length > data.length) return null
      if (type <= TLV_CURRENCY) {
        if (seen.has(type)) return null
        seen.set(type, data.slice(i + 2, i + 2 + length))
      }
      i += 2 + length
    }

    const pubkeyBytes = seen.get(TLV_PUBKEY)
    const relayBytes = seen.get(TLV_RELAY)
    const offerIdBytes = seen.get(TLV_OFFER_ID)
    if (!pubkeyBytes || pubkeyBytes.length !== 32 || !relayBytes || !offerIdBytes) {
      return null
    }

    const pubkey = bytesToHex(pubkeyBytes)
    // Must be a valid x-only point — otherwise the NIP-44 ECDH at pay time
    // throws instead of failing the silent-null contract here
    secp256k1.Point.fromHex('02' + pubkey)

    const relay = new TextDecoder().decode(relayBytes)
    if (!/^wss?:\/\/.+/.test(relay)) return null

    const offerId = new TextDecoder().decode(offerIdBytes)
    if (!offerId) return null

    const priceTypeBytes = seen.get(TLV_PRICE_TYPE)
    const priceBytes = seen.get(TLV_PRICE)
    const currencyBytes = seen.get(TLV_CURRENCY)

    let price: number | undefined
    if (priceBytes) {
      // Big-endian unsigned int; cap at 6 bytes so the value stays a safe JS integer
      if (priceBytes.length === 0 || priceBytes.length > 6) return null
      price = 0
      for (const b of priceBytes) {
        price = price * 256 + b
      }
    }

    let priceType: NofferPriceType
    if (priceTypeBytes) {
      if (priceTypeBytes.length !== 1 || priceTypeBytes[0] > NofferPriceType.Spontaneous) {
        return null
      }
      priceType = priceTypeBytes[0]
      // Type 0 is "price stated in TLV 4" — without one the card could neither
      // display an amount nor validate the returned invoice
      if (priceType === NofferPriceType.Fixed && price === undefined) return null
    } else {
      // No explicit type: CLINK only defines the no-price case (spontaneous).
      // A bare TLV 4 is "primarily for display purposes" — read it as a
      // suggested amount on a spontaneous offer rather than a hard price.
      priceType = NofferPriceType.Spontaneous
    }

    const result: TNoffer = { pubkey, relay, offerId, priceType }
    if (price !== undefined) {
      result.price = price
    }
    if (currencyBytes) {
      // Spec: currency requires the variable pricing type
      if (priceType !== NofferPriceType.Variable) return null
      result.currency = new TextDecoder().decode(currencyBytes)
    }
    return result
  } catch {
    return null
  }
}
