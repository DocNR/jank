import { afterEach, describe, expect, it, vi } from 'vitest'
import postEditor from './post-editor.service'

// post-editor.service is a shared singleton; drain any open count between tests
// so leaked state from one case can't bleed into the next.
afterEach(() => {
  while (postEditor.isAnyOpen) {
    postEditor.unregisterOpen()
  }
})

describe('post-editor.service open tracking', () => {
  it('starts closed', () => {
    expect(postEditor.isAnyOpen).toBe(false)
  })

  it('reports open after a register', () => {
    postEditor.registerOpen()
    expect(postEditor.isAnyOpen).toBe(true)
  })

  it('refcounts nested opens — stays open until the last close', () => {
    postEditor.registerOpen()
    postEditor.registerOpen()
    expect(postEditor.isAnyOpen).toBe(true)

    postEditor.unregisterOpen()
    expect(postEditor.isAnyOpen).toBe(true) // one composer still open

    postEditor.unregisterOpen()
    expect(postEditor.isAnyOpen).toBe(false)
  })

  it('never underflows below closed', () => {
    postEditor.unregisterOpen()
    postEditor.unregisterOpen()
    expect(postEditor.isAnyOpen).toBe(false)
  })

  it('fires openStateChange only on the closed<->open boundary', () => {
    const onChange = vi.fn()
    postEditor.addEventListener('openStateChange', onChange)

    postEditor.registerOpen() // closed -> open: fires
    postEditor.registerOpen() // open -> still open: no fire
    expect(onChange).toHaveBeenCalledTimes(1)

    postEditor.unregisterOpen() // still open: no fire
    expect(onChange).toHaveBeenCalledTimes(1)

    postEditor.unregisterOpen() // open -> closed: fires
    expect(onChange).toHaveBeenCalledTimes(2)

    postEditor.removeEventListener('openStateChange', onChange)
  })
})
