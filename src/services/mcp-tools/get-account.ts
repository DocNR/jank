import { nip19 } from 'nostr-tools'
import type { TToolDefinition, ToolHandler } from '../context-vm-server.service'
import profileFetcher from '../profile-fetcher.service'
import storage from '../local-storage.service'

export const getAccountDef: TToolDefinition = {
  name: 'get_account',
  description: 'Get profile info for the paired jank account.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },
  outputSchema: {
    type: 'object',
    required: ['account'],
    properties: {
      account: {
        type: 'object',
        required: ['npub'],
        properties: {
          npub: { type: 'string', description: 'Bech32 npub of the paired account' },
          name: { type: 'string', description: 'Profile display name if known' },
          picture: { type: 'string', description: 'Profile picture URL if known' },
          signerType: {
            type: 'string',
            enum: ['nsec', 'browser-nsec', 'nip-07', 'bunker', 'ncryptsec', 'npub'],
            description: "For agent awareness; npub-only means this account can't sign"
          }
        }
      }
    }
  }
}

// Strict opsec: only the workspace-owner account is exposed (never an array
// of all paired accounts — that would link them).
export const getAccountHandler: ToolHandler = async (_args, ctx) => {
  const npub = nip19.npubEncode(ctx.workspaceOwner)
  const [profile, accounts] = await Promise.all([
    profileFetcher.fetchProfile(ctx.workspaceOwner).catch(() => null),
    Promise.resolve(storage.getAccounts())
  ])
  const account = accounts.find((a) => a.pubkey === ctx.workspaceOwner)
  return {
    ok: true,
    structuredContent: {
      account: {
        npub,
        name: profile?.username ?? undefined,
        picture: profile?.avatar ?? undefined,
        signerType: account?.signerType ?? 'npub'
      }
    }
  }
}
