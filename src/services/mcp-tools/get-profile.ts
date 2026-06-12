import type { TToolDefinition, ToolHandler } from '../context-vm-server.service'
import profileFetcher from '../profile-fetcher.service'

const HEX_PUBKEY = /^[a-f0-9]{64}$/

export const getProfileDef: TToolDefinition = {
  name: 'get_profile',
  description: 'Fetch public Nostr profile metadata (kind 0) for a given pubkey.',
  inputSchema: {
    type: 'object',
    required: ['pubkey'],
    properties: {
      pubkey: {
        type: 'string',
        description: '64-char lowercase hex pubkey of the profile to fetch'
      }
    },
    additionalProperties: false
  },
  outputSchema: {
    type: 'object',
    properties: {
      pubkey: { type: 'string', description: 'Hex pubkey of the profile' },
      npub: { type: 'string', description: 'Bech32 npub of the profile' },
      username: { type: 'string', description: 'Display name / username if set' },
      avatar: { type: 'string', description: 'Profile picture URL if set' },
      about: { type: 'string', description: 'Profile bio if set' },
      nip05: { type: 'string', description: 'NIP-05 identifier if set' },
      banner: { type: 'string', description: 'Banner image URL if set' },
      website: { type: 'string', description: 'Website URL if set' },
      lud16: { type: 'string', description: 'Lightning address (LUD-16) if set' }
    }
  }
}

// Read-only: resolves an arbitrary pubkey's kind-0 metadata. No account linkage
// risk here — a profile is public Nostr data, so (unlike get_account) there is
// no opsec filter. An empty profile (no kind-0 found) is a valid result, not an
// error.
export const getProfileHandler: ToolHandler = async (args, _ctx) => {
  const pubkey = typeof args.pubkey === 'string' ? args.pubkey : ''
  if (!HEX_PUBKEY.test(pubkey)) {
    return {
      ok: false,
      error: { code: -32602, message: 'pubkey must be a 64-char lowercase hex string' }
    }
  }

  let profile
  try {
    profile = await profileFetcher.fetchProfile(pubkey)
  } catch (err) {
    return {
      ok: false,
      error: { code: -32603, message: 'profile fetch failed', data: String(err) }
    }
  }

  if (!profile) {
    return {
      ok: true,
      structuredContent: {},
      content: [{ type: 'text', text: '(no profile)' }]
    }
  }

  const structuredContent: Record<string, unknown> = {}
  if (profile.pubkey !== undefined) structuredContent.pubkey = profile.pubkey
  if (profile.npub !== undefined) structuredContent.npub = profile.npub
  if (profile.username !== undefined) structuredContent.username = profile.username
  if (profile.avatar !== undefined) structuredContent.avatar = profile.avatar
  if (profile.about !== undefined) structuredContent.about = profile.about
  if (profile.nip05 !== undefined) structuredContent.nip05 = profile.nip05
  if (profile.banner !== undefined) structuredContent.banner = profile.banner
  if (profile.website !== undefined) structuredContent.website = profile.website
  if (profile.lud16 !== undefined) structuredContent.lud16 = profile.lud16

  return {
    ok: true,
    structuredContent,
    content: [{ type: 'text', text: profile.username || '(no profile)' }]
  }
}
