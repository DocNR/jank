import { getEventHash } from 'nostr-tools/pure'

/** Cordn application-message envelope per spec/02.
 *  NIP-01 shape with NO `sig` (authorship via MLS sender identity). */
export interface CordnEnvelope {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}

export function encodeEnvelope(input: {
  pubkey: string
  kind: number
  tags: string[][]
  content: string
  created_at: number
}): CordnEnvelope {
  const id = getEventHash({
    pubkey: input.pubkey,
    created_at: input.created_at,
    kind: input.kind,
    tags: input.tags,
    content: input.content
  })
  return { ...input, id }
}

export function recomputeEnvelopeId(env: CordnEnvelope): string {
  return getEventHash({
    pubkey: env.pubkey,
    created_at: env.created_at,
    kind: env.kind,
    tags: env.tags,
    content: env.content
  })
}

/** Strict decode: throws if id mismatches OR pubkey doesn't match the MLS-authenticated sender. */
export function decodeEnvelope(json: string, mlsSenderPubkey: string): CordnEnvelope {
  const parsed = JSON.parse(json) as Partial<CordnEnvelope> & { sig?: unknown }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('envelope: not an object')
  }
  if ('sig' in parsed) {
    throw new Error('envelope: must NOT contain sig field (spec/02 §2)')
  }
  if (parsed.pubkey !== mlsSenderPubkey) {
    throw new Error('envelope: pubkey does not match MLS sender identity')
  }
  const env = parsed as CordnEnvelope
  const expectedId = recomputeEnvelopeId(env)
  if (env.id !== expectedId) {
    throw new Error('envelope: id mismatch')
  }
  return env
}
