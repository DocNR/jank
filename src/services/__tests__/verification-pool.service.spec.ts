import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test the pool's dispatch logic with an injected mock verifier so we
// don't depend on a real Worker spawning in vitest's jsdom env. The real
// worker is integration-tested manually in Task 6.
import { createVerificationPool } from '@/services/verification-pool.service'
import type { Event as NEvent } from 'nostr-tools'

const fakeValidEvent = (id: string): NEvent =>
  ({
    id,
    kind: 1,
    pubkey: 'a'.repeat(64),
    created_at: 0,
    tags: [],
    content: '',
    sig: 'b'.repeat(128)
  }) as NEvent

describe('verification-pool (injected verifier)', () => {
  let mockVerify: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockVerify = vi.fn((evt: NEvent) => evt.id.startsWith('valid'))
  })

  it('returns true for valid events via injected verifier', async () => {
    const pool = createVerificationPool({ injectedVerifier: mockVerify })
    const result = await pool.verify(fakeValidEvent('valid-1'))
    expect(result).toBe(true)
    expect(mockVerify).toHaveBeenCalledTimes(1)
    pool.dispose()
  })

  it('returns false for invalid events', async () => {
    const pool = createVerificationPool({ injectedVerifier: mockVerify })
    const result = await pool.verify(fakeValidEvent('bad-1'))
    expect(result).toBe(false)
    pool.dispose()
  })

  it('handles concurrent verifications without crossing wires', async () => {
    const pool = createVerificationPool({ injectedVerifier: mockVerify })
    const results = await Promise.all([
      pool.verify(fakeValidEvent('valid-a')),
      pool.verify(fakeValidEvent('bad-b')),
      pool.verify(fakeValidEvent('valid-c')),
      pool.verify(fakeValidEvent('bad-d'))
    ])
    expect(results).toEqual([true, false, true, false])
    pool.dispose()
  })

  it('falls back to injected verifier on Worker constructor failure', async () => {
    // Simulate by passing forceMainThread (the same code path used when
    // `new Worker()` throws in real browsers).
    const pool = createVerificationPool({
      injectedVerifier: mockVerify,
      forceMainThread: true
    })
    const result = await pool.verify(fakeValidEvent('valid-z'))
    expect(result).toBe(true)
    pool.dispose()
  })
})
