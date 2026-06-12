import { describe, expect, it } from 'vitest'
import { groupConversations, type DmMessage } from './conversations'

function msg(p: Partial<DmMessage>): DmMessage {
  return {
    wrapId: Math.random().toString(36).slice(2),
    counterparty: 'bob',
    fromPubkey: 'bob',
    content: '',
    createdAt: 0,
    rumorId: 'r',
    ...p
  }
}

describe('groupConversations', () => {
  it('groups by counterparty, newest message wins as preview, sorted by recency desc', () => {
    const messages: DmMessage[] = [
      msg({ counterparty: 'bob', fromPubkey: 'bob', content: 'old', createdAt: 100 }),
      msg({ counterparty: 'bob', fromPubkey: 'me', content: 'new', createdAt: 300 }),
      msg({ counterparty: 'carol', fromPubkey: 'carol', content: 'mid', createdAt: 200 })
    ]
    const convos = groupConversations(messages)
    expect(convos.map((c) => c.counterparty)).toEqual(['bob', 'carol'])
    expect(convos[0].lastMessage.content).toBe('new')
    expect(convos[0].lastMessageAt).toBe(300)
    expect(convos[0].messageCount).toBe(2)
  })

  it('counts unread (inbound, createdAt > lastReadAt)', () => {
    const messages: DmMessage[] = [
      msg({ counterparty: 'bob', fromPubkey: 'bob', content: 'a', createdAt: 100 }),
      msg({ counterparty: 'bob', fromPubkey: 'bob', content: 'b', createdAt: 200 }),
      msg({ counterparty: 'bob', fromPubkey: 'me', content: 'c', createdAt: 300 })
    ]
    const convos = groupConversations(messages, { bob: 100 }, 'me')
    expect(convos[0].unread).toBe(1) // only the createdAt=200 inbound is unread
  })
})
