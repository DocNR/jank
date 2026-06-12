import type { Event as NEvent, EventTemplate, Filter } from 'nostr-tools'
import type { ISigner } from '@/types'
import type { ChatMessage, ChatSubstrate } from './ChatSubstrate'

/**
 * NIP-04 backend for {@link ChatSubstrate}. Encodes/decodes kind:4 encrypted
 * DMs between the workspace owner and one agent.
 *
 * NIP-04 decryption is symmetric over the conversation key derived from the
 * owner's private key and the OTHER party's pubkey. For BOTH directions
 * (owner→agent and agent→owner) the "other party" from the owner's seat is the
 * agent, so every event — sent or received — is decrypted with the agent's
 * pubkey as the counterparty. `event.pubkey` tells us who authored it.
 *
 * Dependencies are injected (see {@link Nip04Deps}) so the wire format is
 * testable in isolation and the production wiring lives in `index.ts`.
 */
export type Nip04Deps = {
  /** Hex pubkey of the local workspace owner whose signer encrypts/decrypts. */
  ownerPubkey: string
  /** Resolve the owner's signer from the client registry. Returns undefined
   *  when no signer is registered (e.g. view-only). */
  getSigner: (pubkey: string) => ISigner | undefined
  /** Publish a signed event to a relay set. */
  publish: (urls: string[], event: NEvent) => Promise<void>
  /** One-shot query that resolves once the relay set EOSEs. */
  query: (urls: string[], filter: Filter | Filter[]) => Promise<NEvent[]>
  /** Open a live subscription; returns a handle to close it. */
  subscribe: (
    urls: string[],
    filter: Filter | Filter[],
    handlers: { onevent?: (evt: NEvent) => void }
  ) => { close: () => void }
  /** Resolve the relay set to publish/subscribe on (owner write relays + a
   *  sensible default fallback). */
  resolveRelays: () => Promise<string[]>
  /** Unix-seconds clock. Injected for deterministic tests. */
  now: () => number
}

const DM_KIND = 4

export function createNip04ChatSubstrate(deps: Nip04Deps): ChatSubstrate {
  const { ownerPubkey, getSigner, publish, query, subscribe, resolveRelays, now } = deps

  /** Decrypt one kind:4 event into a ChatMessage, or null if undecryptable. */
  async function toMessage(signer: ISigner, evt: NEvent): Promise<ChatMessage | null> {
    try {
      const text = await signer.nip04Decrypt(AGENT_OF(evt), evt.content)
      return {
        id: evt.id,
        fromPubkey: evt.pubkey,
        text,
        createdAt: evt.created_at
      }
    } catch {
      // Undecryptable / malformed — skip, never surface.
      return null
    }
  }

  /**
   * Counterparty pubkey to decrypt against from the owner's seat. The agent is
   * always the non-owner party: for inbound it's the author, for outbound it's
   * the `p`-tagged recipient.
   */
  function AGENT_OF(evt: NEvent): string {
    if (evt.pubkey !== ownerPubkey) return evt.pubkey
    const pTag = evt.tags.find((t) => t[0] === 'p')
    return pTag?.[1] ?? evt.pubkey
  }

  return {
    async sendMessage(agentPubkey: string, text: string): Promise<void> {
      const signer = getSigner(ownerPubkey)
      if (!signer) {
        throw new Error('No signer for workspace owner — cannot send agent chat message')
      }
      const content = await signer.nip04Encrypt(agentPubkey, text)
      const draft: EventTemplate = {
        kind: DM_KIND,
        content,
        created_at: now(),
        tags: [['p', agentPubkey]]
      }
      const signed = await signer.signEvent(draft)
      const relays = await resolveRelays()
      await publish(relays, signed)
    },

    subscribeMessages(agentPubkey: string, onMessage: (m: ChatMessage) => void): () => void {
      let handle: { close: () => void } | null = null
      let cancelled = false

      const inboundFilter: Filter = {
        kinds: [DM_KIND],
        authors: [agentPubkey],
        '#p': [ownerPubkey]
      }

      // Relay resolution is async; open the sub once it lands unless already
      // unsubscribed.
      void (async () => {
        const signer = getSigner(ownerPubkey)
        const relays = await resolveRelays()
        if (cancelled || !signer) return
        handle = subscribe(relays, inboundFilter, {
          onevent: (evt) => {
            void toMessage(signer, evt).then((m) => {
              if (m) onMessage(m)
            })
          }
        })
      })()

      return () => {
        cancelled = true
        handle?.close()
      }
    },

    async fetchHistory(
      agentPubkey: string,
      opts?: { limit?: number }
    ): Promise<ChatMessage[]> {
      const signer = getSigner(ownerPubkey)
      if (!signer) return []

      const limit = opts?.limit
      const base = { kinds: [DM_KIND] as number[] }
      const outbound: Filter = {
        ...base,
        authors: [ownerPubkey],
        '#p': [agentPubkey],
        ...(limit ? { limit } : {})
      }
      const inbound: Filter = {
        ...base,
        authors: [agentPubkey],
        '#p': [ownerPubkey],
        ...(limit ? { limit } : {})
      }

      const relays = await resolveRelays()
      const events = await query(relays, [outbound, inbound])

      const byId = new Map<string, NEvent>()
      for (const evt of events) {
        if (!byId.has(evt.id)) byId.set(evt.id, evt)
      }

      const messages: ChatMessage[] = []
      for (const evt of byId.values()) {
        const m = await toMessage(signer, evt)
        if (m) messages.push(m)
      }
      messages.sort((a, b) => a.createdAt - b.createdAt)
      return messages
    }
  }
}
