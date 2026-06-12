import { describe, expect, it, vi } from 'vitest'
import type { Event as NEvent } from 'nostr-tools'
import overlay from '@/services/caches/list-overlay.service'

const ev = (id: string): NEvent =>
  ({ id, kind: 3, pubkey: 'pk1', created_at: 1, tags: [], content: '', sig: 's' }) as NEvent

describe('listOverlay', () => {
  it('setOptimistic notifies + getSnapshot returns the optimistic event; clear reverts', () => {
    const cb = vi.fn()
    const unsub = overlay.subscribe('3:pk1:', cb)
    overlay.setOptimistic('3:pk1:', ev('opt'))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(overlay.getSnapshot('3:pk1:')?.id).toBe('opt')
    overlay.clear('3:pk1:')
    expect(cb).toHaveBeenCalledTimes(2)
    expect(overlay.getSnapshot('3:pk1:')).toBeUndefined()
    unsub()
  })

  it('clear on an empty coordinate does not notify', () => {
    const cb = vi.fn()
    overlay.subscribe('10000:pk1:', cb)
    overlay.clear('10000:pk1:')
    expect(cb).not.toHaveBeenCalled()
  })
})
