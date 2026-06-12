import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Lightweight markdown renderer for agent chat bubbles.
 *
 * Agents (OpenClaw assistants) reply in structured markdown — headings, bold,
 * lists, links. This renders that to formatted HTML so bubbles don't show raw
 * `**bold**` / `- bullet` markup.
 *
 * It deliberately does NOT reuse the heavyweight `MarkdownContent` component:
 * that one resolves nostr embeds, YouTube/X cards and an image lightbox, and
 * its link renderer depends on router/screen-size providers — too much for a
 * chat bubble (and it would auto-load arbitrary remote images). This wrapper
 * reuses the same underlying deps (`react-markdown` + `remark-gfm`) with a
 * constrained component map: text formatting + safe links only.
 *
 * Link safety: every link opens in a new tab with `rel="noopener noreferrer"`.
 * `nostr:` URIs are routed to njump.me so npub/note references stay clickable.
 * Images are rendered as a link to their source rather than loaded inline, so
 * an agent (or a spoofed message) can't trigger remote image fetches.
 */

const NJUMP_BASE = 'https://njump.me/'

/** Allow only safe URL schemes; convert `nostr:` refs to njump links. */
function transformAgentUrl(url: string): string {
  if (url.startsWith('nostr:')) {
    return `${NJUMP_BASE}${url.slice('nostr:'.length)}`
  }
  // Permit web + mail + in-message anchors/relative; strip anything else
  // (e.g. `javascript:`), which react-markdown would otherwise pass through.
  if (/^(https?:|mailto:|#|\/)/i.test(url)) {
    return url
  }
  return ''
}

function SafeLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  if (!href) return <>{children}</>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary break-words hover:underline"
    >
      {children}
    </a>
  )
}

const components: Components = {
  a: ({ href, children }) => <SafeLink href={href}>{children}</SafeLink>,
  // Images are not auto-loaded — surface the source as a safe link instead.
  img: ({ src, alt }) => (src ? <SafeLink href={src}>{alt || src}</SafeLink> : null),
  // Headings would be oversized inside a chat bubble — render as bold lines.
  h1: ({ children }) => <p className="font-semibold">{children}</p>,
  h2: ({ children }) => <p className="font-semibold">{children}</p>,
  h3: ({ children }) => <p className="font-semibold">{children}</p>,
  h4: ({ children }) => <p className="font-semibold">{children}</p>,
  h5: ({ children }) => <p className="font-semibold">{children}</p>,
  h6: ({ children }) => <p className="font-semibold">{children}</p>,
  ul: ({ children }) => <ul className="list-disc ps-5">{children}</ul>,
  ol: ({ children, start }) => (
    <ol className="list-decimal ps-5" start={start}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  pre: ({ children }) => (
    <pre className="bg-background/40 overflow-x-auto rounded-md p-2 text-xs">{children}</pre>
  ),
  code: ({ children, className }) => {
    if (className) {
      return <code className="whitespace-pre-wrap break-words">{children}</code>
    }
    return <code className="bg-background/40 rounded px-1 py-0.5 text-xs">{children}</code>
  },
  blockquote: ({ children }) => (
    <blockquote className="border-muted-foreground/30 text-muted-foreground border-s-2 ps-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-muted-foreground/30" />
}

export default function AgentMarkdown({ content }: { content: string }) {
  return (
    <div dir="auto" className="space-y-2 break-words [&_a]:underline-offset-2">
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={transformAgentUrl} components={components}>
        {content}
      </Markdown>
    </div>
  )
}
