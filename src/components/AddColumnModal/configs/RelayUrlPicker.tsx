// src/components/AddColumnModal/configs/RelayUrlPicker.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useNostr } from '@/providers/NostrProvider'
import relayListService from '@/services/fetchers/relay-list.service'
import { TRelayList } from '@/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigFormProps } from '../column-types'

const FALLBACK_URL = 'wss://relay.damus.io'
const CUSTOM_SENTINEL = '__custom__'

function isValidRelayUrl(s: string): boolean {
  if (!s.startsWith('wss://') && !s.startsWith('ws://')) return false
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

export default function RelayUrlPicker({
  draft,
  onChange,
  account,
  isCustom,
  setIsCustom
}: ConfigFormProps) {
  const { t } = useTranslation()
  const { account: activeAccount, relayList: activeRelayList } = useNostr()
  const [otherRelayList, setOtherRelayList] = useState<TRelayList | null>(null)
  const [customDraft, setCustomDraft] = useState<string>(draft.config?.relayUrl ?? '')
  const [customError, setCustomError] = useState<string | null>(null)

  // Resolve the relay list for the selected account: use useNostr() if active; else fetch.
  const isActive = account?.pubkey && activeAccount?.pubkey === account.pubkey
  const relayList = isActive ? activeRelayList : otherRelayList

  // Mirror isCustom into a ref so the async fetch's .then can read the *current*
  // value at promise-resolution time, not the value captured when the effect ran.
  // Prevents a stale-closure race: user enters custom mode + clears input while
  // a relay-list fetch is in flight; without this, the resolved fetch would
  // auto-populate the (now-cleared) URL and re-enable the Add button silently.
  const isCustomRef = useRef(isCustom)
  useEffect(() => {
    isCustomRef.current = isCustom
  }, [isCustom])

  useEffect(() => {
    if (!account) {
      setOtherRelayList(null)
      return
    }
    let cancelled = false
    const promise = isActive
      ? Promise.resolve(activeRelayList)
      : relayListService.fetchRelayList(account.pubkey)
    promise.then((rl) => {
      if (cancelled || !rl) return
      if (!isActive) setOtherRelayList(rl)
      // Auto-populate URL from the first read relay IF the user hasn't customized
      // and we don't already have a value (or the value is the fallback default).
      // Read isCustom via ref to avoid the stale-closure race when the user enters
      // custom mode while a fetch is in flight.
      if (!isCustomRef.current) {
        const current = draft.config?.relayUrl
        const isFallbackOrEmpty = !current || current === FALLBACK_URL
        if (isFallbackOrEmpty && rl.read.length > 0) {
          onChange({ ...draft, config: { ...draft.config, relayUrl: rl.read[0] } })
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [account, isActive, activeRelayList])

  // Build the dropdown options: union of read + write, deduped, in original order.
  const knownUrls = useMemo<string[]>(() => {
    if (!relayList) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const url of [...relayList.read, ...relayList.write]) {
      if (!seen.has(url)) {
        seen.add(url)
        out.push(url)
      }
    }
    return out
  }, [relayList])

  const showFallback = knownUrls.length === 0

  const currentValue = isCustom
    ? CUSTOM_SENTINEL
    : (draft.config?.relayUrl ?? (showFallback ? FALLBACK_URL : ''))

  const handleSelect = (v: string) => {
    if (v === CUSTOM_SENTINEL) {
      setIsCustom(true)
      setCustomDraft(draft.config?.relayUrl ?? '')
      setCustomError(null)
      return
    }
    setIsCustom(false)
    onChange({ ...draft, config: { ...draft.config, relayUrl: v } })
  }

  const handleCustomBlurOrType = (next: string) => {
    setCustomDraft(next)
    if (!next) {
      setCustomError(null)
      onChange({ ...draft, config: { ...draft.config, relayUrl: undefined } })
      return
    }
    if (isValidRelayUrl(next)) {
      setCustomError(null)
      onChange({ ...draft, config: { ...draft.config, relayUrl: next } })
    } else {
      setCustomError(t('Relay URL must start with wss:// or ws://'))
      onChange({ ...draft, config: { ...draft.config, relayUrl: undefined } })
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div className="text-muted-foreground w-20 shrink-0 text-xs font-medium">
          {t('Relay URL')}
        </div>
        {isCustom ? (
          <div className="flex flex-1 flex-col gap-1">
            <input
              type="text"
              value={customDraft}
              onChange={(e) => handleCustomBlurOrType(e.target.value)}
              placeholder="wss://example.com"
              className={[
                'bg-background flex-1 rounded-md border px-3 py-1.5 font-mono text-sm',
                customError ? 'border-destructive' : 'border-border'
              ].join(' ')}
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                setIsCustom(false)
                setCustomDraft('')
                setCustomError(null)
                onChange({ ...draft, config: { ...draft.config, relayUrl: undefined } })
              }}
              className="text-muted-foreground hover:text-foreground self-start text-xs underline-offset-2 hover:underline"
            >
              {t('Use a listed relay')}
            </button>
          </div>
        ) : (
          <Select value={currentValue} onValueChange={handleSelect}>
            <SelectTrigger className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {showFallback && (
                <SelectItem value={FALLBACK_URL}>
                  {FALLBACK_URL} ({t('Default relay')})
                </SelectItem>
              )}
              {knownUrls.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_SENTINEL}>{t('Custom URL…')}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      {customError && <div className="text-destructive ps-[5.5rem] text-xs">{customError}</div>}
    </div>
  )
}
