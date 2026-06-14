import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// validateZapReceipt resolves the recipient's LNURL `nostrPubkey` via
// profileFetcher.fetchProfile + a fetch() to the LNURL endpoint, then asserts
// the receipt was signed by that pubkey (NIP-57 Appendix F). Mock the profile
// fetcher and stub fetch so the test drives the endpoint's advertised
// nostrPubkey, and mock bitcoin-connect's init() (called in the service
// constructor) so importing the singleton is clean in the node test env.
const mocks = vi.hoisted(() => ({
  fetchProfile: vi.fn()
}))

vi.mock('@/services/profile-fetcher.service', () => ({
  default: { fetchProfile: mocks.fetchProfile }
}))

vi.mock('@getalby/bitcoin-connect-react', () => ({
  init: vi.fn(),
  launchPaymentModal: vi.fn()
}))

import lightning from '../lightning.service'

// A real, parseable bolt11 (from the NIP-57 example zap receipt).
const BOLT11 =
  'lnbc10u1p3unwfusp5t9r3yymhpfqculx78u027lxspgxcr2n2987mx2j55nnfs95nxnzqpp5jmrh92pfld78spqs78v9euf2385t83uvpwk9ldrlvf6ch7tpascqhp5zvkrmemgth3tufcvflmzjzfvjt023nazlhljz2n9hattj4f8jq8qxqyjw5qcqpjrzjqtc4fc44feggv7065fqe5m4ytjarg3repr5j9el35xhmtfexc42yczarjuqqfzqqqqqqqqlgqqqqqqgq9q9qxpqysgq079nkq507a5tw7xgttmj4u990j7wfggtrasah5gd4ywfr2pjcn29383tphp4t48gquelz9z78p4cq7ml3nrrphw5w6eckhjwmhezhnqpy6gyf0'

const ISSUER_PK = 'aaaa000000000000000000000000000000000000000000000000000000000001'
const SENDER_PK = 'bbbb000000000000000000000000000000000000000000000000000000000002'

// Each test uses a distinct recipient pubkey because the service caches LNURL
// nostrPubkey lookups per recipient (DataLoader) across the singleton's life.
function receipt({
  recipient,
  issuer = ISSUER_PK,
  preimage
}: {
  recipient: string
  issuer?: string
  preimage?: string
}) {
  const tags: string[][] = [
    ['p', recipient],
    ['P', SENDER_PK],
    ['e', '3624762a1274dd9636e0c552b53086d70bc88c165bc4dc0f9e836a1eaf86c3b8'],
    ['bolt11', BOLT11]
  ]
  if (preimage) tags.push(['preimage', preimage])
  return {
    id: 'id',
    kind: 9735,
    pubkey: issuer,
    created_at: 1674164545,
    content: '',
    sig: '',
    tags
  }
}

function stubEndpoint(nostrPubkey?: string) {
  mocks.fetchProfile.mockResolvedValue({ lightningAddress: 'sats@example.com' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      json: async () => ({ allowsNostr: true, callback: 'https://example.com/cb', nostrPubkey })
    }))
  )
}

describe('lightning.validateZapReceipt', () => {
  beforeEach(() => {
    mocks.fetchProfile.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts a receipt signed by the endpoint nostrPubkey (NIP-57 Appendix F)', async () => {
    stubEndpoint(ISSUER_PK)
    const ok = await lightning.validateZapReceipt(
      receipt({ recipient: 'r1'.padEnd(64, '0'), issuer: ISSUER_PK }) as never
    )
    expect(ok).toBe(true)
  })

  it('rejects a forged receipt signed by a different pubkey', async () => {
    stubEndpoint(ISSUER_PK)
    const ok = await lightning.validateZapReceipt(
      receipt({ recipient: 'r2'.padEnd(64, '0'), issuer: SENDER_PK }) as never
    )
    expect(ok).toBe(false)
  })

  it('accepts leniently when the endpoint has no nostrPubkey to prove forgery', async () => {
    stubEndpoint(undefined)
    const ok = await lightning.validateZapReceipt(
      receipt({ recipient: 'r3'.padEnd(64, '0'), issuer: SENDER_PK }) as never
    )
    expect(ok).toBe(true)
  })

  it('rejects when the preimage does not match the bolt11 payment hash', async () => {
    stubEndpoint(ISSUER_PK)
    const ok = await lightning.validateZapReceipt(
      receipt({
        recipient: 'r4'.padEnd(64, '0'),
        issuer: ISSUER_PK,
        preimage: '00'.repeat(32)
      }) as never
    )
    expect(ok).toBe(false)
  })

  it('rejects a receipt with no bolt11 invoice', async () => {
    stubEndpoint(ISSUER_PK)
    const ok = await lightning.validateZapReceipt({
      id: 'id',
      kind: 9735,
      pubkey: ISSUER_PK,
      created_at: 1674164545,
      content: '',
      sig: '',
      tags: [['p', 'r5'.padEnd(64, '0')]]
    } as never)
    expect(ok).toBe(false)
  })
})
