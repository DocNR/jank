import { describe, it, expect } from 'vitest'
import { isNotificationUnread, addCapped } from './notification-read'

const evt = (id: string, created_at: number) => ({ id, created_at }) as { id: string; created_at: number }

describe('isNotificationUnread', () => {
  it('is unread when newer than floor and not in the read-set', () => {
    expect(isNotificationUnread(evt('a', 100), 50, new Set())).toBe(true)
  })
  it('is read when at or below the floor', () => {
    expect(isNotificationUnread(evt('a', 50), 50, new Set())).toBe(false)
    expect(isNotificationUnread(evt('a', 49), 50, new Set())).toBe(false)
  })
  it('is read when in the read-set even if newer than floor', () => {
    expect(isNotificationUnread(evt('a', 100), 50, new Set(['a']))).toBe(false)
  })
})

describe('addCapped', () => {
  it('adds an id', () => {
    expect([...addCapped(new Set(['a']), 'b', 10)]).toEqual(['a', 'b'])
  })
  it('is a no-op when the id is already present (returns same ref, preserves order)', () => {
    const set = new Set(['a', 'b'])
    expect(addCapped(set, 'a', 10)).toBe(set)
    expect([...set]).toEqual(['a', 'b'])
  })
  it('evicts oldest (FIFO) when over the cap', () => {
    expect([...addCapped(new Set(['a', 'b', 'c']), 'd', 3)]).toEqual(['b', 'c', 'd'])
  })
})
