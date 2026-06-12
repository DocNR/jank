import { describe, it, expect } from 'vitest'
import { encodeEnvelope, decodeEnvelope } from '../envelope'

const fixtureUser = '0b91d3c1a8b5e2f9d7c4e6f8a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9'

describe('Cordn envelope (spec/02)', () => {
  it('encodes a kind-9 chat message with id derived per NIP-01', () => {
    const env = encodeEnvelope({
      pubkey: fixtureUser,
      kind: 9,
      tags: [],
      content: 'hello',
      created_at: 1700000000
    })
    expect(env.kind).toBe(9)
    expect(env.pubkey).toBe(fixtureUser)
    expect(env.id).toMatch(/^[a-f0-9]{64}$/)
    expect((env as any).sig).toBeUndefined() // MUST NOT include sig
  })

  it('decode round-trips successfully', () => {
    const env = encodeEnvelope({
      pubkey: fixtureUser,
      kind: 9,
      tags: [['e', 'abc', 'wss://relay']],
      content: 'reply',
      created_at: 1700000001
    })
    const json = JSON.stringify(env)
    const decoded = decodeEnvelope(json, fixtureUser)
    expect(decoded.content).toBe('reply')
  })

  it('rejects an envelope whose pubkey does not match the MLS sender', () => {
    const env = encodeEnvelope({
      pubkey: fixtureUser,
      kind: 9,
      tags: [],
      content: 'x',
      created_at: 1700000000
    })
    expect(() => decodeEnvelope(JSON.stringify(env), 'a-different-pubkey')).toThrow(/sender/i)
  })

  it('rejects an envelope whose recomputed id does not match', () => {
    const env = encodeEnvelope({
      pubkey: fixtureUser,
      kind: 9,
      tags: [],
      content: 'x',
      created_at: 1700000000
    })
    const tampered = { ...env, content: 'tampered' }
    expect(() => decodeEnvelope(JSON.stringify(tampered), fixtureUser)).toThrow(/id/i)
  })
})
