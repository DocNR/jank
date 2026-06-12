import { describe, expect, it } from 'vitest'
import vectors from './test-vectors.json'
import { targetSize, MINIMUM_SIZE, CHUNK_LARGE_THRESHOLD } from '../padding'

const paddedLength = vectors.padded_length as Array<[number, number]>

describe('NIP-44 v3 padding constants', () => {
  it('exposes spec constants', () => {
    expect(MINIMUM_SIZE).toBe(32)
    expect(CHUNK_LARGE_THRESHOLD).toBe(32768)
  })
})

describe('NIP-44 v3 targetSize() — 176 spec vectors', () => {
  it('passes every padded_length vector', () => {
    const failures: Array<{ input: number; expected: number; actual: number }> = []
    for (const [unpadded, expected] of paddedLength) {
      const actual = targetSize(unpadded)
      if (actual !== expected) failures.push({ input: unpadded, expected, actual })
    }
    if (failures.length > 0) {
      const preview = failures.slice(0, 5).map(f => `  len=${f.input} expected=${f.expected} got=${f.actual}`).join('\n')
      throw new Error(`${failures.length}/${paddedLength.length} padding vectors failed:\n${preview}`)
    }
    expect(failures).toEqual([])
  })

  it('returns MINIMUM_SIZE for length 0', () => {
    expect(targetSize(0)).toBe(32)
  })

  it('returns MINIMUM_SIZE for length 1', () => {
    expect(targetSize(1)).toBe(32)
  })

  it('returns MINIMUM_SIZE for length 32', () => {
    expect(targetSize(32)).toBe(32)
  })

  it('throws on negative length', () => {
    expect(() => targetSize(-1)).toThrow()
  })

  it('throws on non-integer length', () => {
    expect(() => targetSize(1.5)).toThrow()
  })
})
