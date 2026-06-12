import { describe, expect, it } from 'vitest'
import { runBounded } from './decrypt-queue'

describe('runBounded', () => {
  it('never exceeds the concurrency limit and processes all items', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = Array.from({ length: 20 }, (_, i) => i)
    const results = await runBounded(items, 4, async (n) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return n * 2
    })
    expect(results.filter((r) => r !== null)).toHaveLength(20)
    expect(maxInFlight).toBeLessThanOrEqual(4)
  })

  it('maps a thrown worker to null, keeps going', async () => {
    const results = await runBounded([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    })
    expect(results).toContain(null)
    expect(results.filter((r) => r !== null)).toHaveLength(2)
  })

  it('processes newest-first when given a sorted input', async () => {
    const order: number[] = []
    await runBounded([3, 2, 1], 1, async (n) => {
      order.push(n)
      return n
    })
    expect(order).toEqual([3, 2, 1])
  })
})
