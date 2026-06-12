import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@/services/chat-substrate'
import AgentMarkdown from '../AgentMarkdown'
import MessageBubble from '@/components/chat/MessageBubble'

const OWNER = 'a'.repeat(64)
const AGENT = 'b'.repeat(64)

/** Render a bubble with the same renderBody the AgentDrawer passes in prod. */
function render(message: ChatMessage): string {
  return renderToStaticMarkup(
    createElement(MessageBubble, {
      message,
      ownerPubkey: OWNER,
      renderBody: (text: string) => createElement(AgentMarkdown, { content: text })
    })
  )
}

const agentMsg = (text: string): ChatMessage => ({
  id: 'in-1',
  fromPubkey: AGENT,
  text,
  createdAt: 0
})

const ownerMsg = (text: string): ChatMessage => ({
  id: 'out-1',
  fromPubkey: OWNER,
  text,
  createdAt: 0
})

describe('MessageBubble — agent markdown rendering', () => {
  it('renders an agent markdown heading as a bold element, not raw ## markup', () => {
    const html = render(agentMsg('## The Fishcake'))
    expect(html).toContain('The Fishcake')
    expect(html).not.toContain('## The Fishcake')
    expect(html).toMatch(/font-(bold|semibold)/)
  })

  it('renders agent bold + bullet list as HTML, not raw ** / - markup', () => {
    const html = render(agentMsg('Summary:\n\n**Strong point**\n\n- first item\n- second item'))
    expect(html).toContain('<strong>Strong point</strong>')
    expect(html).toContain('<ul')
    expect(html).toContain('<li>first item</li>')
    expect(html).toContain('<li>second item</li>')
    expect(html).not.toContain('**Strong point**')
  })

  it('renders agent links with target=_blank and rel=noopener noreferrer', () => {
    const html = render(agentMsg('Docs at https://example.com/guide'))
    expect(html).toContain('href="https://example.com/guide"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('does not auto-load remote images for agent markdown', () => {
    const html = render(agentMsg('![cat](https://example.com/cat.png)'))
    // No <img> tag — image src should surface as a safe link instead.
    expect(html).not.toContain('<img')
    expect(html).toContain('href="https://example.com/cat.png"')
  })

  it('renders an owner (user) message as plaintext, not markdown', () => {
    const html = render(ownerMsg('**not bold** and ## not a heading'))
    expect(html).toContain('**not bold** and ## not a heading')
    expect(html).not.toContain('<strong>')
  })

  it('keeps dir="auto" on the agent message content', () => {
    const html = render(agentMsg('hello'))
    expect(html).toContain('dir="auto"')
  })
})
