import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'

// Mock IDB so tests don't touch IndexedDB. Track puts in a Map keyed by groupId
// so getMlsState can serve back what was put.
vi.mock('@/services/indexed-db.service', () => {
  return {
    default: {
      putMlsState: vi.fn(),
      getMlsState: vi.fn()
    }
  }
})

import indexedDb from '@/services/indexed-db.service'
import { generateOwnKeyPackage } from '../keyPackages'
import { createGroup, joinGroup, getGroupState } from '../groups'
import type { MlsStateRecord } from '@/services/indexed-db.service'

beforeEach(() => {
  vi.mocked(indexedDb.putMlsState).mockReset()
  vi.mocked(indexedDb.getMlsState).mockReset()

  // Default: serve back whatever was last put under the given groupId.
  const store = new Map<string, MlsStateRecord>()
  vi.mocked(indexedDb.putMlsState).mockImplementation(async (record: MlsStateRecord) => {
    // Mirror the real impl which sets updatedAt itself.
    store.set(record.groupId, { ...record, updatedAt: Date.now() })
  })
  vi.mocked(indexedDb.getMlsState).mockImplementation(async (groupId: string) => {
    return store.get(groupId) ?? null
  })
})

describe('groups', () => {
  it('round-trips createGroup -> joinGroup with matching protocol groupId and persisted state for both sides', async () => {
    const ownerSk = generateSecretKey()
    const ownerPubkey = getPublicKey(ownerSk)
    const owner = await generateOwnKeyPackage(ownerPubkey)

    const agentSk = generateSecretKey()
    const agentPubkey = getPublicKey(agentSk)
    const agent = await generateOwnKeyPackage(agentPubkey)

    // 1. Owner creates the group + invites the agent. createGroup persists
    //    owner-side state and returns the Welcome bytes the agent needs to join.
    const created = await createGroup({
      ownerPubkey,
      ownerKp: owner.publicPackage,
      ownerPrivateKp: owner.privatePackage,
      agentKp: agent.publicPackage
    })
    expect(created.groupId).toMatch(/^[0-9a-f-]+$/i)
    expect(created.welcomeBytes).toBeInstanceOf(Uint8Array)
    expect(created.welcomeBytes.length).toBeGreaterThan(0)
    expect(created.commitBytes).toBeInstanceOf(Uint8Array)
    expect(created.commitBytes.length).toBeGreaterThan(0)

    expect(indexedDb.putMlsState).toHaveBeenCalledTimes(1)
    const ownerPut = vi.mocked(indexedDb.putMlsState).mock.calls[0][0]
    expect(ownerPut.groupId).toBe(created.groupId)
    expect(ownerPut.ownerPubkey).toBe(ownerPubkey)
    expect(typeof ownerPut.stateB64).toBe('string')
    expect(ownerPut.stateB64.length).toBeGreaterThan(0)

    // 2. Agent joins via the Welcome. joinGroup persists agent-side state and
    //    derives the same protocol groupId from the MLS GroupContext.
    const joined = await joinGroup({
      ownerPubkey: agentPubkey,
      joinerKp: agent.publicPackage,
      joinerPrivateKp: agent.privatePackage,
      welcomeBytes: created.welcomeBytes
    })
    expect(joined.groupId).toBe(created.groupId)

    expect(indexedDb.putMlsState).toHaveBeenCalledTimes(2)
    const agentPut = vi.mocked(indexedDb.putMlsState).mock.calls[1][0]
    expect(agentPut.groupId).toBe(created.groupId)
    expect(agentPut.ownerPubkey).toBe(agentPubkey)
    expect(typeof agentPut.stateB64).toBe('string')
    expect(agentPut.stateB64.length).toBeGreaterThan(0)
  })

  it('getGroupState returns decoded ClientState whose GroupContext.groupId matches', async () => {
    const ownerSk = generateSecretKey()
    const ownerPubkey = getPublicKey(ownerSk)
    const owner = await generateOwnKeyPackage(ownerPubkey)
    const agentSk = generateSecretKey()
    const agentPubkey = getPublicKey(agentSk)
    const agent = await generateOwnKeyPackage(agentPubkey)

    const created = await createGroup({
      ownerPubkey,
      ownerKp: owner.publicPackage,
      ownerPrivateKp: owner.privatePackage,
      agentKp: agent.publicPackage
    })

    const state = await getGroupState(created.groupId)
    expect(state).not.toBeNull()
    if (!state) throw new Error('expected state to be non-null')
    const decoder = new TextDecoder()
    expect(decoder.decode(state.groupContext.groupId)).toBe(created.groupId)
  })

  it('getGroupState returns null when groupId is unknown', async () => {
    const result = await getGroupState('does-not-exist-' + Math.random())
    expect(result).toBeNull()
  })

  it('joinGroup throws when welcomeBytes are malformed', async () => {
    const joinerSk = generateSecretKey()
    const joinerPubkey = getPublicKey(joinerSk)
    const joiner = await generateOwnKeyPackage(joinerPubkey)

    // Garbage bytes that don't decode as an MLS message.
    const malformed = new Uint8Array([0xff, 0x00, 0x01, 0x02, 0x03, 0x04])

    await expect(
      joinGroup({
        ownerPubkey: joinerPubkey,
        joinerKp: joiner.publicPackage,
        joinerPrivateKp: joiner.privatePackage,
        welcomeBytes: malformed
      })
    ).rejects.toThrow()
  })

  it('joinGroup throws when the message is the wrong wireformat (not a welcome)', async () => {
    // Encode something valid that ISN'T a welcome — a bare KeyPackage message —
    // to exercise the explicit "expected welcome" error path.
    const { encode, mlsMessageEncoder, protocolVersions, wireformats } = await import('ts-mls')
    const ownerSk = generateSecretKey()
    const ownerPubkey = getPublicKey(ownerSk)
    const owner = await generateOwnKeyPackage(ownerPubkey)
    const notAWelcome = encode(mlsMessageEncoder, {
      version: protocolVersions.mls10,
      wireformat: wireformats.mls_key_package,
      keyPackage: owner.publicPackage
    })
    await expect(
      joinGroup({
        ownerPubkey,
        joinerKp: owner.publicPackage,
        joinerPrivateKp: owner.privatePackage,
        welcomeBytes: notAWelcome
      })
    ).rejects.toThrow(/welcome/i)
  })
})
