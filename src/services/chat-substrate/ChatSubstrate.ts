/**
 * ChatSubstrate — the swap seam for Track B in-app agent chat.
 *
 * Track B lets an external agent (OpenClaw) drive jank over ContextVM (the
 * "tool" path). This interface is the CHAT half: a transport-neutral contract
 * for a 1:1 conversation between the workspace owner and one paired agent.
 *
 * v1 is backed by NIP-04 (kind:4 encrypted DMs) — see `nip04-impl.ts`. The
 * interface is intentionally minimal so a Clave / NIP-17 backend can swap in
 * later (`createChatSubstrate` in `index.ts` picks the active impl) without the
 * AgentDrawer components knowing which wire format is underneath.
 *
 * A substrate instance is bound to one workspace owner (the local paired
 * account whose signer encrypts/decrypts). `agentPubkey` (hex) identifies the
 * remote conversation party per call.
 */

/** One message in an agent conversation, decrypted to plaintext. */
export type ChatMessage = {
  /** Event id (hex) for outbound messages once signed, or the relay event id
   *  for inbound. Used as the React key and for dedupe. Optimistic outbound
   *  bubbles carry a temporary id until the signed event lands. */
  id: string
  /** Hex pubkey of the message author (owner for sent, agent for received). */
  fromPubkey: string
  /** Decrypted plaintext body. */
  text: string
  /** Unix seconds. */
  createdAt: number
  /** True while an optimistic outbound message is in flight (not yet confirmed
   *  published). Cleared/removed once the relay accepts it. */
  pending?: boolean
}

export interface ChatSubstrate {
  /** Encrypt + sign + publish a message from the owner to the agent. Resolves
   *  once the relay set accepts it; rejects on signer-missing or publish
   *  failure. */
  sendMessage(agentPubkey: string, text: string): Promise<void>

  /** Open a live subscription for inbound messages from the agent. Calls
   *  `onMessage` for each decrypted message. Returns an unsubscribe function.
   *  Undecryptable / malformed events are skipped, never surfaced. */
  subscribeMessages(agentPubkey: string, onMessage: (m: ChatMessage) => void): () => void

  /** Backfill conversation history (BOTH directions) in chronological order.
   *  Undecryptable / malformed events are skipped, never thrown. */
  fetchHistory(agentPubkey: string, opts?: { limit?: number }): Promise<ChatMessage[]>
}
