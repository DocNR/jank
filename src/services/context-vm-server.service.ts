/**
 * jank-as-MCP-server over ContextVM.
 *
 * Listens on each Workspace owner's pubkey for inbound gift-wrapped MCP
 * requests; dispatches via the tool registry; gift-wraps responses back.
 *
 * OPSEC POSTURE (spec §10):
 * By default, this server does not expose anything that would link the user's
 * paired accounts together. Subscription only opens when pairedAgents.length > 0
 * for a Workspace — zero paired agents means truly invisible to MCP probers.
 * Users can opt into broader exposure via per-Workspace allowSiblingExposure
 * (affects list_columns) and a future per-agent canSeeSiblings flag (feature 2+).
 *
 * Spec: docs/superpowers/specs/2026-05-25-spectr-ai-track-b-feature-1-read-only-tools.md
 */
import { encodeMcpResponse, parseMcpRequest, unwrapGift, wrapGift } from '@/lib/contextvm-wire'
import { CONTEXTVM_RPC_KIND, EPHEMERAL_GIFT_WRAP_KIND } from '@/lib/contextvm'
import type { TMcpRequest, TMcpResponse } from '@/lib/contextvm'
import type { Event as NEvent } from 'nostr-tools'
import type { ISigner } from '@/types'
import { recordAgentCall } from '@/hooks/useAgentLastCalled'
import pkg from '../../package.json'

/**
 * Response signing identity — workspace-owner key:
 *
 * Every gift-wrapped response (initialize, tools/list, tools/call) is signed by
 * the workspace owner's signer — the same pubkey the agent connected to as
 * `serverPubkey`. A stock @contextvm/sdk / @modelcontextprotocol/sdk client
 * rejects any response whose inner event is NOT signed by that pubkey ("Skipping
 * event from unexpected server pubkey"), and the MCP SDK's Zod validation strips
 * `serverInfo._meta`, so a session-key delegation can't be authorized
 * client-side. Signing with the owner key keeps responsePubkey === serverPubkey
 * and works against any generic client.
 *
 * Trade-off: on an nsec signer this is silent; on NIP-46 (Clave) it costs one
 * Clave prompt per call. The ephemeral session-key delegation that would amortize
 * that (see `capability-handshake/{attestation,session-keys}.ts`) is retained but
 * UNUSED — a future "verifying bridge" milestone may revive it once a client that
 * understands the attestation exists.
 */

const PROTOCOL_VERSION = '2025-06-18'

export type TToolDefinition = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

export type ToolContext = {
  workspaceOwner: string
  senderPubkey: string
}

export type McpError = { code: number; message: string; data?: unknown }

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext
) => Promise<
  { ok: true; structuredContent: unknown; content?: unknown[] } | { ok: false; error: McpError }
>

type RegistryEntry = { def: TToolDefinition; handler: ToolHandler }

class ContextVmServerService {
  private toolRegistry = new Map<string, RegistryEntry>()
  private subs = new Map<string, { close: () => void; relays: string[] }>()
  // Workspaces with an attach in flight. Guards the async window in
  // attachWorkspace (between the subs check and subs.set, across the awaited
  // relayListLookup) so concurrent calls can't open duplicate subscriptions.
  private attaching = new Set<string>()
  // In-memory mirror of pairedAgents per Workspace. Populated by the lifecycle
  // effect when it observes paired-agents diffs; read by the auth gate.
  private pairedAgentsByWorkspace = new Map<string, Set<string>>()
  // Production dependencies injected via setDependencies (Task 9); defaulted to
  // no-ops so tests can substitute via __set*ForTests.
  private publishFn: (relays: string[], evt: NEvent) => Promise<void> = async () => {}
  private signerLookup: (pubkey: string) => ISigner | null = () => null
  private subscribeFn: (
    relays: string[],
    filter: Record<string, unknown>,
    callbacks: { onevent: (evt: NEvent) => void }
  ) => { close: () => void } = () => ({ close: () => {} })
  private relayListLookup: (pubkey: string) => Promise<string[]> = async () => []
  private workspaceRelays = new Map<string, string[]>()

  setDependencies(deps: {
    publishFn: (relays: string[], evt: NEvent) => Promise<void>
    signerLookup: (pubkey: string) => ISigner | null
    subscribeFn: (
      relays: string[],
      filter: Record<string, unknown>,
      callbacks: { onevent: (evt: NEvent) => void }
    ) => { close: () => void }
    relayListLookup: (pubkey: string) => Promise<string[]>
  }): void {
    this.publishFn = deps.publishFn
    this.signerLookup = deps.signerLookup
    this.subscribeFn = deps.subscribeFn
    this.relayListLookup = deps.relayListLookup
  }

  setWorkspaceRelays(workspaceOwner: string, relays: string[]): void {
    this.workspaceRelays.set(workspaceOwner, relays)
  }

  /** Open a subscription for inbound gift-wrapped MCP requests addressed to
   *  this Workspace owner. OPSEC GATE: silent no-op when pairedAgents is empty
   *  — listen-when-paired keeps the jank server invisible to MCP probers
   *  for users with no agents paired. Idempotent + concurrency-safe: re-calls
   *  and overlapping calls are no-ops (see `attaching`). */
  async attachWorkspace(workspaceOwner: string): Promise<void> {
    // `subs` guards completed attaches; `attaching` guards the async window
    // below (relayListLookup is awaited). Without the second guard, two
    // concurrent calls — e.g. the pairedAgents effect firing twice on rapid
    // state changes — both pass the subs check, both subscribe, and every
    // inbound request is then processed twice, doubling downstream signer
    // round-trips (painful on NIP-46 / Clave).
    if (this.subs.has(workspaceOwner) || this.attaching.has(workspaceOwner)) return

    // OPSEC GATE — only listen when this Workspace has paired agents
    const paired = this.pairedAgentsByWorkspace.get(workspaceOwner) ?? new Set<string>()
    if (paired.size === 0) return // silent — caller retries when an agent pairs

    this.attaching.add(workspaceOwner)
    try {
      const relays = await this.relayListLookup(workspaceOwner)
      if (relays.length === 0) {
        console.warn(
          '[ContextVM-Server] No relays for',
          workspaceOwner.slice(0, 16),
          '— skipping'
        )
        return
      }
      this.workspaceRelays.set(workspaceOwner, relays)

      const RESPONSE_LOOKBACK_S = 60
      const sub = this.subscribeFn(
        relays,
        {
          kinds: [1059, 21059, 25910],
          '#p': [workspaceOwner],
          since: Math.floor(Date.now() / 1000) - RESPONSE_LOOKBACK_S
        },
        {
          onevent: (evt) => {
            this.handleInboundGift(evt, workspaceOwner).catch((err) => {
              console.warn('[ContextVM-Server] dispatch failure:', err)
            })
          }
        }
      )

      this.subs.set(workspaceOwner, { close: sub.close, relays })
    } finally {
      this.attaching.delete(workspaceOwner)
    }
  }

  detachWorkspace(workspaceOwner: string): void {
    const sub = this.subs.get(workspaceOwner)
    if (sub) {
      sub.close()
      this.subs.delete(workspaceOwner)
      this.workspaceRelays.delete(workspaceOwner)
    }
  }

  registerTool(name: string, def: TToolDefinition, handler: ToolHandler): void {
    if (this.toolRegistry.has(name)) {
      throw new Error(`Tool already registered: ${name}`)
    }
    this.toolRegistry.set(name, { def, handler })
  }

  /** Update the in-memory mirror of paired-agent pubkeys for a Workspace.
   *  Called by the lifecycle effect when pairedAgents NIP-78 state changes. */
  setPairedAgents(workspaceOwner: string, pubkeys: Set<string>): void {
    this.pairedAgentsByWorkspace.set(workspaceOwner, pubkeys)
  }

  async handleInitialize(
    req: TMcpRequest,
    workspaceOwner: string
  ): Promise<TMcpResponse<{
    protocolVersion: string
    capabilities: Record<string, unknown>
    serverInfo: { name: string; version: string }
  }>> {
    // Guard: we must have the owner's signer to sign responses (in
    // handleInboundGift). No attestation is emitted — the response is signed by
    // the owner key, so no client-readable delegation is needed. See the
    // top-of-file note on the unused capability-handshake path.
    const signer = this.signerLookup(workspaceOwner)
    if (!signer) {
      return encodeMcpResponse(req.id!, {
        error: { code: -32603, message: 'No signer available for workspace owner' }
      })
    }
    return encodeMcpResponse(req.id!, {
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: 'jank',
          version: pkg.version
        }
      }
    })
  }

  handleToolsList(req: TMcpRequest): TMcpResponse<{ tools: TToolDefinition[] }> {
    const tools = Array.from(this.toolRegistry.values()).map(({ def }) => def)
    return encodeMcpResponse(req.id!, { result: { tools } })
  }

  async handleToolsCall(req: TMcpRequest, ctx: ToolContext): Promise<TMcpResponse> {
    const paired = this.pairedAgentsByWorkspace.get(ctx.workspaceOwner) ?? new Set<string>()
    if (!paired.has(ctx.senderPubkey)) {
      return encodeMcpResponse(req.id!, {
        error: { code: -32000, message: 'Unauthorized agent' }
      })
    }

    const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
    if (!params.name) {
      return encodeMcpResponse(req.id!, {
        error: { code: -32602, message: 'tools/call requires params.name' }
      })
    }

    const entry = this.toolRegistry.get(params.name)
    if (!entry) {
      return encodeMcpResponse(req.id!, {
        error: { code: -32601, message: `Tool not found: ${params.name}` }
      })
    }

    let result
    try {
      result = await entry.handler(params.arguments ?? {}, ctx)
    } catch (err) {
      return encodeMcpResponse(req.id!, {
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal error'
        }
      })
    }

    if (!result.ok) {
      return encodeMcpResponse(req.id!, { error: result.error })
    }

    // Successful call — record heartbeat for the UI's lastCalledAt indicator.
    recordAgentCall(ctx.workspaceOwner, ctx.senderPubkey)

    // Per MCP spec §Tool Result: include both structured + serialized text content
    const serialized = JSON.stringify(result.structuredContent)
    return encodeMcpResponse(req.id!, {
      result: {
        content: result.content ?? [{ type: 'text', text: serialized }],
        structuredContent: result.structuredContent
      }
    })
  }

  async handleInboundGift(gift: NEvent, workspaceOwner: string): Promise<void> {
    const signer = this.signerLookup(workspaceOwner)
    if (!signer) {
      return
    } // signer missing mid-flight — silent drop

    // 1. Unwrap with a 15s defensive timeout. Failures are silent drops
    // (relay noise, mismatched p-tags, malformed wraps). The timeout protects
    // against a hung bunker connection (Clave / NIP-46) — without it, a
    // dead signer would leave the dispatch awaiting forever.
    let unwrapped: {
      innerKind: number
      innerContent: string
      senderPubkey: string
      innerEventId: string
    }
    try {
      unwrapped = await Promise.race([
        unwrapGift({
          gift,
          recipientSigner: signer,
          recipientPubkey: workspaceOwner
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('unwrap timed out after 15s (signer hang)')), 15_000)
        )
      ])
    } catch {
      return // unwrap failed / signer hang — silent drop
    }
    if (unwrapped.innerKind !== CONTEXTVM_RPC_KIND) {
      return
    }

    // 2. Parse MCP envelope — malformed = silent drop
    const request = parseMcpRequest(unwrapped.innerContent)
    if (!request) {
      return
    }

    // 3. Dispatch
    let response: TMcpResponse
    switch (request.method) {
      case 'initialize':
        response = await this.handleInitialize(request, workspaceOwner)
        break
      case 'notifications/initialized':
        return // JSON-RPC notification: no response
      case 'tools/list':
        response = this.handleToolsList(request)
        break
      case 'tools/call':
        response = await this.handleToolsCall(request, {
          workspaceOwner,
          senderPubkey: unwrapped.senderPubkey
        })
        break
      default:
        response = encodeMcpResponse(request.id!, {
          error: { code: -32601, message: `Method not found: ${request.method}` }
        })
    }

    // 4. Gift-wrap response back to sender as kind 21059 (ephemeral), signed by
    // the WORKSPACE-OWNER signer so responsePubkey === serverPubkey. A stock
    // @contextvm/sdk / @modelcontextprotocol/sdk client rejects any response not
    // signed by the serverPubkey it connected to ("Skipping event from
    // unexpected server pubkey") and strips serverInfo._meta, so a session-key
    // delegation can't be authorized client-side. (Silent on nsec; one Clave
    // prompt per call on NIP-46. See the top-of-file note on the unused
    // capability-handshake path.)
    try {
      const wrapped = await wrapGift({
        senderSigner: signer,
        recipientPubkey: unwrapped.senderPubkey,
        innerKind: CONTEXTVM_RPC_KIND,
        innerContent: JSON.stringify(response),
        outerKind: EPHEMERAL_GIFT_WRAP_KIND,
        // 'simple' = @contextvm/sdk-compatible 2-layer wire format. The agent's
        // SDK client expects wrap-content = signed-inner-event directly (no
        // seal layer). See contextvm-wire.ts WrapGiftInput.mode for both modes.
        mode: 'simple',
        // Correlation: SDK requires `['e', originalEventId]` on the inner
        // response event. Without it the SDK logs "Received JSON-RPC response
        // without correlation `e` tag" and silently drops the response.
        responseToEventId: unwrapped.innerEventId
      })
      const relays = this.workspaceRelays.get(workspaceOwner) ?? []
      await this.publishFn(relays, wrapped)
    } catch (err) {
      if (err instanceof AggregateError) {
        console.warn(
          '[ContextVM-Server] response publish failed — per-relay errors:',
          err.errors.map((e) => (e instanceof Error ? e.message : String(e)))
        )
      } else {
        console.warn('[ContextVM-Server] response publish failed:', err)
      }
    }
  }

  // Test-only helpers (gated by __ prefix; safe to ship since they read state)
  __resetForTests(): void {
    this.toolRegistry.clear()
    this.pairedAgentsByWorkspace.clear()
    for (const { close } of this.subs.values()) close()
    this.subs.clear()
    this.workspaceRelays.clear()
    this.publishFn = async () => {}
    this.signerLookup = () => null
    this.subscribeFn = () => ({ close: () => {} })
    this.relayListLookup = async () => []
  }

  /** Test-only: invoke the initialize handler directly and return the raw
   *  JSON-RPC result object (unwrapped from the MCP envelope). */
  async __handleInitializeForTest(
    workspaceOwner: string,
    _senderPubkey: string
  ): Promise<{ result: any }> {
    const mcpResp = await this.handleInitialize(
      { jsonrpc: '2.0', id: 'test-init', method: 'initialize', params: {} },
      workspaceOwner
    )
    // encodeMcpResponse returns { jsonrpc, id, result } or { jsonrpc, id, error }
    const r = mcpResp as any
    if (r.error) return { result: { error: r.error } }
    return { result: r.result }
  }

  __getRegistry(): Map<string, RegistryEntry> {
    return this.toolRegistry
  }

  __setPairedAgentsForTests(workspaceOwner: string, pubkeys: Set<string>): void {
    this.pairedAgentsByWorkspace.set(workspaceOwner, pubkeys)
  }

  __setPublishForTests(fn: (relays: string[], evt: NEvent) => Promise<void>): void {
    this.publishFn = fn
  }

  __setSignerLookupForTests(fn: (pk: string) => ISigner | null): void {
    this.signerLookup = fn
  }

  __setRelaysForTests(workspaceOwner: string, relays: string[]): void {
    this.workspaceRelays.set(workspaceOwner, relays)
  }

  __setSubscribeForTests(
    fn: (
      relays: string[],
      filter: Record<string, unknown>,
      callbacks: { onevent: (evt: NEvent) => void }
    ) => { close: () => void }
  ): void {
    this.subscribeFn = fn
  }

  __setRelayListLookupForTests(fn: (pubkey: string) => Promise<string[]>): void {
    this.relayListLookup = fn
  }
}

const instance = new ContextVmServerService()
export default instance
