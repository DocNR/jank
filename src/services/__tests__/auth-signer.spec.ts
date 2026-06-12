import { describe, expect, it, vi } from 'vitest'
import type { ISigner } from '@/types'
import { selectAuthSigner } from '@/services/auth-signer'

const makeSigner = (id: string): ISigner =>
  ({
    getPublicKey: vi.fn(async () => id),
    signEvent: vi.fn(),
    nip04Encrypt: vi.fn(),
    nip04Decrypt: vi.fn(),
    nip44Encrypt: vi.fn(),
    nip44Decrypt: vi.fn()
  }) as unknown as ISigner

describe('selectAuthSigner', () => {
  it('returns the registry-resolved signer when pubkey is provided and registered', () => {
    const acct = makeSigner('acct')
    const active = makeSigner('active')
    const registry = vi.fn((pk: string) => (pk === 'acct-pk' ? acct : undefined))
    expect(selectAuthSigner(registry, active, 'acct-pk')).toBe(acct)
    expect(registry).toHaveBeenCalledWith('acct-pk')
  })

  it('falls back to the active signer when pubkey is provided but not registered', () => {
    const active = makeSigner('active')
    const registry = vi.fn(() => undefined)
    expect(selectAuthSigner(registry, active, 'unknown-pk')).toBe(active)
  })

  it('returns the active signer when no pubkey is provided (and does not query the registry)', () => {
    const active = makeSigner('active')
    const registry = vi.fn(() => undefined)
    expect(selectAuthSigner(registry, active, undefined)).toBe(active)
    expect(registry).not.toHaveBeenCalled()
  })

  it('returns undefined when neither registry nor active have a signer', () => {
    const registry = vi.fn(() => undefined)
    expect(selectAuthSigner(registry, undefined, 'pk')).toBeUndefined()
    expect(selectAuthSigner(registry, undefined, undefined)).toBeUndefined()
  })

  it('treats an empty-string pubkey as "no pubkey" (does not query the registry)', () => {
    const active = makeSigner('active')
    const registry = vi.fn(() => undefined)
    expect(selectAuthSigner(registry, active, '')).toBe(active)
    expect(registry).not.toHaveBeenCalled()
  })
})
