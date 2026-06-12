import { nip19 } from 'nostr-tools'
import type { TToolDefinition, ToolHandler } from '../context-vm-server.service'
import storage from '../local-storage.service'
import type { TColumn } from '@/types/column'

export const listColumnsDef: TToolDefinition = {
  name: 'list_columns',
  description: "List columns in the paired account's active deck.",
  inputSchema: {
    type: 'object',
    properties: {
      includeConfig: {
        type: 'boolean',
        description: 'Include the full config object per column. Default false.',
        default: false
      }
    },
    additionalProperties: false
  },
  outputSchema: {
    type: 'object',
    required: ['activeDeckId', 'activeDeckName', 'columns'],
    properties: {
      activeDeckId: { type: 'string' },
      activeDeckName: { type: 'string' },
      columns: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'type', 'viewContextNpub'],
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'home',
                'notifications',
                'detail',
                'relay',
                'bookmarks',
                'hashtag',
                'profile',
                'search',
                'dvm-discover',
                'dvm-feed'
              ]
            },
            viewContextNpub: { type: 'string' },
            signingIdentityNpub: { type: ['string', 'null'] },
            label: { type: 'string' },
            config: { type: 'object' }
          }
        }
      }
    }
  }
}

function computeColumnLabel(col: TColumn): string {
  if (col.type === 'hashtag' && col.config?.hashtags?.length) {
    return '#' + col.config.hashtags[0]
  }
  if (col.type === 'relay' && col.config?.relayUrl) return col.config.relayUrl
  if (col.type === 'search' && col.config?.query) return col.config.query
  return col.type
}

export const listColumnsHandler: ToolHandler = async (args, ctx) => {
  const workspacesByAccount = storage.getWorkspacesByAccount()
  const workspace = workspacesByAccount[ctx.workspaceOwner]
  if (!workspace) {
    return { ok: false, error: { code: -32603, message: 'Workspace not found' } }
  }
  const activeDeck = workspace.decks.find((d) => d.id === workspace.activeDeckId)
  if (!activeDeck) {
    return { ok: false, error: { code: -32603, message: 'Active deck not found' } }
  }

  // OPSEC FILTER (default ON): drop columns viewing sibling paired accounts.
  // User can opt out via workspace.allowSiblingExposure.
  const allowSiblings = workspace.allowSiblingExposure === true
  const ourPairedAccountPubkeys = allowSiblings
    ? new Set<string>()
    : new Set(
        storage
          .getAccounts()
          .map((a: { pubkey: string }) => a.pubkey)
          .filter((pk: string) => pk !== ctx.workspaceOwner)
      )

  const includeConfig = args.includeConfig === true

  const columns = activeDeck.columns
    .filter((col) => !ourPairedAccountPubkeys.has(col.viewContext))
    .map((col) => ({
      id: col.id,
      type: col.type,
      viewContextNpub: nip19.npubEncode(col.viewContext),
      signingIdentityNpub: col.signingIdentity ? nip19.npubEncode(col.signingIdentity) : null,
      label: computeColumnLabel(col),
      ...(includeConfig ? { config: col.config } : {})
    }))

  return {
    ok: true,
    structuredContent: {
      activeDeckId: activeDeck.id,
      activeDeckName: activeDeck.name,
      columns
    }
  }
}
