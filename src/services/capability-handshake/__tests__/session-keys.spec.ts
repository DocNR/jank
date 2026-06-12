import { describe, it, expect, beforeEach } from 'vitest'
import {
  getOrCreateSessionKey,
  releaseSessionKey,
  __resetSessionKeysForTests
} from '../session-keys'

beforeEach(() => __resetSessionKeysForTests())

describe('session-keys', () => {
  it('returns a stable keypair across calls for the same workspace owner', async () => {
    const k1 = await getOrCreateSessionKey('owner-pubkey-1')
    const k2 = await getOrCreateSessionKey('owner-pubkey-1')
    expect(k1.pubkey).toBe(k2.pubkey)
    expect(k1.signEvent).toBe(k2.signEvent)
  })

  it('returns a different keypair for a different owner', async () => {
    const a = await getOrCreateSessionKey('owner-a')
    const b = await getOrCreateSessionKey('owner-b')
    expect(a.pubkey).not.toBe(b.pubkey)
  })

  it('regenerates after release', async () => {
    const before = await getOrCreateSessionKey('owner-x')
    releaseSessionKey('owner-x')
    const after = await getOrCreateSessionKey('owner-x')
    expect(after.pubkey).not.toBe(before.pubkey)
  })
})
