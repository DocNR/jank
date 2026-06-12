import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { buildPairedAgent, isValidNpub } from '../pairing-helpers'

const AGENT_HEX = 'a'.repeat(64)
const CHAT_HEX = 'b'.repeat(64)
const AGENT_NPUB = nip19.npubEncode(AGENT_HEX)
const CHAT_NPUB = nip19.npubEncode(CHAT_HEX)

describe('isValidNpub', () => {
  it('accepts a well-formed npub', () => {
    expect(isValidNpub(AGENT_NPUB)).toBe(true)
  })

  it('rejects empty / non-npub / malformed input', () => {
    expect(isValidNpub('')).toBe(false)
    expect(isValidNpub('npub1notvalid')).toBe(false)
    expect(isValidNpub(AGENT_HEX)).toBe(false)
    expect(isValidNpub(nip19.nsecEncode(new Uint8Array(32)))).toBe(false)
  })
})

describe('buildPairedAgent', () => {
  it('builds a read-only agent from a valid agent npub', () => {
    const result = buildPairedAgent({ agentNpub: AGENT_NPUB, displayName: 'Claude' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.agent.pubkey).toBe(AGENT_HEX)
    expect(result.agent.npub).toBe(AGENT_NPUB)
    expect(result.agent.name).toBe('Claude')
    expect(result.agent.scope).toBe('read-only')
    expect(typeof result.agent.pairedAt).toBe('number')
  })

  it('populates agentChatNpub when a valid chat npub is provided', () => {
    const result = buildPairedAgent({
      agentNpub: AGENT_NPUB,
      agentChatNpub: CHAT_NPUB
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.agent.agentChatNpub).toBe(CHAT_NPUB)
  })

  it('leaves agentChatNpub UNSET when the chat field is blank', () => {
    const result = buildPairedAgent({ agentNpub: AGENT_NPUB, agentChatNpub: '' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('agentChatNpub' in result.agent).toBe(false)
    expect(result.agent.agentChatNpub).toBeUndefined()
  })

  it('treats a whitespace-only chat field as blank (no chat surface)', () => {
    const result = buildPairedAgent({ agentNpub: AGENT_NPUB, agentChatNpub: '   ' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.agent.agentChatNpub).toBeUndefined()
  })

  it('never auto-defaults agentChatNpub to the tool-auth key', () => {
    const result = buildPairedAgent({ agentNpub: AGENT_NPUB })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.agent.agentChatNpub).toBeUndefined()
  })

  it('rejects an invalid chat npub and does not produce an agent', () => {
    const result = buildPairedAgent({
      agentNpub: AGENT_NPUB,
      agentChatNpub: 'npub1bogus'
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('invalid-chat-npub')
  })

  it('rejects an invalid agent npub', () => {
    const result = buildPairedAgent({ agentNpub: 'not-an-npub' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('invalid-agent-npub')
  })
})
