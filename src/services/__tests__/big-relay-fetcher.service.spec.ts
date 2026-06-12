import { kinds } from 'nostr-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/client.service', () => ({
  default: {
    query: vi.fn().mockResolvedValue([])
  }
}))

vi.mock('@/services/indexed-db.service', () => ({
  default: {
    getManyReplaceableEvents: vi.fn(async (pubkeys: string[]) => pubkeys.map(() => undefined)),
    putReplaceableEvent: vi.fn(),
    putNullReplaceableEvent: vi.fn()
  }
}))

import clientService from '@/services/client.service'
import bigRelayFetcher from '../big-relay-fetcher.service'

const VALID_A = 'a'.repeat(64)
const VALID_B = 'b'.repeat(64)

const queryMock = clientService.query as ReturnType<typeof vi.fn>

afterEach(() => {
  queryMock.mockClear()
})

describe('BigRelayFetcherService.fetchManyReplaceable', () => {
  it('drops empty/invalid pubkeys from the authors REQ before querying relays', async () => {
    await bigRelayFetcher.fetchManyReplaceable([VALID_A, '', 'not-a-pubkey', VALID_B], kinds.RelayList)

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [, filter] = queryMock.mock.calls[0]
    expect(filter.authors).toEqual([VALID_A, VALID_B])
    expect(filter.authors).not.toContain('')
    expect(filter.authors).not.toContain('not-a-pubkey')
  })

  it('skips the REQ entirely when no valid pubkey remains', async () => {
    await bigRelayFetcher.fetchManyReplaceable(['', 'nope'], kinds.RelayList)

    expect(queryMock).not.toHaveBeenCalled()
  })
})
