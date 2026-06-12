import { Button } from '@/components/ui/button'
import storage from '@/services/local-storage.service'
import { Check, Copy } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  workspaceOwner: string
  onBack: () => void
  onDone: () => void
}

export default function Step2Configure({ workspaceOwner, onBack, onDone }: Props) {
  const { t } = useTranslation()
  const qrContainerRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const ownerNpub = useMemo(() => nip19.npubEncode(workspaceOwner), [workspaceOwner])

  const relays = useMemo(() => {
    const defaults = storage.getDefaultRelayUrls() ?? [
      'wss://relay.damus.io',
      'wss://nos.lol'
    ]
    return defaults.slice(0, 4).join(',')
  }, [])

  // Build the config snippet for the COPY block.
  //
  // The agent runtime discovers jank's tools via standard MCP `tools/list`
  // over its PRIVATE gift-wrapped ContextVM channel after it connects — that's
  // the same channel as `tools/call`, no public-relay broadcast. The opsec
  // concern in spec §17.1 (publicizing user's npub running jank) was about
  // CEP-6 announcements (public kinds 11316/11317), not about tools/list
  // (private RPC). We get tool discovery + opsec posture for free.
  //
  // Earlier drafts inlined the tool definitions in a fabricated `toolsInline`
  // field — but the MCP server config schema is `{ command, args, env, type,
  // url, headers }`; no agent runtime would honor a custom field. Removed.
  //
  // Actual ContextVM Proxy CLI args are placeholder pending impl verification.
  const snippet = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            jank: {
              command: 'contextvm-proxy',
              args: ['--server', ownerNpub, '--relays', relays]
            }
          }
        },
        null,
        2
      ),
    [ownerNpub, relays]
  )

  // QR encodes the same routing info as the copy snippet, JSON-compact (no
  // pretty-print). The copy snippet is the primary affordance (paste into
  // .mcp.json); the QR is for phone-hosted runtimes that scan rather than
  // paste. Both produce a working pairing.
  const qrData = useMemo(
    () =>
      JSON.stringify({
        server: ownerNpub,
        relays: relays.split(',')
      }),
    [ownerNpub, relays]
  )

  // QR rendering with SAFE DOM clearing (no innerHTML — XSS-hardened path).
  // qr-code-styling is loaded lazily (kept out of the initial bundle); it's only
  // needed when this pairing step is reached.
  useEffect(() => {
    const container = qrContainerRef.current
    if (!container) return

    let cancelled = false

    while (container.firstChild) {
      container.removeChild(container.firstChild)
    }

    void import('qr-code-styling').then(({ default: QRCodeStyling }) => {
      if (cancelled) return
      const qr = new QRCodeStyling({
        width: 200,
        height: 200,
        data: qrData,
        qrOptions: { errorCorrectionLevel: 'M' }
      })
      qr.append(container)
    })

    return () => {
      cancelled = true
      while (container.firstChild) {
        container.removeChild(container.firstChild)
      }
    }
  }, [qrData])

  const handleCopy = () => {
    void navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">{t("Paste this into your agent runtime's MCP config:")}</p>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
        <div className="bg-muted rounded p-3 min-w-0">
          <pre className="text-xs font-mono whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">{snippet}</pre>
          <Button size="sm" variant="ghost" onClick={handleCopy} className="mt-2">
            {copied ? (
              <Check className="size-3.5 me-1" />
            ) : (
              <Copy className="size-3.5 me-1" />
            )}
            {copied ? t('Copied') : t('Copy')}
          </Button>
        </div>
        <div ref={qrContainerRef} />
      </div>

      <p className="text-xs text-muted-foreground">
        {t("The exact CLI name (contextvm-proxy) may differ — check your runtime's docs.")}
      </p>

      <div className="flex justify-between gap-2 pt-2">
        <Button variant="ghost" onClick={onBack}>
          {t('Back')}
        </Button>
        <Button onClick={onDone}>{t('Done')}</Button>
      </div>
    </div>
  )
}
