/**
 * Coordinator RPC client — thin wrapper around contextVmClient.callTool that
 * exposes the 4 Cordn coordinator-specific tools used by Phase 2b.
 *
 * Canonical wire format (PascalCase tool names + snake_case args), aligned with
 * cordn-web's `chatKeyPackages.svelte.ts` / `chatGroups.svelte.ts` and the
 * upstream Cordn coordinator implementation:
 *
 *   - PublishKeyPackage   { kp_ref, kp_64 }   — publish own MLS KP
 *   - ConsumeKeyPackage   { id }              — one-shot consume by stable id
 *   - PostGroupMessage    { msg_64 }          — send an MLS app message (or commit)
 *   - FetchGroupMessages  { gid, after? }     — bounded backlog fetch
 *
 * The JS helper names stay camelCase to follow jank style; only the on-wire
 * tool-name string (the second arg to contextVmClient.callTool) is PascalCase.
 *
 * CEP-41 live subscription is handled by `services/cordn/watch.ts` directly via
 * a poll-loop over `fetchGroupMessages` (with cursor persistence + self-echo
 * dedup that a thin RPC wrapper can't model). When contextVmClient gains a
 * native `subscribeTool`, watch.ts is the right place to upgrade.
 *
 * Phase 5 will additionally need welcome-delivery RPCs (publish/fetch pending
 * Welcomes per cordn-web's `chatWelcomeNotifications`); those are intentionally
 * out of scope for PR 2b.
 *
 * Spec: https://github.com/Cordn-msg/cordn/blob/main/spec/00.md
 */

import contextVmClient from '../context-vm-client.service'

/** Coordinator call timeout — shorter than the default 30s since coordinator
 *  round-trips are typically sub-second for local/well-connected servers. */
const COORDINATOR_TIMEOUT_MS = 15_000

// ---------------------------------------------------------------------------
// Input types — field names match the canonical wire (snake_case)
// ---------------------------------------------------------------------------

export interface KpPublishInput extends Record<string, unknown> {
  /** RFC 9420 KeyPackage reference (hex). */
  kp_ref: string
  /** Base64 of the encoded public KeyPackage bytes. */
  kp_64: string
}

export interface KpConsumeInput extends Record<string, unknown> {
  /** Stable identifier (typically the target's Nostr pubkey hex) the
   *  coordinator looks up. One-shot semantics: returning a KP consumes it
   *  unless the KP carries the MLS last-resort extension. */
  id: string
}

export interface GroupSendInput extends Record<string, unknown> {
  /** Base64-encoded MLS opaque message (application data or commit). */
  msg_64: string
}

export interface GroupFetchInput extends Record<string, unknown> {
  /** Group id (UTF-8 decode of MLS GroupContext.groupId per cordn-web). */
  gid: string
  /** Cursor floor. Omit for first-fetch from epoch 0. */
  after?: number
}

// ---------------------------------------------------------------------------
// One-shot RPC helpers
// ---------------------------------------------------------------------------

/** Publish own MLS KeyPackage to the coordinator. */
export async function publishKeyPackage(
  coordPubkey: string,
  signerPubkey: string,
  args: KpPublishInput
) {
  return contextVmClient.callTool(coordPubkey, 'PublishKeyPackage', args, {
    signerPubkey,
    timeoutMs: COORDINATOR_TIMEOUT_MS
  })
}

/** Consume (fetch + take) a target's MLS KeyPackage from the coordinator.
 *  One-shot: non-last-resort KPs are deleted server-side on return. */
export async function consumeKeyPackage(
  coordPubkey: string,
  signerPubkey: string,
  args: KpConsumeInput
) {
  return contextVmClient.callTool(coordPubkey, 'ConsumeKeyPackage', args, {
    signerPubkey,
    timeoutMs: COORDINATOR_TIMEOUT_MS
  })
}

/** Send an MLS app-layer message (or commit) to a group via the coordinator. */
export async function sendGroupMessage(
  coordPubkey: string,
  signerPubkey: string,
  args: GroupSendInput
) {
  return contextVmClient.callTool(coordPubkey, 'PostGroupMessage', args, {
    signerPubkey,
    timeoutMs: COORDINATOR_TIMEOUT_MS
  })
}

/** Fetch a bounded backlog of group messages (one-shot). */
export async function fetchGroupMessages(
  coordPubkey: string,
  signerPubkey: string,
  args: GroupFetchInput
) {
  return contextVmClient.callTool(coordPubkey, 'FetchGroupMessages', args, {
    signerPubkey,
    timeoutMs: COORDINATOR_TIMEOUT_MS
  })
}
