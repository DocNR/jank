import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../profile-fetcher.service', () => ({
  default: {
    fetchProfile: vi.fn()
  }
}))

import profileFetcher from '../../profile-fetcher.service'
import { getProfileHandler, getProfileDef } from '../get-profile'

const pubkey = 'a'.repeat(64)
const ctx = { workspaceOwner: 'b'.repeat(64), senderPubkey: 'c'.repeat(64) }

describe('get_profile', () => {
  beforeEach(() => {
    vi.mocked(profileFetcher.fetchProfile).mockReset()
  })

  it('def has the correct shape', () => {
    expect(getProfileDef.name).toBe('get_profile')
    expect((getProfileDef.inputSchema as any).type).toBe('object')
    expect((getProfileDef.inputSchema as any).required).toContain('pubkey')
    expect((getProfileDef.inputSchema as any).additionalProperties).toBe(false)
  })

  it('returns the profile fields on the happy path', async () => {
    vi.mocked(profileFetcher.fetchProfile).mockResolvedValue({
      pubkey,
      npub: 'npub1xxx',
      username: 'Alice',
      avatar: 'https://example.com/a.png',
      about: 'hello',
      nip05: 'alice@example.com',
      banner: 'https://example.com/banner.png',
      website: 'https://alice.example',
      lud16: 'alice@walletofsatoshi.com'
    } as any)

    const result = await getProfileHandler({ pubkey }, ctx)
    expect(profileFetcher.fetchProfile).toHaveBeenCalledWith(pubkey)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const sc = result.structuredContent as any
      expect(sc.pubkey).toBe(pubkey)
      expect(sc.npub).toBe('npub1xxx')
      expect(sc.username).toBe('Alice')
      expect(sc.avatar).toBe('https://example.com/a.png')
      expect(sc.about).toBe('hello')
      expect(sc.nip05).toBe('alice@example.com')
      expect(sc.banner).toBe('https://example.com/banner.png')
      expect(sc.website).toBe('https://alice.example')
      expect(sc.lud16).toBe('alice@walletofsatoshi.com')
      // human-readable side carries the username
      expect((result.content as any[])[0]).toEqual({ type: 'text', text: 'Alice' })
    }
  })

  it('returns ok with empty structuredContent when fetch yields null', async () => {
    vi.mocked(profileFetcher.fetchProfile).mockResolvedValue(null)
    const result = await getProfileHandler({ pubkey }, ctx)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.structuredContent).toEqual({})
      expect((result.content as any[])[0]).toEqual({ type: 'text', text: '(no profile)' })
    }
  })

  it('rejects a malformed pubkey with -32602', async () => {
    const result = await getProfileHandler({ pubkey: 'not-a-pubkey' }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32602)
    }
    expect(profileFetcher.fetchProfile).not.toHaveBeenCalled()
  })

  it('rejects an uppercase hex pubkey with -32602 (must be lowercase)', async () => {
    const result = await getProfileHandler({ pubkey: 'A'.repeat(64) }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32602)
    }
  })

  it('rejects a missing pubkey with -32602', async () => {
    const result = await getProfileHandler({}, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32602)
    }
  })

  it('returns -32603 when the fetch throws', async () => {
    vi.mocked(profileFetcher.fetchProfile).mockRejectedValue(new Error('relay down'))
    const result = await getProfileHandler({ pubkey }, ctx)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe(-32603)
      expect(result.error.message).toBe('profile fetch failed')
    }
  })

  it('omits undefined optional fields from structuredContent', async () => {
    vi.mocked(profileFetcher.fetchProfile).mockResolvedValue({
      pubkey,
      npub: 'npub1xxx',
      username: 'Bob'
    } as any)
    const result = await getProfileHandler({ pubkey }, ctx)
    if (result.ok) {
      const sc = result.structuredContent as any
      expect(sc.pubkey).toBe(pubkey)
      expect(sc.username).toBe('Bob')
      expect('avatar' in sc).toBe(false)
      expect('about' in sc).toBe(false)
    }
  })
})
