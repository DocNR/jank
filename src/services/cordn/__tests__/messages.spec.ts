import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import {
  decode,
  clientStateDecoder,
  type ClientState
} from 'ts-mls'

// Mock IDB so the underlying groups module (used to bootstrap a real MLS group
// pair for the round-trip) doesn't touch IndexedDB. Mirrors groups.spec.ts.
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
import { createGroup, joinGroup } from '../groups'
import { encodeEnvelope } from '../envelope'
import { encryptOutbound, decryptInbound } from '../messages'
import { decodeMlsState } from '../mlsUtils'
import type { MlsStateRecord } from '@/services/indexed-db.service'

let putRecords: MlsStateRecord[] = []

beforeEach(() => {
  vi.mocked(indexedDb.putMlsState).mockReset()
  vi.mocked(indexedDb.getMlsState).mockReset()

  putRecords = []
  const store = new Map<string, MlsStateRecord>()
  vi.mocked(indexedDb.putMlsState).mockImplementation(async (record: MlsStateRecord) => {
    const stored = { ...record, updatedAt: Date.now() }
    store.set(record.groupId, stored)
    putRecords.push(stored)
  })
  vi.mocked(indexedDb.getMlsState).mockImplementation(async (groupId: string) => {
    return store.get(groupId) ?? null
  })
})

/** Bootstrap a real owner+agent MLS group pair via the groups module and
 *  return both decoded ClientStates plus the matching pubkeys. */
async function bootstrapGroupPair(): Promise<{
  ownerPubkey: string
  agentPubkey: string
  ownerState: ClientState
  agentState: ClientState
}> {
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
  // putRecords[0] is the owner's post-commit state.
  const ownerRecord = putRecords[0]
  expect(ownerRecord.ownerPubkey).toBe(ownerPubkey)

  await joinGroup({
    ownerPubkey: agentPubkey,
    joinerKp: agent.publicPackage,
    joinerPrivateKp: agent.privatePackage,
    welcomeBytes: created.welcomeBytes
  })
  // putRecords[1] is the agent's joined state.
  const agentRecord = putRecords[1]
  expect(agentRecord.ownerPubkey).toBe(agentPubkey)

  const ownerStateDecoded = decode(clientStateDecoder, decodeMlsState(ownerRecord.stateB64))
  const agentStateDecoded = decode(clientStateDecoder, decodeMlsState(agentRecord.stateB64))
  if (!ownerStateDecoded || !agentStateDecoded) {
    throw new Error('test bootstrap: failed to decode persisted ClientState')
  }

  return {
    ownerPubkey,
    agentPubkey,
    ownerState: ownerStateDecoded,
    agentState: agentStateDecoded
  }
}

describe('cordn messages', () => {
  it('round-trips encryptOutbound -> decryptInbound and preserves envelope content + id', async () => {
    const { ownerPubkey, agentState, ownerState } = await bootstrapGroupPair()

    const envelope = encodeEnvelope({
      pubkey: ownerPubkey,
      kind: 9,
      tags: [],
      content: 'hello cordn',
      created_at: 1700000000
    })

    const encrypted = await encryptOutbound({ state: ownerState, envelope })
    expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array)
    expect(encrypted.ciphertext.length).toBeGreaterThan(0)
    expect(encrypted.newState).toBeDefined()
    // State must actually advance per the MLS ratchet.
    expect(encrypted.newState).not.toBe(ownerState)

    const decrypted = await decryptInbound({
      state: agentState,
      ciphertext: encrypted.ciphertext,
      expectedSenderPubkey: ownerPubkey
    })
    expect(decrypted.envelope.content).toBe('hello cordn')
    expect(decrypted.envelope.id).toBe(envelope.id)
    expect(decrypted.envelope.pubkey).toBe(ownerPubkey)
    expect(decrypted.envelope.kind).toBe(9)
    expect(decrypted.newState).toBeDefined()
    expect(decrypted.newState).not.toBe(agentState)
  })

  it('rejects an authenticated-sender mismatch on decryptInbound', async () => {
    const { ownerPubkey, agentState, ownerState } = await bootstrapGroupPair()

    const envelope = encodeEnvelope({
      pubkey: ownerPubkey,
      kind: 9,
      tags: [],
      content: 'mismatch test',
      created_at: 1700000001
    })

    const encrypted = await encryptOutbound({ state: ownerState, envelope })

    await expect(
      decryptInbound({
        state: agentState,
        ciphertext: encrypted.ciphertext,
        expectedSenderPubkey: 'ff'.repeat(32)
      })
    ).rejects.toThrow(/sender mismatch/i)
  })

  it('throws when ciphertext fails to decode as an MLS message', async () => {
    const { agentState, ownerPubkey } = await bootstrapGroupPair()

    const garbage = new Uint8Array([0x01, 0x02, 0x03])
    await expect(
      decryptInbound({
        state: agentState,
        ciphertext: garbage,
        expectedSenderPubkey: ownerPubkey
      })
    ).rejects.toThrow()
  })

  it('advances state independently per call (two outbound messages produce distinct ciphertexts)', async () => {
    const { ownerPubkey, ownerState } = await bootstrapGroupPair()

    const env1 = encodeEnvelope({
      pubkey: ownerPubkey,
      kind: 9,
      tags: [],
      content: 'first',
      created_at: 1700000010
    })
    const env2 = encodeEnvelope({
      pubkey: ownerPubkey,
      kind: 9,
      tags: [],
      content: 'second',
      created_at: 1700000011
    })

    const enc1 = await encryptOutbound({ state: ownerState, envelope: env1 })
    const enc2 = await encryptOutbound({ state: enc1.newState, envelope: env2 })

    // Distinct ciphertexts because the ratchet advanced between calls.
    expect(enc1.ciphertext).not.toEqual(enc2.ciphertext)
  })
})
