/** A chat message ready to render — used by both the agent drawer and DMs. */
export type ChatMessage = {
  /** Event id (hex) for outbound messages once signed, or the relay event id
   *  for inbound. Used as the React key and for dedupe. Optimistic outbound
   *  bubbles carry a temporary id until the signed event lands. */
  id: string
  /** Hex pubkey of the message author. */
  fromPubkey: string
  /** Decrypted plaintext body. */
  text: string
  /** Unix seconds. */
  createdAt: number
  /** True while an optimistic outbound message is in flight (not yet confirmed
   *  published). Cleared/removed once the relay accepts it. */
  pending?: boolean
}
