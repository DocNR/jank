import { SecondaryPageLink } from '@/DeckManager'
import { ExtendedKind } from '@/constants'
import { useFetchRelayList } from '@/hooks'
import { useReplaceableEvent } from '@/hooks/useReplaceableEvent'
import { toRelay } from '@/lib/link'
import { simplifyUrl } from '@/lib/url'
import { Loader, Radio } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Profile relays tab. Shows two distinct, separately-labeled lists:
 *  - NIP-65 (kind 10002) Relay List Metadata — the user's read/write relays.
 *  - NIP-17 (kind 10050) preferred DM relays — where the user receives
 *    gift-wrapped DMs. An absent kind-10050 list means the user is not set up
 *    to receive NIP-17 DMs.
 * Each relay row links to spawn a Relay column. Read-only; no signer needed.
 *
 * min-h-screen on every state keeps the column body from collapsing when this
 * tab is short/loading (which would clamp scrollTop and jump up to the profile
 * banner — see ProfileFeed.snapToTabAnchor).
 */
export default function ProfileRelaysTab({ pubkey }: { pubkey: string }) {
  const { t } = useTranslation()
  const { relayList, isFetching } = useFetchRelayList(pubkey)
  const dmRelayEvent = useReplaceableEvent(pubkey, ExtendedKind.DM_RELAY_LIST)

  const dmRelays = useMemo(
    () =>
      (dmRelayEvent?.tags ?? [])
        .filter((tag) => tag[0] === 'relay' && !!tag[1])
        .map((tag) => tag[1]),
    [dmRelayEvent]
  )

  const hasNip65 = relayList.originalRelays.length > 0

  if (isFetching && !hasNip65 && !dmRelayEvent) {
    return (
      <div className="flex min-h-screen justify-center p-8">
        <Loader className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col gap-6 p-4">
      <section>
        <SectionHeader title={t('Relays')} spec="NIP-65" />
        {hasNip65 ? (
          <div className="flex flex-col gap-3">
            <RelaySection title={t('Read relays')} urls={relayList.read} />
            <RelaySection title={t('Write relays')} urls={relayList.write} />
          </div>
        ) : (
          <EmptyLine text={t('No relays published')} />
        )}
      </section>

      <section>
        <SectionHeader title={t('DM relays')} spec="NIP-17" />
        {dmRelays.length > 0 ? (
          <RelayRows urls={dmRelays} />
        ) : (
          <EmptyLine text={t('No DM relays set')} />
        )}
      </section>
    </div>
  )
}

function SectionHeader({ title, spec }: { title: string; spec: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <span className="text-muted-foreground bg-muted rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
        {spec}
      </span>
    </div>
  )
}

function RelaySection({ title, urls }: { title: string; urls: string[] }) {
  if (urls.length === 0) return null
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-xs font-semibold uppercase">{title}</div>
      <RelayRows urls={urls} />
    </div>
  )
}

function RelayRows({ urls }: { urls: string[] }) {
  return (
    <div className="flex flex-col">
      {urls.map((url) => (
        <SecondaryPageLink
          key={url}
          to={toRelay(url)}
          className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
        >
          <Radio className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate">{simplifyUrl(url)}</span>
        </SecondaryPageLink>
      ))}
    </div>
  )
}

function EmptyLine({ text }: { text: string }) {
  return <div className="text-muted-foreground px-2 py-1.5 text-sm">{text}</div>
}
