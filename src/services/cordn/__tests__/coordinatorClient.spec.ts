import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../context-vm-client.service', () => ({
  default: {
    callTool: vi.fn().mockResolvedValue({
      ok: true,
      structuredContent: { ok: true }
    })
  }
}))

import {
  publishKeyPackage,
  consumeKeyPackage,
  sendGroupMessage,
  fetchGroupMessages
} from '../coordinatorClient'
import contextVmClient from '../../context-vm-client.service'

const SIGNER_PUBKEY = 'signer-pubkey-aabbcc'

beforeEach(() => {
  vi.mocked(contextVmClient.callTool).mockClear()
})

describe('coordinatorClient (canonical Cordn wire)', () => {
  it('publishKeyPackage routes to PublishKeyPackage with snake_case args', async () => {
    await publishKeyPackage('coord-pubkey', SIGNER_PUBKEY, {
      kp_ref: 'ref-1',
      kp_64: 'base64-encoded-kp'
    })
    expect(contextVmClient.callTool).toHaveBeenCalledWith(
      'coord-pubkey',
      'PublishKeyPackage',
      { kp_ref: 'ref-1', kp_64: 'base64-encoded-kp' },
      expect.objectContaining({ signerPubkey: SIGNER_PUBKEY })
    )
  })

  it('consumeKeyPackage routes to ConsumeKeyPackage with { id }', async () => {
    await consumeKeyPackage('coord-pubkey', SIGNER_PUBKEY, { id: 'agent-pubkey' })
    expect(contextVmClient.callTool).toHaveBeenCalledWith(
      'coord-pubkey',
      'ConsumeKeyPackage',
      { id: 'agent-pubkey' },
      expect.objectContaining({ signerPubkey: SIGNER_PUBKEY })
    )
  })

  it('sendGroupMessage routes to PostGroupMessage with { msg_64 }', async () => {
    await sendGroupMessage('coord-pubkey', SIGNER_PUBKEY, { msg_64: 'b64ct' })
    expect(contextVmClient.callTool).toHaveBeenCalledWith(
      'coord-pubkey',
      'PostGroupMessage',
      { msg_64: 'b64ct' },
      expect.objectContaining({ signerPubkey: SIGNER_PUBKEY })
    )
  })

  it('fetchGroupMessages routes to FetchGroupMessages with { gid, after }', async () => {
    await fetchGroupMessages('coord-pubkey', SIGNER_PUBKEY, { gid: 'g1', after: 42 })
    expect(contextVmClient.callTool).toHaveBeenCalledWith(
      'coord-pubkey',
      'FetchGroupMessages',
      { gid: 'g1', after: 42 },
      expect.objectContaining({ signerPubkey: SIGNER_PUBKEY })
    )
  })

  it('fetchGroupMessages without after sends gid only', async () => {
    await fetchGroupMessages('coord-pubkey', SIGNER_PUBKEY, { gid: 'g1' })
    expect(contextVmClient.callTool).toHaveBeenCalledWith(
      'coord-pubkey',
      'FetchGroupMessages',
      { gid: 'g1' },
      expect.objectContaining({ signerPubkey: SIGNER_PUBKEY })
    )
  })
})
