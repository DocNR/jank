import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bytesToBase64 } from 'ts-mls'

// Mock IDB so the cursor persistence layer doesn't touch IndexedDB. Mirrors
// groups.spec.ts + messages.spec.ts. We keep an in-memory Map keyed by groupId
// so getCursor can serve back what was put — the watcher's fetch-then-subscribe
// loop relies on this.
vi.mock('@/services/indexed-db.service', () => {
  return {
    default: {
      getCursor: vi.fn(),
      putCursor: vi.fn()
    }
  }
})

// Mock the contextVmClient so callTool returns canned coordinator responses.
vi.mock('@/services/context-vm-client.service', () => ({
  default: {
    callTool: vi.fn()
  }
}))

import indexedDb, { type CursorRecord } from '@/services/indexed-db.service'
import contextVmClient from '@/services/context-vm-client.service'
import { watchGroup, type WatchedMessage } from '../watch'

const COORD = 'coord-pubkey-aabbcc'
const SIGNER = 'signer-pubkey-ddeeff'
const GID = 'group-id-1'

let cursorStore: Map<string, CursorRecord>

beforeEach(() => {
  vi.mocked(indexedDb.getCursor).mockReset()
  vi.mocked(indexedDb.putCursor).mockReset()
  vi.mocked(contextVmClient.callTool).mockReset()

  cursorStore = new Map<string, CursorRecord>()
  vi.mocked(indexedDb.putCursor).mockImplementation(async (record: CursorRecord) => {
    cursorStore.set(record.groupId, { ...record, updatedAt: Date.now() })
  })
  vi.mocked(indexedDb.getCursor).mockImplementation(async (groupId: string) => {
    return cursorStore.get(groupId)?.cursor ?? null
  })

  // silence the watcher's console.warn for transient errors during tests
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)

  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// Helper: a single coordinator FetchGroupMessages response.
function fetchResponse(
  messages: Array<{ msg_64: string; cursor: number; at: number }>
) {
  return {
    ok: true as const,
    structuredContent: { messages }
  }
}

describe('cordn watchGroup', () => {
  it('cold start: backlog delivers each message via callback and persists the cursor', async () => {
    // No prior cursor.
    vi.mocked(indexedDb.getCursor).mockResolvedValueOnce(null)
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce(
      fetchResponse([
        { msg_64: 'aGVsbG8x', cursor: 10, at: 1700000010 },
        { msg_64: 'aGVsbG8y', cursor: 11, at: 1700000011 }
      ])
    )

    const onMessage = vi.fn<(msg: WatchedMessage) => void>()
    const handle = watchGroup({
      coordPubkey: COORD,
      signerPubkey: SIGNER,
      groupId: GID,
      onMessage,
      pollIntervalMs: 50
    })

    await handle.ready

    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(onMessage).toHaveBeenNthCalledWith(1, {
      msg64: 'aGVsbG8x',
      cursor: 10,
      at: 1700000010
    })
    expect(onMessage).toHaveBeenNthCalledWith(2, {
      msg64: 'aGVsbG8y',
      cursor: 11,
      at: 1700000011
    })

    // Cursor persisted per delivered message — last persisted should reflect
    // the highest cursor seen (string-encoded because CursorRecord.cursor is
    // a string).
    expect(indexedDb.putCursor).toHaveBeenCalledTimes(2)
    const lastPut = vi.mocked(indexedDb.putCursor).mock.calls.at(-1)![0]
    expect(lastPut.groupId).toBe(GID)
    expect(lastPut.cursor).toBe('11')

    // The first fetch had no `after` (cold start with no persisted cursor).
    const firstCall = vi.mocked(contextVmClient.callTool).mock.calls[0]
    expect(firstCall[0]).toBe(COORD)
    expect(firstCall[1]).toBe('FetchGroupMessages')
    expect(firstCall[2]).toEqual({ gid: GID })

    handle.close()
  })

  it('resumes from persisted cursor: passes `after` to first fetch', async () => {
    vi.mocked(indexedDb.getCursor).mockResolvedValueOnce('100')
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce(
      fetchResponse([{ msg_64: 'bmV4dA==', cursor: 200, at: 1700000200 }])
    )

    const onMessage = vi.fn<(msg: WatchedMessage) => void>()
    const handle = watchGroup({
      coordPubkey: COORD,
      signerPubkey: SIGNER,
      groupId: GID,
      onMessage,
      pollIntervalMs: 50
    })

    await handle.ready

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith({
      msg64: 'bmV4dA==',
      cursor: 200,
      at: 1700000200
    })

    // First call must include after=100 (parsed from the persisted string).
    const firstCall = vi.mocked(contextVmClient.callTool).mock.calls[0]
    expect(firstCall[2]).toEqual({ gid: GID, after: 100 })

    handle.close()
  })

  it('subscribe phase: delivers new messages on each poll tick', async () => {
    vi.mocked(indexedDb.getCursor).mockResolvedValueOnce(null)
    // Backlog: empty.
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce(
      fetchResponse([])
    )
    // First poll after pollIntervalMs: delivers one new message.
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce(
      fetchResponse([{ msg_64: 'cG9sbDE=', cursor: 1, at: 1700001000 }])
    )

    const onMessage = vi.fn<(msg: WatchedMessage) => void>()
    const handle = watchGroup({
      coordPubkey: COORD,
      signerPubkey: SIGNER,
      groupId: GID,
      onMessage,
      pollIntervalMs: 50
    })

    await handle.ready
    expect(onMessage).not.toHaveBeenCalled()

    // Advance to the first poll cycle. Use runAllTimersAsync-style helper to
    // flush both the timer + awaited callTool/onMessage chain.
    await vi.advanceTimersByTimeAsync(60)

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith({
      msg64: 'cG9sbDE=',
      cursor: 1,
      at: 1700001000
    })

    // Cursor advanced (string-encoded).
    const lastPut = vi.mocked(indexedDb.putCursor).mock.calls.at(-1)![0]
    expect(lastPut.cursor).toBe('1')

    handle.close()
  })

  it('self-echo dedup: registered ciphertext is skipped but cursor still advances', async () => {
    vi.mocked(indexedDb.getCursor).mockResolvedValueOnce(null)
    // Buffer that the local encryptOutbound would have returned. The watcher's
    // base64 of these bytes must match `msg_64` in the inbound coordinator
    // payload, since the coordinator round-trips our own ciphertext verbatim.
    const ciphertext = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50])
    const echoB64 = bytesToBase64(ciphertext)

    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce(
      fetchResponse([
        { msg_64: echoB64, cursor: 5, at: 1700000500 },
        { msg_64: 'b3RoZXI=', cursor: 6, at: 1700000600 }
      ])
    )

    const onMessage = vi.fn<(msg: WatchedMessage) => void>()
    const handle = watchGroup({
      coordPubkey: COORD,
      signerPubkey: SIGNER,
      groupId: GID,
      onMessage,
      pollIntervalMs: 50
    })

    // Register BEFORE the backlog completes — that's the realistic ordering
    // (caller registers immediately after encryptOutbound + before the next
    // poll cycle), and the ready promise blocks until backlog completes.
    handle.registerSelfEcho(ciphertext)

    await handle.ready

    // Self-echo skipped, but `b3RoZXI=` (other) was delivered.
    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith({
      msg64: 'b3RoZXI=',
      cursor: 6,
      at: 1700000600
    })

    // Cursor advanced for BOTH messages (echo + other) — we must not regress
    // when re-fetching after a restart, else we'd re-see the echo and would
    // need to track it persistently.
    const cursors = vi
      .mocked(indexedDb.putCursor)
      .mock.calls.map(([record]) => record.cursor)
    expect(cursors).toContain('5')
    expect(cursors).toContain('6')

    handle.close()
  })

  it('close stops the poll loop (no further callTool invocations)', async () => {
    vi.mocked(indexedDb.getCursor).mockResolvedValueOnce(null)
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce(fetchResponse([]))

    const onMessage = vi.fn<(msg: WatchedMessage) => void>()
    const handle = watchGroup({
      coordPubkey: COORD,
      signerPubkey: SIGNER,
      groupId: GID,
      onMessage,
      pollIntervalMs: 50
    })

    await handle.ready
    expect(contextVmClient.callTool).toHaveBeenCalledTimes(1)

    handle.close()
    // Idempotency: a second close must not throw.
    expect(() => handle.close()).not.toThrow()

    // Advance well past several poll intervals.
    await vi.advanceTimersByTimeAsync(500)

    expect(contextVmClient.callTool).toHaveBeenCalledTimes(1)
    expect(onMessage).not.toHaveBeenCalled()
  })

  it('transient poll error does not kill the watcher; next cycle recovers', async () => {
    vi.mocked(indexedDb.getCursor).mockResolvedValueOnce(null)
    // Backlog OK (empty).
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce(fetchResponse([]))
    // First poll: transient failure.
    vi.mocked(contextVmClient.callTool).mockRejectedValueOnce(
      new Error('transient network blip')
    )
    // Second poll: delivers a new message.
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce(
      fetchResponse([{ msg_64: 'cmVjb3Zlcg==', cursor: 7, at: 1700000700 }])
    )

    const onMessage = vi.fn<(msg: WatchedMessage) => void>()
    const handle = watchGroup({
      coordPubkey: COORD,
      signerPubkey: SIGNER,
      groupId: GID,
      onMessage,
      pollIntervalMs: 50
    })

    await handle.ready

    // First poll (errors) → second poll (succeeds).
    await vi.advanceTimersByTimeAsync(60)
    await vi.advanceTimersByTimeAsync(60)

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith({
      msg64: 'cmVjb3Zlcg==',
      cursor: 7,
      at: 1700000700
    })

    handle.close()
  })

  it('backlog error rejects the ready promise', async () => {
    vi.mocked(indexedDb.getCursor).mockResolvedValueOnce(null)
    vi.mocked(contextVmClient.callTool).mockRejectedValueOnce(
      new Error('coordinator unreachable')
    )

    const onMessage = vi.fn<(msg: WatchedMessage) => void>()
    const handle = watchGroup({
      coordPubkey: COORD,
      signerPubkey: SIGNER,
      groupId: GID,
      onMessage,
      pollIntervalMs: 50
    })

    await expect(handle.ready).rejects.toThrow(/coordinator unreachable/)

    handle.close()
  })
})
