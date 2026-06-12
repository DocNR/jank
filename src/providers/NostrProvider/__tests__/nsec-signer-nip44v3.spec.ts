import { describe, expect, it } from 'vitest'
import { bytesToHex } from '@noble/hashes/utils.js'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { NsecSigner } from '../nsec.signer'

describe('NsecSigner — NIP-44 v3 surface', () => {
  it('advertises v3 support', () => {
    const sk = generateSecretKey()
    const s = new NsecSigner()
    s.login(sk)
    expect(s.supportsNip44v3?.()).toBe(true)
  })

  it('round-trips a UTF-8 plaintext through nip44v3Encrypt + nip44v3Decrypt', async () => {
    const skA = generateSecretKey()
    const skB = generateSecretKey()
    const pkB = getPublicKey(skB)
    const sA = new NsecSigner(); sA.login(skA)
    const sB = new NsecSigner(); sB.login(skB)

    const plaintext = 'spectr deck data 🦋 日本語'
    const wire = await sA.nip44v3Encrypt!(pkB, plaintext, 30078, 'spectr_decks')
    // Wire is base64; first decoded byte should be 0x03
    const firstByte = Buffer.from(wire, 'base64')[0]
    expect(firstByte).toBe(0x03)

    const decoded = await sB.nip44v3Decrypt!(getPublicKey(skA), wire, 30078, 'spectr_decks')
    expect(decoded).toBe(plaintext)
  })

  it('rejects decrypt with wrong scope (context mismatch surfaces as decryption failed)', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const s = new NsecSigner(); s.login(sk)
    const wire = await s.nip44v3Encrypt!(pk, 'secret', 30078, 'spectr_decks')
    await expect(s.nip44v3Decrypt!(pk, wire, 30078, 'wrong_scope')).rejects.toThrow()
  })

  it('rejects decrypt with wrong kind', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const s = new NsecSigner(); s.login(sk)
    const wire = await s.nip44v3Encrypt!(pk, 'secret', 30078, 'spectr_decks')
    await expect(s.nip44v3Decrypt!(pk, wire, 30079, 'spectr_decks')).rejects.toThrow()
  })

  it('throws on v3 methods when not logged in', async () => {
    const s = new NsecSigner()
    await expect(s.nip44v3Encrypt!('x', 'x', 1, '')).rejects.toThrow()
    await expect(s.nip44v3Decrypt!('x', 'x', 1, '')).rejects.toThrow()
  })

  it('self-encryption (workspace owner encrypts to self) round-trips', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const s = new NsecSigner(); s.login(sk)
    const wire = await s.nip44v3Encrypt!(pk, '{"deck":"home"}', 30078, 'spectr_decks')
    const back = await s.nip44v3Decrypt!(pk, wire, 30078, 'spectr_decks')
    expect(back).toBe('{"deck":"home"}')
    // Sanity: pubkey is the schnorr x-only of the seckey
    expect(pk.length).toBe(64) // hex
    expect(bytesToHex(Buffer.from(pk, 'hex'))).toBe(pk)
  })
})
