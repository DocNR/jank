/**
 * MLS group creation, join via welcome, and state lookup — Cordn protocol
 * primitives.
 *
 * Three pure async functions that wrap ts-mls + the IndexedDB MLS_STATE store.
 * v1 minimum scope: no Svelte/Jotai store, no member-invite queue, no
 * multi-account loader, no group metadata extension, no message send, no
 * removal flow, no sync-issues tracking. Phase 3 (drawer UI), Phase 5 (pairing
 * wizard), and any future "groups manager" surface compose these primitives.
 *
 * Spec: /tmp/cordn-spec/01.md § 7 (group metadata extension is OPTIONAL — a
 * 1:1 jank<>agent group does not need shared metadata, so v1 omits the
 * extension at the GroupContext level even though KeyPackages still advertise
 * capability for it via createCordnCapabilities()).
 *
 * Reference: cordn-web's src/lib/services/chatGroupLifecycle.ts (createGroup
 * shape) + src/lib/services/chatMlsUtils.ts (addMemberToGroup +
 * joinGroupFromWelcome wrappers around ts-mls).
 *
 * Auth service: cordn-web uses ts-mls's `unsafeTestingAuthenticationService`
 * in production (see chatGroupLifecycle.ts line 79, chatMlsUtils.ts line 348).
 * This is intentional: the security boundary is the Cordn coordinator's
 * transport-level identity check (NIP-59 gift-wrap signature, validated
 * against the BasicCredential identity bound to the publisher's pubkey).
 * jank follows the same convention here.
 */

import {
  createGroup as mlsCreateGroup,
  createCommit,
  joinGroup as mlsJoinGroup,
  defaultProposalTypes,
  encode,
  decode,
  mlsMessageEncoder,
  mlsMessageDecoder,
  clientStateEncoder,
  clientStateDecoder,
  protocolVersions,
  wireformats,
  unsafeTestingAuthenticationService,
  type ClientState,
  type KeyPackage,
  type PrivateKeyPackage
} from 'ts-mls'

import idb from '@/services/indexed-db.service'
import { getCiphersuite, encodeMlsState, decodeMlsState } from './mlsUtils'

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

/** UTF-8 decode of `state.groupContext.groupId`. Mirrors cordn-web's
 *  `getProtocolGroupId` (chatGroupLifecycle.ts line 87). */
function getProtocolGroupId(state: ClientState): string {
  return utf8Decoder.decode(state.groupContext.groupId)
}

/**
 * Create a new MLS group with the owner as the sole initial member, then
 * immediately add the agent via a Commit + Welcome. Persists the post-commit
 * owner state to IndexedDB keyed by the protocol groupId.
 *
 * Callers (Phase 5's pairing wizard) are responsible for:
 *   - generating the owner's KeyPackage (via keyPackages.generateOwnKeyPackage)
 *   - fetching the agent's KeyPackage (via keyPackages.fetchAgentKeyPackage)
 *   - publishing the returned welcomeBytes to the agent via the coordinator
 *     (the publish-welcome coordinator RPC is NOT in PR 2b; Phase 5 must add it
 *     alongside fetch-welcomes — see chatWelcomeNotifications in cordn-web)
 *   - publishing the returned commitBytes to the group via the coordinator
 *     (`coordinatorClient.sendGroupMessage` with `msg_64: bytesToBase64(commitBytes)`)
 *   - **calling `watchHandle.registerSelfEcho(commitBytes)` BEFORE posting** so
 *     the watch loop skips our own commit when the coordinator echoes it back
 *     (otherwise `messages.decryptInbound` will throw "expected applicationMessage")
 *
 * The group does NOT carry the cordn_group_metadata extension at the
 * GroupContext level (per spec § 7, the extension is optional for a 1:1
 * jank<>agent group). KeyPackages still advertise capability for it via
 * `createCordnCapabilities()` so future metadata-bearing groups remain
 * possible without rotating identities.
 */
export async function createGroup(input: {
  /** Stable Nostr pubkey of the owner (the jank account creating the group).
   *  Persisted on the MLS_STATE record so the group can be scoped to a paired
   *  account on reload. */
  ownerPubkey: string
  /** The owner's MLS KeyPackage. Typically freshly generated. */
  ownerKp: KeyPackage
  /** The owner's private MLS material paired with ownerKp. */
  ownerPrivateKp: PrivateKeyPackage
  /** The agent's public KeyPackage, already fetched + client-validated via
   *  keyPackages.fetchAgentKeyPackage. */
  agentKp: KeyPackage
}): Promise<{
  /** UTF-8 decode of MLS GroupContext.groupId (matches cordn-web's
   *  `getProtocolGroupId`). Use this as the IDB primary key. */
  groupId: string
  /** Encoded Welcome message bytes ready to publish to the agent via the
   *  Cordn coordinator. */
  welcomeBytes: Uint8Array
  /** Encoded commit message bytes ready to publish to the group via
   *  PostGroupMessage. */
  commitBytes: Uint8Array
}> {
  const cipherSuite = await getCiphersuite()
  const context = { cipherSuite, authService: unsafeTestingAuthenticationService }

  // Per cordn-web's chatGroupLifecycle.ts line 80: random UUID, UTF-8 encoded.
  const groupId = utf8Encoder.encode(crypto.randomUUID())

  // 1-member group with just the owner.
  const initialState = await mlsCreateGroup({
    context,
    groupId,
    keyPackage: input.ownerKp,
    privateKeyPackage: input.ownerPrivateKp
  })

  // Add the agent via a Commit. ratchetTreeExtension: true embeds the ratchet
  // tree in the Welcome so the joiner does not need a separate ratchetTree
  // argument to joinGroup (mirrors cordn-web's addMemberToGroup at
  // chatMlsUtils.ts line 388).
  const commitResult = await createCommit({
    context,
    state: initialState,
    ratchetTreeExtension: true,
    extraProposals: [
      {
        proposalType: defaultProposalTypes.add,
        add: { keyPackage: input.agentKp }
      }
    ]
  })

  if (!commitResult.welcome) {
    // Mirrors cordn-web's exact throw at chatMlsUtils.ts:404.
    throw new Error('cordn createGroup: Commit did not produce a welcome message')
  }

  const protocolGroupId = getProtocolGroupId(commitResult.newState)
  const stateB64 = encodeMlsState(encode(clientStateEncoder, commitResult.newState))

  await idb.putMlsState({
    groupId: protocolGroupId,
    ownerPubkey: input.ownerPubkey,
    stateB64,
    updatedAt: Date.now()
  })

  const welcomeBytes = encode(mlsMessageEncoder, {
    version: protocolVersions.mls10,
    wireformat: wireformats.mls_welcome,
    welcome: commitResult.welcome.welcome
  })
  const commitBytes = encode(mlsMessageEncoder, commitResult.commit)

  return {
    groupId: protocolGroupId,
    welcomeBytes,
    commitBytes
  }
}

/**
 * Process an incoming Welcome message to join an existing MLS group, then
 * persist the resulting joiner-side ClientState to IndexedDB keyed by the
 * protocol groupId. Mirrors cordn-web's `joinGroupFromWelcome`
 * (chatMlsUtils.ts line 341).
 *
 * The Welcome carries an embedded ratchet tree (because the creator set
 * `ratchetTreeExtension: true` on the Commit), so no separate `ratchetTree`
 * argument is needed here.
 */
export async function joinGroup(input: {
  /** Stable Nostr pubkey of the joiner. Persisted on the MLS_STATE record. */
  ownerPubkey: string
  /** The joiner's public KeyPackage (the one that was Add'd in the inviter's
   *  Commit). */
  joinerKp: KeyPackage
  /** The joiner's private MLS material paired with joinerKp. */
  joinerPrivateKp: PrivateKeyPackage
  /** Encoded Welcome message bytes received via the Cordn coordinator. */
  welcomeBytes: Uint8Array
}): Promise<{ groupId: string }> {
  const decoded = decode(mlsMessageDecoder, input.welcomeBytes)
  if (!decoded) {
    throw new Error('cordn joinGroup: welcome bytes failed to decode as MLS message')
  }
  if (decoded.wireformat !== wireformats.mls_welcome) {
    throw new Error(
      `cordn joinGroup: expected welcome message, got wireformat=${decoded.wireformat}`
    )
  }

  const cipherSuite = await getCiphersuite()
  const state = await mlsJoinGroup({
    context: { cipherSuite, authService: unsafeTestingAuthenticationService },
    welcome: decoded.welcome,
    keyPackage: input.joinerKp,
    privateKeys: input.joinerPrivateKp
  })

  const protocolGroupId = getProtocolGroupId(state)
  const stateB64 = encodeMlsState(encode(clientStateEncoder, state))

  await idb.putMlsState({
    groupId: protocolGroupId,
    ownerPubkey: input.ownerPubkey,
    stateB64,
    updatedAt: Date.now()
  })

  return { groupId: protocolGroupId }
}

/**
 * Load + decode the most recent persisted ClientState for the given group.
 * Returns null when the group is unknown (no IDB record). Used by higher-level
 * surfaces (drawer UI, future message-processing loops) that need to operate
 * on the live MLS state without re-running create/join.
 */
export async function getGroupState(groupId: string): Promise<ClientState | null> {
  const record = await idb.getMlsState(groupId)
  if (!record) return null
  const decoded = decode(clientStateDecoder, decodeMlsState(record.stateB64))
  if (!decoded) {
    // Persisted bytes failed to decode — likely a schema rev mismatch. Surface
    // this loudly rather than silently returning null, which would look like
    // "group not found" to the caller and trigger a re-pair flow.
    throw new Error(
      `cordn getGroupState: persisted MLS state for ${groupId} failed to decode (corrupt or ts-mls version mismatch)`
    )
  }
  return decoded
}
