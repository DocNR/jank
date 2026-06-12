import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the nostr-tools NIP-46 layer so `login()` never touches the network.
// `fromBunker` returns a controllable fake inner signer; `parseBunkerInput`
// yields a valid pointer.
const POINTER_PK = '00'.repeat(32)

const inner = vi.hoisted(() => ({
  connect: vi.fn(() => Promise.resolve()),
  getPublicKey: vi.fn(() => Promise.resolve('11'.repeat(32))),
  sendRequest: vi.fn()
}))

vi.mock('nostr-tools/nip46', () => ({
  BunkerSigner: { fromBunker: vi.fn(() => inner) },
  parseBunkerInput: vi.fn(async () => ({ pubkey: POINTER_PK, relays: ['wss://r'], secret: 's' }))
}))

import { BunkerSigner } from '../bunker.signer'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const BUNKER = 'bunker://' + POINTER_PK + '?relay=wss://r&secret=s'
const CLIENT_SK = '0'.repeat(64)

describe('BunkerSigner.login — reconnection does not block on the v3 probe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inner.connect.mockResolvedValue(undefined)
    inner.getPublicKey.mockResolvedValue('11'.repeat(32))
  })

  it('resolves the reconnection login WITHOUT waiting for the describe round-trip', async () => {
    // describe never resolves on its own — simulates a slow/offline remote signer.
    let resolveDescribe!: (v: unknown) => void
    inner.sendRequest.mockImplementation((method: string) =>
      method === 'describe'
        ? new Promise((r) => {
            resolveDescribe = r
          })
        : Promise.resolve(null)
    )

    const signer = new BunkerSigner(CLIENT_SK)
    let resolved = false
    let value: string | null = null
    const p = signer.login(BUNKER, false).then((v) => {
      resolved = true
      value = v
    })

    await flush()

    // The switch must not be blocked on the describe probe.
    expect(resolved).toBe(true)
    expect(value).toBe(POINTER_PK)
    // Probe hasn't completed yet, so capability is still the safe default.
    expect(signer.supportsNip44v3()).toBe(false)

    // Background probe resolves later and warms v3 capability.
    resolveDescribe(JSON.stringify(['nip44v3_encrypt', 'nip44v3_decrypt']))
    await flush()
    expect(signer.supportsNip44v3()).toBe(true)

    await p
  })

  it('initial connection still awaits connect + the v3 probe before returning', async () => {
    inner.sendRequest.mockImplementation((method: string) =>
      method === 'describe'
        ? Promise.resolve(JSON.stringify(['nip44v3_encrypt', 'nip44v3_decrypt']))
        : Promise.resolve(null)
    )

    const signer = new BunkerSigner(CLIENT_SK)
    const pubkey = await signer.login(BUNKER, true)

    expect(inner.connect).toHaveBeenCalledTimes(1)
    expect(inner.getPublicKey).toHaveBeenCalledTimes(1)
    // Probe was awaited, so v3 is known by the time login resolves.
    expect(signer.supportsNip44v3()).toBe(true)
    expect(pubkey).toBe('11'.repeat(32))
  })
})
