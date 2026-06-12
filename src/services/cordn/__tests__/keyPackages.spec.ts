import { describe, it, expect, vi, beforeEach } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { EventTemplate } from 'nostr-tools'

// Mock contextVmClient BEFORE importing the module under test so the keyPackages
// module's transitive import of coordinatorClient picks up the mock.
vi.mock('../../context-vm-client.service', () => ({
  default: {
    callTool: vi.fn()
  }
}))

import { generateOwnKeyPackage, publishOwnKeyPackage, fetchAgentKeyPackage } from '../keyPackages'
import contextVmClient from '../../context-vm-client.service'

const COORD_PUBKEY = 'cc'.repeat(32)
const SIGNER_PUBKEY = 'dd'.repeat(32)

beforeEach(() => {
  vi.mocked(contextVmClient.callTool).mockReset()
})

/** Build a signed cordn PublishKeyPackage publication event whose `content` is
 *  the JSON-RPC envelope the spec § 7 requires. Real signature so verifyEvent
 *  passes; tests can opt to tamper afterwards to exercise the negative path. */
function buildPublicationEvent(args: {
  signerSk: Uint8Array
  kp64: string
  kpRef: string
  /** Default 25910 (ContextVM RPC envelope kind). The fetcher does not check
   *  kind; only verifyEvent shape + signature matter. */
  kind?: number
}) {
  const tpl: EventTemplate = {
    kind: args.kind ?? 25910,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify({
      jsonrpc: '2.0',
      id: 'test-pub-id',
      method: 'tools/call',
      params: {
        name: 'PublishKeyPackage',
        arguments: { kp_ref: args.kpRef, kp_64: args.kp64 }
      }
    })
  }
  return finalizeEvent(tpl, args.signerSk)
}

describe('keyPackages', () => {
  it('round-trips generate -> publish (mocked) -> fetch with matching kpRef', async () => {
    // Owner generates a KP for their own paired identity.
    const ownerSk = generateSecretKey()
    const ownerPubkey = getPublicKey(ownerSk)
    const owner = await generateOwnKeyPackage(ownerPubkey)
    expect(owner.kpRef).toMatch(/^[0-9a-f]+$/)
    expect(owner.kpBase64.length).toBeGreaterThan(0)
    expect(owner.publicPackage).toBeDefined()
    expect(owner.privatePackage).toBeDefined()

    // Publish captures the PublishKeyPackage call to the coordinator.
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce({
      ok: true,
      structuredContent: { last_resort: false }
    } as Awaited<ReturnType<typeof contextVmClient.callTool>>)
    await publishOwnKeyPackage(COORD_PUBKEY, SIGNER_PUBKEY, {
      kpRef: owner.kpRef,
      kpBase64: owner.kpBase64
    })
    expect(contextVmClient.callTool).toHaveBeenCalledWith(
      COORD_PUBKEY,
      'PublishKeyPackage',
      { kp_ref: owner.kpRef, kp_64: owner.kpBase64 },
      expect.objectContaining({ signerPubkey: SIGNER_PUBKEY })
    )

    // The agent generates a KP for itself, then publishes via a signed event.
    // We can construct that signed event here because we hold the agent's sk
    // for the test (in prod, the agent's coordinator signed it at publish).
    const agentSk = generateSecretKey()
    const agentPubkey = getPublicKey(agentSk)
    const agent = await generateOwnKeyPackage(agentPubkey)
    const pubEvent = buildPublicationEvent({
      signerSk: agentSk,
      kp64: agent.kpBase64,
      kpRef: agent.kpRef
    })
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce({
      ok: true,
      structuredContent: {
        keyPackage: {
          pk: agentPubkey,
          kp_ref: agent.kpRef,
          kp_64: agent.kpBase64,
          event: pubEvent,
          last_resort: false
        }
      }
    } as Awaited<ReturnType<typeof contextVmClient.callTool>>)

    const fetched = await fetchAgentKeyPackage(COORD_PUBKEY, SIGNER_PUBKEY, agentPubkey)
    expect(contextVmClient.callTool).toHaveBeenLastCalledWith(
      COORD_PUBKEY,
      'ConsumeKeyPackage',
      { id: agentPubkey },
      expect.objectContaining({ signerPubkey: SIGNER_PUBKEY })
    )
    // kpRef is now recomputed from the decoded KP, not echoed from payload.kp_ref.
    expect(fetched.kpRef).toBe(agent.kpRef)
    expect(fetched.keyPackage).toBeDefined()
  })

  it('throws when BasicCredential identity does not match the requested pubkey', async () => {
    // Coordinator returns a KP bound to OWNER but the caller asked for AGENT.
    // The publication event is signed by OWNER (the publisher), the KP binds
    // OWNER, but the lookup was for a different agent — the requested-vs-bound
    // mismatch check must fire.
    const ownerSk = generateSecretKey()
    const ownerPubkey = getPublicKey(ownerSk)
    const otherIdentityKp = await generateOwnKeyPackage(ownerPubkey)
    const pubEvent = buildPublicationEvent({
      signerSk: ownerSk,
      kp64: otherIdentityKp.kpBase64,
      kpRef: otherIdentityKp.kpRef
    })
    const requestedAgentSk = generateSecretKey()
    const requestedAgentPubkey = getPublicKey(requestedAgentSk)
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce({
      ok: true,
      structuredContent: {
        keyPackage: {
          pk: requestedAgentPubkey,
          kp_ref: otherIdentityKp.kpRef,
          kp_64: otherIdentityKp.kpBase64,
          event: pubEvent,
          last_resort: false
        }
      }
    } as Awaited<ReturnType<typeof contextVmClient.callTool>>)
    await expect(
      fetchAgentKeyPackage(COORD_PUBKEY, SIGNER_PUBKEY, requestedAgentPubkey)
    ).rejects.toThrow(/identity/i)
  })

  it('throws when publication event signer does not match the embedded credential identity', async () => {
    // Spec § 9: credential identity MUST match publication signer. Here the
    // KP is bound to AGENT but the publication event is signed by IMPOSTOR.
    // This is the swapped-signer attack the spec explicitly defends against.
    const agentSk = generateSecretKey()
    const agentPubkey = getPublicKey(agentSk)
    const agent = await generateOwnKeyPackage(agentPubkey)
    const impostorSk = generateSecretKey()
    const pubEvent = buildPublicationEvent({
      signerSk: impostorSk,
      kp64: agent.kpBase64,
      kpRef: agent.kpRef
    })
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce({
      ok: true,
      structuredContent: {
        keyPackage: {
          pk: agentPubkey,
          kp_ref: agent.kpRef,
          kp_64: agent.kpBase64,
          event: pubEvent,
          last_resort: false
        }
      }
    } as Awaited<ReturnType<typeof contextVmClient.callTool>>)
    await expect(
      fetchAgentKeyPackage(COORD_PUBKEY, SIGNER_PUBKEY, agentPubkey)
    ).rejects.toThrow(/publication event signer/i)
  })

  it('throws when publication event signature is invalid (tampered sig)', async () => {
    // Tamper with .sig after signing so verifyEvent rejects.
    const agentSk = generateSecretKey()
    const agentPubkey = getPublicKey(agentSk)
    const agent = await generateOwnKeyPackage(agentPubkey)
    const pubEvent = buildPublicationEvent({
      signerSk: agentSk,
      kp64: agent.kpBase64,
      kpRef: agent.kpRef
    })
    // Flip the first byte of the signature. Schnorr sigs are sensitive to any
    // change, so verifyEvent must reject.
    const tampered = {
      ...pubEvent,
      sig:
        (pubEvent.sig[0] === '0' ? '1' : '0') + pubEvent.sig.slice(1)
    }
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce({
      ok: true,
      structuredContent: {
        keyPackage: {
          pk: agentPubkey,
          kp_ref: agent.kpRef,
          kp_64: agent.kpBase64,
          event: tampered,
          last_resort: false
        }
      }
    } as Awaited<ReturnType<typeof contextVmClient.callTool>>)
    await expect(
      fetchAgentKeyPackage(COORD_PUBKEY, SIGNER_PUBKEY, agentPubkey)
    ).rejects.toThrow(/signature invalid/i)
  })

  it('throws when top-level kp_64 disagrees with the signed embedded kp_64', async () => {
    // Coordinator serves a signed event whose embedded kp_64 is `agent`'s
    // (legitimate) but the top-level kp_64 it returns is `decoy`'s. The
    // belt-and-suspenders cross-check must catch the mismatch.
    const agentSk = generateSecretKey()
    const agentPubkey = getPublicKey(agentSk)
    const agent = await generateOwnKeyPackage(agentPubkey)
    const decoy = await generateOwnKeyPackage(agentPubkey)
    const pubEvent = buildPublicationEvent({
      signerSk: agentSk,
      kp64: agent.kpBase64,
      kpRef: agent.kpRef
    })
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce({
      ok: true,
      structuredContent: {
        keyPackage: {
          pk: agentPubkey,
          kp_ref: agent.kpRef,
          kp_64: decoy.kpBase64,
          event: pubEvent,
          last_resort: false
        }
      }
    } as Awaited<ReturnType<typeof contextVmClient.callTool>>)
    await expect(
      fetchAgentKeyPackage(COORD_PUBKEY, SIGNER_PUBKEY, agentPubkey)
    ).rejects.toThrow(/disagrees/i)
  })

  it('throws when publication event field is missing or wrong shape', async () => {
    const agentSk = generateSecretKey()
    const agentPubkey = getPublicKey(agentSk)
    const agent = await generateOwnKeyPackage(agentPubkey)
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce({
      ok: true,
      structuredContent: {
        keyPackage: {
          pk: agentPubkey,
          kp_ref: agent.kpRef,
          kp_64: agent.kpBase64,
          event: { id: 'no-sig-no-pubkey' },
          last_resort: false
        }
      }
    } as Awaited<ReturnType<typeof contextVmClient.callTool>>)
    await expect(
      fetchAgentKeyPackage(COORD_PUBKEY, SIGNER_PUBKEY, agentPubkey)
    ).rejects.toThrow(/wrong shape|missing/i)
  })

  it('throws when coordinator returns no keyPackage', async () => {
    vi.mocked(contextVmClient.callTool).mockResolvedValueOnce({
      ok: true,
      structuredContent: {}
    } as Awaited<ReturnType<typeof contextVmClient.callTool>>)
    await expect(
      fetchAgentKeyPackage(COORD_PUBKEY, SIGNER_PUBKEY, 'aa'.repeat(32))
    ).rejects.toThrow(/no published/i)
  })
})
