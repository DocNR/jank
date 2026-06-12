import { beforeEach, describe, expect, it, vi } from 'vitest'
import modalManager from '../modal-manager.service'

// modal-manager is a process singleton, so each test drains it first.
beforeEach(() => {
  while (modalManager.pop()) {
    /* drain */
  }
})

describe('modalManager.isOpen', () => {
  it('is false with no modals registered', () => {
    expect(modalManager.isOpen()).toBe(false)
  })

  it('flips true after register and false after unregister', () => {
    const cb = vi.fn()
    modalManager.register('a', cb)
    expect(modalManager.isOpen()).toBe(true)
    modalManager.unregister('a')
    expect(modalManager.isOpen()).toBe(false)
  })

  it('stays true while at least one modal remains', () => {
    modalManager.register('a', vi.fn())
    modalManager.register('b', vi.fn())
    modalManager.unregister('a')
    expect(modalManager.isOpen()).toBe(true)
    modalManager.unregister('b')
    expect(modalManager.isOpen()).toBe(false)
  })

  it('pop() drains entries and reports the empty state via isOpen', () => {
    modalManager.register('a', vi.fn())
    modalManager.register('b', vi.fn())
    expect(modalManager.pop()).toBe(true)
    expect(modalManager.isOpen()).toBe(true)
    expect(modalManager.pop()).toBe(true)
    expect(modalManager.isOpen()).toBe(false)
    expect(modalManager.pop()).toBe(false)
  })
})
