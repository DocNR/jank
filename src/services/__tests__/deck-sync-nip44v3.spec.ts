import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { NsecSigner } from '@/providers/NostrProvider/nsec.signer'
import {
  DECK_SYNC_KIND,
  DECK_SYNC_SCOPE,
  encryptWorkspaceContent,
  decryptWorkspaceContent,
  detectNip44Version,
} from '../deck-sync-crypto'

describe('deck-sync crypto constants', () => {
  it('uses kind 30078 (Application Data) and scope "spectr_decks"', () => {
    expect(DECK_SYNC_KIND).toBe(30078)
    expect(DECK_SYNC_SCOPE).toBe('spectr_decks')
  })
})

describe('detectNip44Version — sniff first byte of decoded wire', () => {
  it('returns 3 for v3 wire (0x03 prefix)', () => {
    const wire = Buffer.from(new Uint8Array([0x03, ...new Array(80).fill(0)])).toString('base64')
    expect(detectNip44Version(wire)).toBe(3)
  })

  it('returns 2 for v2 wire (0x02 prefix)', () => {
    const wire = Buffer.from(new Uint8Array([0x02, ...new Array(80).fill(0)])).toString('base64')
    expect(detectNip44Version(wire)).toBe(2)
  })

  it('returns null for empty input', () => {
    expect(detectNip44Version('')).toBe(null)
  })

  it('returns null for # prefix (future format)', () => {
    expect(detectNip44Version('#abcdef')).toBe(null)
  })

  it('returns null for invalid base64', () => {
    expect(detectNip44Version('!!!notbase64!!!')).toBe(null)
  })

  it('returns the version byte even for unknown future versions', () => {
    const wire = Buffer.from(new Uint8Array([0x05, ...new Array(80).fill(0)])).toString('base64')
    expect(detectNip44Version(wire)).toBe(5)
  })
})

describe('encryptWorkspaceContent — prefers v3 when signer supports it', () => {
  it('emits a v3 wire when supportsNip44v3 returns true', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const s = new NsecSigner(); s.login(sk)
    const wire = await encryptWorkspaceContent(s, pk, '{"deck":"home"}')
    expect(detectNip44Version(wire)).toBe(3)
  })

  it('emits a v2 wire when signer reports no v3 support', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const s = new NsecSigner(); s.login(sk)
    // Mock the signer to deny v3 support
    const v2Only: any = {
      ...s,
      supportsNip44v3: () => false,
      nip44Encrypt: s.nip44Encrypt.bind(s),
      nip44Decrypt: s.nip44Decrypt.bind(s),
      nip44v3Encrypt: undefined,
      nip44v3Decrypt: undefined,
    }
    const wire = await encryptWorkspaceContent(v2Only, pk, '{"deck":"home"}')
    expect(detectNip44Version(wire)).toBe(2)
  })
})

describe('decryptWorkspaceContent — dispatches by wire version', () => {
  it('decrypts a v3 wire back to the original plaintext', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const s = new NsecSigner(); s.login(sk)
    const wire = await encryptWorkspaceContent(s, pk, '{"deck":"home"}')
    const plain = await decryptWorkspaceContent(s, pk, wire)
    expect(plain).toBe('{"deck":"home"}')
  })

  it('decrypts a v2 wire even when signer also supports v3 (back-compat for existing remotes)', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const s = new NsecSigner(); s.login(sk)
    // Force v2-encrypted wire
    const v2Wire = await s.nip44Encrypt(pk, '{"legacy":true}')
    expect(detectNip44Version(v2Wire)).toBe(2)
    const plain = await decryptWorkspaceContent(s, pk, v2Wire)
    expect(plain).toBe('{"legacy":true}')
  })

  it('fails on an unknown wire version', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const s = new NsecSigner(); s.login(sk)
    const garbage = Buffer.from(new Uint8Array([0x05, 0, 0, 0])).toString('base64')
    await expect(decryptWorkspaceContent(s, pk, garbage)).rejects.toThrow()
  })
})
