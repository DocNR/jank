/** One decrypted DM, ready to persist and render. */
export type DmMessage = {
  wrapId: string
  counterparty: string
  fromPubkey: string
  content: string
  createdAt: number
  rumorId: string
}

export type Conversation = {
  counterparty: string
  lastMessage: DmMessage
  lastMessageAt: number
  messageCount: number
  unread: number
}

/**
 * Group flat messages into per-counterparty conversations, newest first.
 * `lastReadAt` maps counterparty -> last-read unix seconds; `myPubkey` lets us
 * count only inbound messages as unread.
 */
export function groupConversations(
  messages: DmMessage[],
  lastReadAt: Record<string, number> = {},
  myPubkey?: string
): Conversation[] {
  const byParty = new Map<string, DmMessage[]>()
  for (const m of messages) {
    const arr = byParty.get(m.counterparty)
    if (arr) arr.push(m)
    else byParty.set(m.counterparty, [m])
  }
  const convos: Conversation[] = []
  for (const [counterparty, arr] of byParty) {
    arr.sort((a, b) => a.createdAt - b.createdAt)
    const lastMessage = arr[arr.length - 1]
    const readAt = lastReadAt[counterparty] ?? 0
    const unread = arr.filter(
      (m) => m.createdAt > readAt && (!myPubkey || m.fromPubkey !== myPubkey)
    ).length
    convos.push({
      counterparty,
      lastMessage,
      lastMessageAt: lastMessage.createdAt,
      messageCount: arr.length,
      unread
    })
  }
  convos.sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  return convos
}
