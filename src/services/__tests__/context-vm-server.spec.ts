import { describe, it, expect, beforeEach } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { v2 as nip44 } from 'nostr-tools/nip44'
import contextVmServer from '../context-vm-server.service'
import type { TToolDefinition, ToolHandler, ToolContext } from '../context-vm-server.service'
import { wrapGift, unwrapGift } from '@/lib/contextvm-wire'
import { CONTEXTVM_RPC_KIND, EPHEMERAL_GIFT_WRAP_KIND } from '@/lib/contextvm'
import type { ISigner } from '@/types'

describe('ContextVmServerService — tool registry', () => {
  beforeEach(() => {
    contextVmServer.__resetForTests()
  })

  it('registers and looks up a tool', () => {
    const def: TToolDefinition = {
      name: 'test_tool',
      description: '',
      inputSchema: { type: 'object' }
    }
    const handler: ToolHandler = async () => ({ ok: true, structuredContent: { x: 1 } })
    contextVmServer.registerTool('test_tool', def, handler)
    expect(contextVmServer.__getRegistry().has('test_tool')).toBe(true)
  })

  it('registerTool throws on duplicate name', () => {
    const def: TToolDefinition = {
      name: 't',
      description: '',
      inputSchema: { type: 'object' }
    }
    const handler: ToolHandler = async () => ({ ok: true, structuredContent: {} })
    contextVmServer.registerTool('t', def, handler)
    expect(() => contextVmServer.registerTool('t', def, handler)).toThrow(/already registered/i)
  })
})

describe('handleInitialize', () => {
  beforeEach(() => {
    contextVmServer.__resetForTests()
  })

  it('returns protocolVersion + capabilities + serverInfo without attestation', async () => {
    const ownerSk = generateSecretKey()
    const ownerSigner = makeKeyedSigner(ownerSk)
    contextVmServer.__setSignerLookupForTests((pk) =>
      pk === ownerSigner.pubkey ? ownerSigner : null
    )
    const req = {
      jsonrpc: '2.0' as const,
      id: 'i1',
      method: 'initialize' as const,
      params: {}
    }
    const resp = await contextVmServer.handleInitialize(req, ownerSigner.pubkey)
    expect(resp).toMatchObject({
      jsonrpc: '2.0',
      id: 'i1',
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'jank' }
      }
    })
    // version should come from package.json
    expect((resp as any).result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/)
    // No attestation: a stock MCP SDK client can't read serverInfo._meta, so
    // responses are signed by the workspace owner key instead.
    expect((resp as any).result.serverInfo._meta).toBeUndefined()
  })

  it('returns error when no signer available', async () => {
    const req = {
      jsonrpc: '2.0' as const,
      id: 'i2',
      method: 'initialize' as const,
      params: {}
    }
    const resp = (await contextVmServer.handleInitialize(req, 'no-signer-pubkey')) as any
    expect(resp.error).toBeTruthy()
    expect(resp.error.code).toBe(-32603)
  })
})

describe('handleToolsList', () => {
  beforeEach(() => contextVmServer.__resetForTests())

  it('returns empty tools array when registry is empty', () => {
    const req = {
      jsonrpc: '2.0' as const,
      id: 'i2',
      method: 'tools/list' as const,
      params: {}
    }
    const resp = contextVmServer.handleToolsList(req)
    expect(resp).toMatchObject({ id: 'i2', result: { tools: [] } })
  })

  it('returns registered tools', () => {
    contextVmServer.registerTool(
      'a_tool',
      { name: 'a_tool', description: 'desc', inputSchema: { type: 'object' } },
      async () => ({ ok: true, structuredContent: {} })
    )
    const req = {
      jsonrpc: '2.0' as const,
      id: 'i3',
      method: 'tools/list' as const,
      params: {}
    }
    const resp = contextVmServer.handleToolsList(req) as any
    expect(resp.result.tools).toHaveLength(1)
    expect(resp.result.tools[0]).toMatchObject({ name: 'a_tool', description: 'desc' })
  })
})

describe('handleToolsCall', () => {
  const owner = 'a'.repeat(64)
  const paired = 'b'.repeat(64)
  const stranger = 'c'.repeat(64)

  beforeEach(() => contextVmServer.__resetForTests())

  it('returns -32000 for unpaired sender', async () => {
    contextVmServer.registerTool(
      'noop',
      { name: 'noop', description: '', inputSchema: { type: 'object' } },
      async () => ({ ok: true, structuredContent: {} })
    )
    contextVmServer.__setPairedAgentsForTests(owner, new Set([paired]))
    const req = {
      jsonrpc: '2.0' as const,
      id: 'r1',
      method: 'tools/call' as const,
      params: { name: 'noop', arguments: {} }
    }
    const resp = (await contextVmServer.handleToolsCall(req, {
      workspaceOwner: owner,
      senderPubkey: stranger
    })) as any
    expect(resp.error.code).toBe(-32000)
    expect(resp.error.message).toMatch(/unauthorized/i)
  })

  it('dispatches to handler for paired sender', async () => {
    let invokedWith: { args: unknown; ctx: ToolContext } | null = null
    contextVmServer.registerTool(
      'echo',
      { name: 'echo', description: '', inputSchema: { type: 'object' } },
      async (args, ctx) => {
        invokedWith = { args, ctx }
        return { ok: true, structuredContent: { echoed: args } }
      }
    )
    contextVmServer.__setPairedAgentsForTests(owner, new Set([paired]))
    const req = {
      jsonrpc: '2.0' as const,
      id: 'r2',
      method: 'tools/call' as const,
      params: { name: 'echo', arguments: { x: 1 } }
    }
    const resp = (await contextVmServer.handleToolsCall(req, {
      workspaceOwner: owner,
      senderPubkey: paired
    })) as any
    expect(invokedWith).not.toBeNull()
    expect(invokedWith!.ctx.senderPubkey).toBe(paired)
    expect(resp.result.structuredContent).toEqual({ echoed: { x: 1 } })
    expect(resp.result.content).toHaveLength(1)
    expect(resp.result.content[0]).toMatchObject({ type: 'text' })
  })

  it('returns -32601 for unknown tool name', async () => {
    contextVmServer.__setPairedAgentsForTests(owner, new Set([paired]))
    const req = {
      jsonrpc: '2.0' as const,
      id: 'r3',
      method: 'tools/call' as const,
      params: { name: 'nonexistent', arguments: {} }
    }
    const resp = (await contextVmServer.handleToolsCall(req, {
      workspaceOwner: owner,
      senderPubkey: paired
    })) as any
    expect(resp.error.code).toBe(-32601)
  })

  it('returns -32602 when params.name missing', async () => {
    contextVmServer.__setPairedAgentsForTests(owner, new Set([paired]))
    const req = {
      jsonrpc: '2.0' as const,
      id: 'r4',
      method: 'tools/call' as const,
      params: {}
    }
    const resp = (await contextVmServer.handleToolsCall(req, {
      workspaceOwner: owner,
      senderPubkey: paired
    })) as any
    expect(resp.error.code).toBe(-32602)
  })

  it('returns -32603 when handler throws', async () => {
    contextVmServer.registerTool(
      'thrower',
      { name: 'thrower', description: '', inputSchema: { type: 'object' } },
      async () => {
        throw new Error('boom')
      }
    )
    contextVmServer.__setPairedAgentsForTests(owner, new Set([paired]))
    const req = {
      jsonrpc: '2.0' as const,
      id: 'r5',
      method: 'tools/call' as const,
      params: { name: 'thrower', arguments: {} }
    }
    const resp = (await contextVmServer.handleToolsCall(req, {
      workspaceOwner: owner,
      senderPubkey: paired
    })) as any
    expect(resp.error.code).toBe(-32603)
    expect(resp.error.message).toMatch(/boom/)
  })
})

function makeKeyedSigner(sk: Uint8Array): ISigner & { pubkey: string } {
  const pubkey = getPublicKey(sk)
  return {
    pubkey,
    getPublicKey: async () => pubkey,
    signEvent: async (draft: any) => finalizeEvent(draft, sk),
    nip04Encrypt: async () => {
      throw new Error('nip04 not used')
    },
    nip04Decrypt: async () => {
      throw new Error('nip04 not used')
    },
    nip44Encrypt: async (recipientPk: string, plaintext: string) => {
      const ck = nip44.utils.getConversationKey(sk, recipientPk)
      return nip44.encrypt(plaintext, ck)
    },
    nip44Decrypt: async (senderPk: string, ciphertext: string) => {
      const ck = nip44.utils.getConversationKey(sk, senderPk)
      return nip44.decrypt(ciphertext, ck)
    }
  }
}

describe('handleInboundGift', () => {
  beforeEach(() => {
    contextVmServer.__resetForTests()
  })

  it('unwraps, dispatches initialize, returns response signed by workspace owner', async () => {
    const ownerSk = generateSecretKey()
    const agentSk = generateSecretKey()
    const ownerSigner = makeKeyedSigner(ownerSk)
    const agentSigner = makeKeyedSigner(agentSk)

    const innerRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: {}
    })
    const gift = await wrapGift({
      senderSigner: agentSigner,
      recipientPubkey: ownerSigner.pubkey,
      innerKind: CONTEXTVM_RPC_KIND,
      innerContent: innerRequest
    })

    let publishedEvent: any = null
    contextVmServer.__setPublishForTests(async (_relays, evt) => {
      publishedEvent = evt
    })
    contextVmServer.__setSignerLookupForTests((pk: string) =>
      pk === ownerSigner.pubkey ? ownerSigner : null
    )
    contextVmServer.__setRelaysForTests(ownerSigner.pubkey, ['wss://test'])

    await contextVmServer.handleInboundGift(gift, ownerSigner.pubkey)

    expect(publishedEvent).not.toBeNull()
    expect(publishedEvent.kind).toBe(EPHEMERAL_GIFT_WRAP_KIND)

    const unwrapped = await unwrapGift({
      gift: publishedEvent,
      recipientSigner: agentSigner,
      recipientPubkey: agentSigner.pubkey
    })
    // Response inner event is signed by the WORKSPACE-OWNER key so a stock
    // @contextvm/sdk client (which checks inner.pubkey === serverPubkey)
    // accepts it. No session-key delegation, no _meta attestation.
    expect(unwrapped.senderPubkey).toBe(ownerSigner.pubkey)
    const innerResponse = JSON.parse(unwrapped.innerContent)
    expect(innerResponse.id).toBe('init-1')
    expect(innerResponse.result.protocolVersion).toBe('2025-06-18')
    expect(innerResponse.result.serverInfo._meta).toBeUndefined()
  })

  it('silent-drops gifts that fail to unwrap', async () => {
    const ownerSk = generateSecretKey()
    const wrongSk = generateSecretKey()
    const ownerSigner = makeKeyedSigner(ownerSk)
    const wrongSigner = makeKeyedSigner(wrongSk)

    // Wrap a gift to wrongSigner's pubkey, not the owner — owner can't decrypt.
    const gift = await wrapGift({
      senderSigner: wrongSigner,
      recipientPubkey: wrongSigner.pubkey,
      innerKind: CONTEXTVM_RPC_KIND,
      innerContent: '{}'
    })

    let publishedCount = 0
    contextVmServer.__setPublishForTests(async () => {
      publishedCount++
    })
    contextVmServer.__setSignerLookupForTests((pk: string) =>
      pk === ownerSigner.pubkey ? ownerSigner : null
    )
    contextVmServer.__setRelaysForTests(ownerSigner.pubkey, ['wss://test'])

    await contextVmServer.handleInboundGift(gift, ownerSigner.pubkey)
    expect(publishedCount).toBe(0)
  })

  it('returns -32000 for unauthorized tools/call', async () => {
    const ownerSk = generateSecretKey()
    const agentSk = generateSecretKey()
    const ownerSigner = makeKeyedSigner(ownerSk)
    const agentSigner = makeKeyedSigner(agentSk)

    contextVmServer.registerTool(
      'foo',
      { name: 'foo', description: '', inputSchema: { type: 'object' } },
      async () => ({ ok: true, structuredContent: {} })
    )
    // Do NOT pair the agent

    const innerRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'foo', arguments: {} }
    })
    const gift = await wrapGift({
      senderSigner: agentSigner,
      recipientPubkey: ownerSigner.pubkey,
      innerKind: CONTEXTVM_RPC_KIND,
      innerContent: innerRequest
    })

    let publishedEvent: any = null
    contextVmServer.__setPublishForTests(async (_relays, evt) => {
      publishedEvent = evt
    })
    contextVmServer.__setSignerLookupForTests((pk: string) =>
      pk === ownerSigner.pubkey ? ownerSigner : null
    )
    contextVmServer.__setRelaysForTests(ownerSigner.pubkey, ['wss://test'])

    await contextVmServer.handleInboundGift(gift, ownerSigner.pubkey)

    const unwrapped = await unwrapGift({
      gift: publishedEvent,
      recipientSigner: agentSigner,
      recipientPubkey: agentSigner.pubkey
    })
    const innerResponse = JSON.parse(unwrapped.innerContent)
    expect(innerResponse.error.code).toBe(-32000)
  })

  it('silent-drops a gift whose inner event spoofs a paired agent (forged sig)', async () => {
    const ownerSk = generateSecretKey()
    const ownerSigner = makeKeyedSigner(ownerSk)

    // The agent we PAIR (and which the attacker tries to impersonate).
    const pairedSk = generateSecretKey()
    const pairedPubkey = getPublicKey(pairedSk)

    contextVmServer.registerTool(
      'foo',
      { name: 'foo', description: '', inputSchema: { type: 'object' } },
      async () => ({ ok: true, structuredContent: {} })
    )
    contextVmServer.__setPairedAgentsForTests(ownerSigner.pubkey, new Set([pairedPubkey]))

    // Hand-build a 'simple'-mode gift whose inner event CLAIMS pubkey =
    // pairedPubkey but carries a garbage signature. The attacker has no secret
    // — they just encrypt to the owner's public key with a fresh ephemeral key.
    const forgedInner = {
      kind: CONTEXTVM_RPC_KIND,
      created_at: 1700000000,
      tags: [['p', ownerSigner.pubkey]],
      content: JSON.stringify({
        jsonrpc: '2.0',
        id: 'spoof-1',
        method: 'tools/call',
        params: { name: 'foo', arguments: {} }
      }),
      pubkey: pairedPubkey,
      id: 'f'.repeat(64),
      sig: '0'.repeat(128)
    }
    const ephemeralSk = generateSecretKey()
    const ck = nip44.utils.getConversationKey(ephemeralSk, ownerSigner.pubkey)
    const gift = finalizeEvent(
      {
        kind: 1059,
        created_at: 1700000000,
        tags: [['p', ownerSigner.pubkey]],
        content: nip44.encrypt(JSON.stringify(forgedInner), ck)
      },
      ephemeralSk
    )

    let publishedCount = 0
    contextVmServer.__setPublishForTests(async () => {
      publishedCount++
    })
    contextVmServer.__setSignerLookupForTests((pk: string) =>
      pk === ownerSigner.pubkey ? ownerSigner : null
    )
    contextVmServer.__setRelaysForTests(ownerSigner.pubkey, ['wss://test'])

    await contextVmServer.handleInboundGift(gift, ownerSigner.pubkey)

    // unwrapGift rejects the forged sig → handleInboundGift silent-drops. The
    // spoofed identity is NEVER authorized and no response is published.
    expect(publishedCount).toBe(0)
  })
})

describe('attachWorkspace / detachWorkspace', () => {
  beforeEach(() => {
    contextVmServer.__resetForTests()
  })

  it('attachWorkspace is a no-op when pairedAgents is empty', async () => {
    let subscribeCalls = 0
    contextVmServer.__setSubscribeForTests(() => {
      subscribeCalls++
      return { close: () => {} }
    })
    contextVmServer.__setRelayListLookupForTests(async () => ['wss://test'])

    contextVmServer.setPairedAgents('owner-pk', new Set())
    await contextVmServer.attachWorkspace('owner-pk')

    expect(subscribeCalls).toBe(0)
  })

  it('attachWorkspace opens subscription when pairedAgents.size > 0', async () => {
    let subscribeCalls = 0
    let subscribeFilter: any = null
    contextVmServer.__setSubscribeForTests((_relays, filter) => {
      subscribeCalls++
      subscribeFilter = filter
      return { close: () => {} }
    })
    contextVmServer.__setRelayListLookupForTests(async () => ['wss://test'])

    contextVmServer.setPairedAgents('owner-pk', new Set(['agent-pk']))
    await contextVmServer.attachWorkspace('owner-pk')

    expect(subscribeCalls).toBe(1)
    expect(subscribeFilter['#p']).toEqual(['owner-pk'])
    expect(subscribeFilter.kinds).toContain(1059)
    expect(subscribeFilter.kinds).toContain(21059)
  })

  it('attachWorkspace is idempotent', async () => {
    let subscribeCalls = 0
    contextVmServer.__setSubscribeForTests(() => {
      subscribeCalls++
      return { close: () => {} }
    })
    contextVmServer.__setRelayListLookupForTests(async () => ['wss://test'])

    contextVmServer.setPairedAgents('owner-pk', new Set(['agent-pk']))
    await contextVmServer.attachWorkspace('owner-pk')
    await contextVmServer.attachWorkspace('owner-pk')
    expect(subscribeCalls).toBe(1)
  })

  it('attachWorkspace is concurrency-safe — overlapping calls open one subscription', async () => {
    let subscribeCalls = 0
    contextVmServer.__setSubscribeForTests(() => {
      subscribeCalls++
      return { close: () => {} }
    })
    // Async relay lookup opens the race window between the subs check and
    // subs.set. Without the `attaching` guard both overlapping attaches would
    // pass the subs.has check and each open a subscription (duplicate inbound
    // processing). With it, the second call short-circuits.
    contextVmServer.__setRelayListLookupForTests(
      () => new Promise<string[]>((resolve) => setTimeout(() => resolve(['wss://test']), 5))
    )

    contextVmServer.setPairedAgents('owner-pk', new Set(['agent-pk']))
    await Promise.all([
      contextVmServer.attachWorkspace('owner-pk'),
      contextVmServer.attachWorkspace('owner-pk')
    ])

    expect(subscribeCalls).toBe(1)
  })

  it('detachWorkspace closes the subscription', async () => {
    let closed = false
    contextVmServer.__setSubscribeForTests(() => ({
      close: () => {
        closed = true
      }
    }))
    contextVmServer.__setRelayListLookupForTests(async () => ['wss://test'])

    contextVmServer.setPairedAgents('owner-pk', new Set(['agent-pk']))
    await contextVmServer.attachWorkspace('owner-pk')
    contextVmServer.detachWorkspace('owner-pk')
    expect(closed).toBe(true)
  })

  it('detachWorkspace is no-op when no sub exists', () => {
    expect(() => contextVmServer.detachWorkspace('never-attached')).not.toThrow()
  })

  it('attachWorkspace skips when no relays resolved', async () => {
    let subscribeCalls = 0
    contextVmServer.__setSubscribeForTests(() => {
      subscribeCalls++
      return { close: () => {} }
    })
    contextVmServer.__setRelayListLookupForTests(async () => [])

    contextVmServer.setPairedAgents('owner-pk', new Set(['agent-pk']))
    await contextVmServer.attachWorkspace('owner-pk')
    expect(subscribeCalls).toBe(0)
  })
})

describe('initialize response omits capability attestation', () => {
  beforeEach(() => {
    contextVmServer.__resetForTests()
  })

  it('does not embed an attestation in serverInfo._meta', async () => {
    const mockSigner = {
      getPublicKey: async () => 'owner-pubkey-hex',
      signEvent: async (e: any) => ({
        ...e,
        id: 'x',
        pubkey: 'owner-pubkey-hex',
        sig: 'sig-x'.repeat(8)
      })
    } as any
    contextVmServer.setDependencies({
      publishFn: async () => {},
      signerLookup: (pk) => (pk === 'owner-pubkey-hex' ? mockSigner : null),
      subscribeFn: () => ({ close: () => {} }),
      relayListLookup: async () => []
    })

    const response = await contextVmServer.__handleInitializeForTest(
      'owner-pubkey-hex',
      'agent-pubkey'
    )

    expect(response.result.serverInfo?._meta).toBeUndefined()
    expect(response.result.serverInfo.name).toBe('jank')
  })
})
