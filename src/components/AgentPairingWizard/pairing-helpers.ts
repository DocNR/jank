import type { TPairedAgent } from '@/types/column'
import { nip19 } from 'nostr-tools'

/**
 * Validate a free-text npub string. Returns true only for a well-formed
 * bech32 `npub1…` that decodes to a hex pubkey. Empty / non-npub input is
 * false. Used by both the wizard form (inline error) and the save helper.
 */
export function isValidNpub(value: string): boolean {
  if (!value.startsWith('npub1')) return false
  try {
    const decoded = nip19.decode(value)
    return decoded.type === 'npub' && typeof decoded.data === 'string'
  } catch {
    return false
  }
}

export type BuildPairedAgentInput = {
  /** Agent's MCP/tool-auth npub (required, already validated by Step 1). */
  agentNpub: string
  /** Optional user-given display name. */
  displayName?: string
  /** Optional CHAT npub the user DMs to chat with this agent. DISTINCT from
   *  `agentNpub` (the tool-auth key). Blank string = no chat surface. */
  agentChatNpub?: string
}

export type BuildPairedAgentResult =
  | { ok: true; agent: TPairedAgent }
  | { ok: false; error: 'invalid-agent-npub' | 'invalid-chat-npub' }

/**
 * Pure builder for the persisted {@link TPairedAgent}. Centralizes the save
 * validation so it can be unit-tested without rendering the wizard.
 *
 * Chat npub rules (Track B in-app chat drawer):
 * - non-empty + valid  → stored on `agentChatNpub` (unlocks the chat button)
 * - non-empty + invalid → rejected with `invalid-chat-npub`, nothing saved
 * - blank/whitespace    → `agentChatNpub` left UNSET (strictly opt-in; we never
 *                         auto-default it to the tool-auth key)
 */
export function buildPairedAgent(input: BuildPairedAgentInput): BuildPairedAgentResult {
  const agentNpub = input.agentNpub.trim()
  if (!isValidNpub(agentNpub)) {
    return { ok: false, error: 'invalid-agent-npub' }
  }
  const pubkey = nip19.decode(agentNpub).data as string

  const chatNpubRaw = (input.agentChatNpub ?? '').trim()
  let agentChatNpub: string | undefined
  if (chatNpubRaw) {
    if (!isValidNpub(chatNpubRaw)) {
      return { ok: false, error: 'invalid-chat-npub' }
    }
    agentChatNpub = chatNpubRaw
  }

  const name = input.displayName?.trim() || undefined

  const agent: TPairedAgent = {
    pubkey,
    npub: agentNpub,
    name,
    scope: 'read-only',
    pairedAt: Math.floor(Date.now() / 1000),
    ...(agentChatNpub ? { agentChatNpub } : {})
  }

  return { ok: true, agent }
}
