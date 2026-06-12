import { LRUCache } from 'lru-cache'
import { nip19 } from 'nostr-tools'

export function formatPubkey(pubkey: string) {
  const npub = pubkeyToNpub(pubkey)
  if (npub) {
    return formatNpub(npub)
  }
  return pubkey.slice(0, 4) + '...' + pubkey.slice(-4)
}

export function formatNpub(npub: string, length = 15) {
  // Keep at least 15 chars so the prefix always reveals "npub1" + 5 leading
  // chars. Vanity npubs (e.g. npub1clave) stay legible at a glance.
  if (length < 15) {
    length = 15
  }

  if (length >= 63) {
    return npub
  }

  const prefixLength = Math.floor((length - 5) / 2) + 5
  const suffixLength = length - prefixLength
  return npub.slice(0, prefixLength) + '...' + npub.slice(-suffixLength)
}

export function formatUserId(userId: string) {
  if (userId.startsWith('npub1')) {
    return formatNpub(userId)
  }
  return formatPubkey(userId)
}

export function pubkeyToNpub(pubkey: string) {
  try {
    return nip19.npubEncode(pubkey)
  } catch {
    return null
  }
}

export function userIdToPubkey(userId: string, throwOnInvalid = false): string {
  if (userId.startsWith('npub1') || userId.startsWith('nprofile1')) {
    try {
      const { type, data } = nip19.decode(userId)
      if (type === 'npub') {
        return data
      } else if (type === 'nprofile') {
        return data.pubkey
      }
    } catch (error) {
      if (throwOnInvalid) {
        throw new Error('Invalid id')
      }
      console.error('Error decoding userId:', userId, 'error:', error)
    }
  }
  return userId
}

export function isValidPubkey(pubkey: string) {
  return /^[0-9a-f]{64}$/.test(pubkey)
}

/**
 * Filter an authors/pubkeys array down to syntactically valid 64-char hex
 * pubkeys, dropping empties and malformed entries.
 *
 * Relays reject an entire REQ whose `authors` filter contains a non-hex item
 * ("bad req: error parsing authors: filter item too small"), which silently
 * drops the whole batch. Any fetcher building author-scoped REQs must sanitize
 * its authors array through this before issuing the query.
 */
export function filterValidPubkeys(pubkeys: string[]): string[] {
  return pubkeys.filter(isValidPubkey)
}

type HueSL = { h: number; s: number; l: number }

/**
 * Returns tuned (S, L) for a given hue so per-account colors stay
 * legible on dark backgrounds. Yellows desaturate slightly, blues
 * lighten, magentas/reds stay vivid.
 */
function tunedSL(h: number): { s: number; l: number } {
  if (h >= 40 && h < 90) return { s: 76, l: 56 } // yellows (incl. yellow-greens)
  if (h >= 90 && h < 160) return { s: 52, l: 52 } // greens
  if (h >= 160 && h < 200) return { s: 52, l: 52 } // cyan band (should be excluded; safe default)
  if (h >= 200 && h < 250) return { s: 70, l: 62 } // blues
  if (h >= 250 && h < 300) return { s: 62, l: 64 } // purples
  return { s: 72, l: 60 } // magentas / reds
}

/**
 * Internal: golden-angle hue stepping from the first 4 hex chars of a
 * pubkey + brand-zone exclusion + per-hue S/L tuning. Stable per pubkey.
 */
function pubkeyToHueSL(pubkey: string): HueSL {
  const slice = pubkey.slice(0, 4)
  let num = parseInt(slice, 16)
  if (Number.isNaN(num)) num = 0
  // Golden-angle stepping gives even distribution at any deck size.
  // `num` from parseInt is non-negative for 4 hex chars, so the modulo
  // result is always in [0, 360) — no separate negative-h guard needed.
  let h = Math.floor((num * 137.508) % 360)
  // Brand-zone exclusion around brand cyan hsl(186 75% 45%): if the
  // hue lands in [176, 196] bump it to the nearest boundary so account
  // colors never collide with the brand surface.
  if (h >= 176 && h <= 196) {
    h = h < 186 ? 175 : 197
  }
  const { s, l } = tunedSL(h)
  return { h, s, l }
}

/**
 * Returns a CSS color string for an account's spectral identity. Pass
 * `alpha` to get a translucent value; omit it for solid.
 *
 * Use for inline styles, CSS custom-prop values, or any context that
 * accepts a full color string. Uses CSS Color Level 4 `hsl(h s% l% / a)`
 * syntax for consistency with the project's `--highlight` / `--primary`
 * tokens in src/index.css.
 */
export function pubkeyToHsl(pubkey: string, alpha?: number): string {
  const { h, s, l } = pubkeyToHueSL(pubkey)
  return alpha !== undefined ? `hsl(${h} ${s}% ${l}% / ${alpha})` : `hsl(${h} ${s}% ${l}%)`
}

/**
 * Returns the HSL components string ("h s% l%") for use as a value of
 * the project's component-style CSS tokens (--highlight, --primary, etc.)
 * where the existing CSS wraps the components in hsl() at the use site.
 */
export function pubkeyToHslComponents(pubkey: string): string {
  const { h, s, l } = pubkeyToHueSL(pubkey)
  return `${h} ${s}% ${l}%`
}

/**
 * Deterministic HSL hue (0–359) derived from the first 4 hex chars of a
 * pubkey. Kept for back-compat — new code should prefer
 * `pubkeyToHsl` / `pubkeyToHslComponents`, which add golden-angle
 * stepping, brand-zone exclusion, and per-hue S/L tuning.
 */
export function pubkeyToHue(pubkey: string): number {
  const slice = pubkey.slice(0, 4)
  const num = parseInt(slice, 16)
  if (Number.isNaN(num)) return 200
  return num % 360
}

const pubkeyImageCache = new LRUCache<string, string>({ max: 1000 })
export function generateImageByPubkey(pubkey: string): string {
  if (pubkeyImageCache.has(pubkey)) {
    return pubkeyImageCache.get(pubkey)!
  }

  const paddedPubkey = pubkey.padEnd(2, '0')

  // Split into 3 parts for colors and the rest for control points
  const colors: string[] = []
  const controlPoints: string[] = []
  for (let i = 0; i < 11; i++) {
    const part = paddedPubkey.slice(i * 6, (i + 1) * 6)
    if (i < 3) {
      colors.push(`#${part}`)
    } else {
      controlPoints.push(part)
    }
  }

  // Generate SVG with multiple radial gradients
  const gradients = controlPoints
    .map((point, index) => {
      const cx = parseInt(point.slice(0, 2), 16) % 100
      const cy = parseInt(point.slice(2, 4), 16) % 100
      const r = (parseInt(point.slice(4, 6), 16) % 35) + 30
      const c = colors[index % (colors.length - 1)]

      return `
        <radialGradient id="grad${index}-${pubkey}" cx="${cx}%" cy="${cy}%" r="${r}%">
          <stop offset="0%" style="stop-color:${c};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${c};stop-opacity:0" />
        </radialGradient>
        <rect width="100%" height="100%" fill="url(#grad${index}-${pubkey})" />
      `
    })
    .join('')

  const image = `
    <svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${colors[2]}" fill-opacity="0.3" />
      ${gradients}
    </svg>
  `
  const imageData = `data:image/svg+xml;base64,${btoa(image)}`

  pubkeyImageCache.set(pubkey, imageData)

  return imageData
}
