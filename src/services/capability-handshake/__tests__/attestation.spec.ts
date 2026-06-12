import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { signAttestation, verifyAttestation, ATTESTATION_NAMESPACE } from '../attestation'
import type { ISigner } from '@/types'

function makeSigner(sk: Uint8Array): ISigner {
  return {
    getPublicKey: async () => getPublicKey(sk),
    signEvent: async (e) => ({
      ...e,
      id: 'fake-id-' + Math.random(),
      pubkey: getPublicKey(sk),
      sig: 'fake-sig'
    })
  } as ISigner
}

describe('attestation namespace', () => {
  it('exports the canonical CEP-namespaced key', () => {
    expect(ATTESTATION_NAMESPACE).toBe('io.spectr/session-attestation')
  })
})

describe('signAttestation + verifyAttestation', () => {
  it('produces a verifiable attestation', async () => {
    const ownerSk = generateSecretKey()
    const ownerPubkey = getPublicKey(ownerSk)
    const sessionPubkey = getPublicKey(generateSecretKey())
    const signer = makeSigner(ownerSk)

    const attestation = await signAttestation({
      workspaceOwner: ownerPubkey,
      sessionPubkey,
      validUntil: Math.floor(Date.now() / 1000) + 86400,
      signer
    })

    expect(attestation.workspaceOwner).toBe(ownerPubkey)
    expect(attestation.sessionPubkey).toBe(sessionPubkey)
    expect(attestation.sig).toBeTruthy()
  })

  it('rejects an attestation whose validUntil has passed', async () => {
    const ownerSk = generateSecretKey()
    const ownerPubkey = getPublicKey(ownerSk)
    const signer = makeSigner(ownerSk)
    const expired = await signAttestation({
      workspaceOwner: ownerPubkey,
      sessionPubkey: getPublicKey(generateSecretKey()),
      validUntil: Math.floor(Date.now() / 1000) - 60,
      signer
    })
    expect(verifyAttestation(expired)).toBe(false)
  })
})
