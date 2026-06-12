import { type Event as NEvent, finalizeEvent, generateSecretKey, getEventHash, verifyEvent } from 'nostr-tools'
import { v2 as nip44 } from 'nostr-tools/nip44'

const TWO_DAYS = 2 * 24 * 60 * 60

/** Unsigned event with a computed id (NIP-59 rumor). */
export type Rumor = Omit<NEvent, 'sig'>

/** Minimal signer surface the engine needs — satisfied by ISigner. */
export type Nip17Signer = {
  getPublicKey: () => Promise<string>
  signEvent: (draft: {
    content: string
    created_at: number
    kind: number
    tags: string[][]
  }) => Promise<NEvent>
  nip44Encrypt: (pubkey: string, plainText: string) => Promise<string>
  nip44Decrypt: (pubkey: string, cipherText: string) => Promise<string>
}

/** Random created_at up to 2 days before `now` (NIP-17 metadata defence). */
export function randomTimeUpTo2DaysInPast(now: number): number {
  return Math.floor(now - Math.random() * TWO_DAYS)
}

export function buildRumor(params: {
  senderPubkey: string
  recipientPubkey: string
  content: string
  createdAt: number
  replyToId?: string
}): Rumor {
  const tags: string[][] = [['p', params.recipientPubkey]]
  if (params.replyToId) tags.push(['e', params.replyToId])
  const rumor = {
    pubkey: params.senderPubkey,
    created_at: params.createdAt,
    kind: 14,
    tags,
    content: params.content
  } as Rumor
  rumor.id = getEventHash(rumor as NEvent)
  return rumor
}

export async function sealRumor(
  rumor: Rumor,
  recipientPubkey: string,
  signer: Nip17Signer,
  now: number
): Promise<NEvent> {
  const content = await signer.nip44Encrypt(recipientPubkey, JSON.stringify(rumor))
  return signer.signEvent({
    kind: 13,
    content,
    created_at: randomTimeUpTo2DaysInPast(now),
    tags: []
  })
}

export function wrapSeal(seal: NEvent, recipientPubkey: string, now: number): NEvent {
  const sk = generateSecretKey()
  const convKey = nip44.utils.getConversationKey(sk, recipientPubkey)
  const content = nip44.encrypt(JSON.stringify(seal), convKey)
  return finalizeEvent(
    {
      kind: 1059,
      content,
      created_at: randomTimeUpTo2DaysInPast(now),
      tags: [['p', recipientPubkey]]
    },
    sk
  )
}

export type UnwrapResult = {
  rumor: Rumor
  /** The other party in the 1-on-1: sender if inbound, recipient if our own copy. */
  counterparty: string
  direction: 'in' | 'out'
}

export async function createGiftWraps(params: {
  senderPubkey: string
  recipientPubkey: string
  content: string
  signer: Nip17Signer
  now: number
  replyToId?: string
}): Promise<{ rumor: Rumor; counterpartyWrap: NEvent; selfWrap: NEvent }> {
  const rumor = buildRumor({
    senderPubkey: params.senderPubkey,
    recipientPubkey: params.recipientPubkey,
    content: params.content,
    createdAt: params.now,
    replyToId: params.replyToId
  })
  const sealToCounterparty = await sealRumor(rumor, params.recipientPubkey, params.signer, params.now)
  const sealToSelf = await sealRumor(rumor, params.senderPubkey, params.signer, params.now)
  return {
    rumor,
    counterpartyWrap: wrapSeal(sealToCounterparty, params.recipientPubkey, params.now),
    selfWrap: wrapSeal(sealToSelf, params.senderPubkey, params.now)
  }
}

export async function unwrapGiftWrap(
  wrap: NEvent,
  myPubkey: string,
  signer: Nip17Signer
): Promise<UnwrapResult | null> {
  try {
    const sealJson = await signer.nip44Decrypt(wrap.pubkey, wrap.content)
    const seal = JSON.parse(sealJson) as NEvent
    if (seal.kind !== 13) return null
    if (!verifyEvent(seal)) return null

    const rumorJson = await signer.nip44Decrypt(seal.pubkey, seal.content)
    const rumor = JSON.parse(rumorJson) as Rumor
    if (rumor.kind !== 14) return null
    // Anti-impersonation: the seal signer MUST be the rumor author.
    if (seal.pubkey !== rumor.pubkey) return null

    const pTags = rumor.tags.filter((t) => t[0] === 'p').map((t) => t[1])
    const isMine = rumor.pubkey === myPubkey
    if (!isMine && !pTags.includes(myPubkey)) return null

    const counterparty = isMine ? (pTags.find((p) => p !== myPubkey) ?? myPubkey) : rumor.pubkey
    return { rumor, counterparty, direction: isMine ? 'out' : 'in' }
  } catch {
    return null
  }
}
