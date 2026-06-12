/**
 * NIP-44 v3 padding algorithm.
 *
 * Spec: https://github.com/nostr-land/nip44v3 (pinned `5680754`).
 * Reference impl: nostr-land/ncrypt-go (BSD-3), `nip44v3/padding.go`.
 *
 * The algorithm rounds a non-negative byte length up to a quantized "chunk"
 * size derived from the next power of two — small enough to obscure exact
 * lengths, large enough to keep the overhead bounded as messages grow.
 */

export const MINIMUM_SIZE = 32
export const CHUNK_SUBDIVS_SMALL = 4
export const CHUNK_SUBDIVS_LARGE = 8
export const CHUNK_LARGE_THRESHOLD = 32768

/**
 * Maximum plaintext length supported by the JavaScript implementation. The
 * spec allows up to 2^31 - 1, but the bit-shift used below to compute the
 * next power of two is 32-bit in JS: `1 << 31` wraps to a negative number
 * and `1 << 32` wraps to 1 (the shift count is taken modulo 32). 2^30
 * (~1 GiB) is the largest power-of-two cap that keeps the shift count in
 * the safe 0..30 range and is still far above any plausible browser-side
 * payload (largest known use today is NIP-78 deck sync at a few KB).
 *
 * Callers passing `len > MAX_LENGTH` get an explicit error rather than
 * silently-wrong padding. A future port using BigInt or arithmetic instead
 * of bit ops can raise this cap.
 */
export const MAX_LENGTH = 0x40000000 // 2^30

export function targetSize(len: number): number {
  if (!Number.isInteger(len) || len < 0) {
    throw new Error(`NIP44v3.padding: length must be a non-negative integer, got ${len}`)
  }
  if (len > MAX_LENGTH) {
    throw new Error(`NIP44v3.padding: length ${len} exceeds in-browser cap of ${MAX_LENGTH} (2^30); see MAX_LENGTH doc comment`)
  }
  if (len === 0) return MINIMUM_SIZE

  // next_power = 2 ** ceil(log2(len)). Bit ops are 32-bit in JS; safe
  // within the MAX_LENGTH cap above (shift count stays in 0..30).
  let nextPower: number
  if (len === 1) {
    nextPower = 1
  } else {
    nextPower = 1 << (32 - Math.clz32(len - 1))
  }

  const chunkSubdivs = nextPower >= CHUNK_LARGE_THRESHOLD ? CHUNK_SUBDIVS_LARGE : CHUNK_SUBDIVS_SMALL
  const chunkSize = Math.max(MINIMUM_SIZE, Math.floor(nextPower / chunkSubdivs))
  return chunkSize * Math.ceil(len / chunkSize)
}
