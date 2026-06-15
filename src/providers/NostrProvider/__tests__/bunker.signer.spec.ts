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
    // Reconnection must not re-issue the connect handshake — metadata is only
    // sent on the initial pairing; reconnects are unchanged.
    expect(inner.sendRequest).not.toHaveBeenCalledWith('connect', expect.anything())
    // Probe hasn't completed yet, so capability is still the safe default.
    expect(signer.supportsNip44v3()).toBe(false)

    // Background probe resolves later and warms v3 capability.
    resolveDescribe(JSON.stringify(['nip44v3_encrypt', 'nip44v3_decrypt']))
    await flush()
    expect(signer.supportsNip44v3()).toBe(true)

    await p
  })

  it('initial connection sends connect + awaits the v3 probe before returning', async () => {
    inner.sendRequest.mockImplementation((method: string) =>
      method === 'describe'
        ? Promise.resolve(JSON.stringify(['nip44v3_encrypt', 'nip44v3_decrypt']))
        : Promise.resolve(null)
    )

    const signer = new BunkerSigner(CLIENT_SK)
    const pubkey = await signer.login(BUNKER, true)

    // connect is issued via sendRequest (not nostr-tools' connect() helper) so
    // the metadata 4th param can be appended — the helper exposes no metadata arg.
    expect(inner.sendRequest).toHaveBeenCalledWith('connect', expect.any(Array))
    expect(inner.connect).not.toHaveBeenCalled()
    expect(inner.getPublicKey).toHaveBeenCalledTimes(1)
    // Probe was awaited, so v3 is known by the time login resolves.
    expect(signer.supportsNip44v3()).toBe(true)
    expect(pubkey).toBe('11'.repeat(32))
  })

  it('appends jank client metadata as a JSON-string 4th param on the connect request', async () => {
    inner.sendRequest.mockResolvedValue(null)

    const signer = new BunkerSigner(CLIENT_SK)
    await signer.login(BUNKER, true)

    const connectCall = inner.sendRequest.mock.calls.find(
      (call: unknown[]) => call[0] === 'connect'
    )
    expect(connectCall).toBeDefined()
    const params = connectCall![1] as unknown[]

    // [signer_pubkey, secret] come from the parsed bunker pointer.
    expect(params[0]).toBe(POINTER_PK)
    expect(params[1]).toBe('s')
    // The permissions slot is kept (empty) so metadata still lands in slot 3.
    expect(params[2]).toBe('')
    expect(params).toHaveLength(4)
    // CRITICAL: every element is a string. Signers decode `params` as string[]
    // and discard the whole array if any element is a nested object.
    expect(params.every((p) => typeof p === 'string')).toBe(true)

    // params[3] is a JSON *string*, not a nested object.
    const meta = JSON.parse(params[3] as string)
    // Keys are exactly name/url/image (use `image`, not imageURL/picture).
    expect(Object.keys(meta).sort()).toEqual(['image', 'name', 'url'])
    expect(meta.name).toBe('Jank')
    expect(meta.url).toBe('https://jank.army')
    expect(meta.image).toBe('https://jank.army/apple-touch-icon.png')
  })
})
