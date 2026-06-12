import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFetchProfile } from '@/hooks'
import { decodeNoffer, NofferPriceType, TNoffer } from '@/lib/clink'
import { formatAmount, getAmountFromInvoice } from '@/lib/lightning'
import { formatPubkey } from '@/lib/pubkey'
import { cn } from '@/lib/utils'
import clink, { isClinkFailure, TClinkFailure } from '@/services/clink.service'
import lightning from '@/services/lightning.service'
import { Check, Loader, Zap } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

type TStatus = 'idle' | 'fetching' | 'confirm' | 'paying' | 'paid'

/**
 * Who gets paid: the strongest identity signal available. A kind-0 name when
 * the service key has one (most Lightning.Pub node keys don't), always
 * anchored by the non-spoofable short npub + relay host.
 */
function ServiceIdentityLine({ pubkey, relayHost }: { pubkey: string; relayHost: string }) {
  const { profile } = useFetchProfile(pubkey)
  const realName = profile?.original_username
  return (
    <div className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
      {realName && (
        <span dir="auto" className="max-w-32 truncate font-medium">
          {realName}
        </span>
      )}
      <span className="truncate">
        {formatPubkey(pubkey)} · {relayHost}
      </span>
    </div>
  )
}

export function EmbeddedNoffer({ noffer, className }: { noffer: string; className?: string }) {
  const { t } = useTranslation()
  const initialOffer = useMemo(() => decodeNoffer(noffer), [noffer])
  const [offer, setOffer] = useState(initialOffer)
  const [status, setStatus] = useState<TStatus>('idle')
  const [amountInput, setAmountInput] = useState(() =>
    initialOffer?.priceType !== NofferPriceType.Fixed && initialOffer?.price
      ? String(initialOffer.price)
      : ''
  )
  const [error, setError] = useState<string | null>(null)
  const [movedTo, setMovedTo] = useState<TNoffer | null>(null)
  const [pendingBolt11, setPendingBolt11] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const modalSetPaidRef = useRef<((response: { preimage: string }) => void) | null>(null)

  // Cards live in virtua-virtualized rows: scrolling away unmounts them.
  // Abort the round trip so no payment modal pops after the card is gone.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  if (!offer) {
    // Undecodable strings render as plain text — never a broken card
    return <span className="text-muted-foreground wrap-break-word">{noffer}</span>
  }

  const relayHost = (() => {
    try {
      return new URL(offer.relay).host
    } catch {
      return offer.relay
    }
  })()

  const failureMessage = (failure: TClinkFailure): string => {
    switch (failure.reason) {
      case 'connect':
        return t('Could not reach the payment service')
      case 'publish':
        return t('The payment relay rejected the request')
      case 'timeout':
        return t('No response from the payment service')
      case 'service':
        switch (failure.code) {
          case 1:
            return t('This offer is no longer valid')
          case 2:
            return t('The service is temporarily unavailable')
          case 3:
            return t('This offer has expired')
          case 4:
            return t('The service does not support this request')
          case 5: {
            const range =
              failure.range?.min !== undefined && failure.range?.max !== undefined
                ? ` (${failure.range.min} - ${failure.range.max} ${t('sats')})`
                : ''
            return t('Invalid amount') + range
          }
          default:
            return t('Lightning payment failed')
        }
      default:
        return t('Lightning payment failed')
    }
  }

  const pay = async (bolt11: string) => {
    setStatus('paying')
    try {
      const result = await lightning.payInvoice(bolt11, undefined, {
        onModalLaunched: ({ setPaid }) => {
          modalSetPaidRef.current = setPaid
        }
      })
      // A connected wallet hands back the preimage — definitive. An external
      // wallet (QR scan) resolves null here when the modal closes; the CLINK
      // payment receipt (onPaid) is what confirms those — never downgrade a
      // receipt-confirmed 'paid' back to idle.
      setStatus((prev) => (prev === 'paid' || result ? 'paid' : 'idle'))
    } catch (err) {
      toast.error(t('Lightning payment failed') + ': ' + (err as Error).message)
      setStatus((prev) => (prev === 'paid' ? 'paid' : 'idle'))
    } finally {
      modalSetPaidRef.current = null
    }
  }

  const handleRequest = async () => {
    setError(null)
    setMovedTo(null)

    let amountSats: number | undefined
    if (offer.priceType !== NofferPriceType.Fixed) {
      amountSats = parseInt(amountInput, 10)
      if (!Number.isInteger(amountSats) || amountSats < 1) {
        setError(t('Invalid amount'))
        return
      }
    }

    setStatus('fetching')
    const controller = new AbortController()
    abortRef.current = controller
    const result = await clink.fetchInvoice(offer, {
      amountSats,
      signal: controller.signal,
      onPaid: () => {
        setStatus('paid')
        // The Bitcoin Connect modal can't see external-wallet payments — it
        // would keep showing "Waiting for payment" after the service already
        // confirmed settlement. Flip it to its success screen (the user
        // dismisses it from there; abruptly closing it dropped people back
        // into a busy column with no confirmation). The CLINK receipt
        // carries no preimage — the payer's wallet already has it.
        try {
          modalSetPaidRef.current?.({ preimage: '' })
        } catch {
          // modal already closed
        }
      }
    })

    if (isClinkFailure(result)) {
      if (result.reason === 'aborted') {
        // Unmounted or superseded — nothing to show
        return
      }
      if (result.code === 3 && result.latest) {
        const latest = decodeNoffer(result.latest)
        if (latest) {
          setMovedTo(latest)
          setStatus('idle')
          return
        }
      }
      setError(failureMessage(result))
      setStatus('idle')
      return
    }

    const invoiceAmount = getAmountFromInvoice(result.bolt11)
    if (offer.priceType === NofferPriceType.Variable) {
      // The sat amount is the service's conversion — show it before paying
      if (invoiceAmount < 1) {
        setError(t('The service returned an invalid invoice'))
        setStatus('idle')
        return
      }
      setPendingBolt11(result.bolt11)
      setStatus('confirm')
      return
    }

    // Fixed/spontaneous: the advertised or entered amount is a commitment —
    // refuse an invoice that contradicts it
    const expected = offer.priceType === NofferPriceType.Fixed ? offer.price : amountSats
    if (invoiceAmount !== expected) {
      setError(t('The service returned an invalid invoice'))
      setStatus('idle')
      return
    }
    await pay(result.bolt11)
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
  }

  const busy = status === 'fetching' || status === 'paying'
  const identityChanged = movedTo !== null && movedTo.pubkey !== offer.pubkey

  return (
    <div
      className={cn('flex max-w-sm cursor-default flex-col gap-3 rounded-lg border p-3', className)}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2">
        <Zap className="h-5 w-5 text-yellow-400" />
        <div className="text-sm font-semibold">{t('Lightning Offer')}</div>
      </div>

      <ServiceIdentityLine pubkey={offer.pubkey} relayHost={relayHost} />

      {offer.priceType === NofferPriceType.Fixed ? (
        <div className="text-lg font-bold">
          {formatAmount(offer.price ?? 0)} {t('sats')}
        </div>
      ) : status !== 'confirm' && status !== 'paid' ? (
        <div className="flex flex-col gap-1">
          {offer.priceType === NofferPriceType.Variable && (
            <div className="text-muted-foreground text-sm">
              {offer.price !== undefined && offer.currency
                ? `${offer.price} ${offer.currency}`
                : t('Price set by service')}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              placeholder={t('Amount in sats')}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={busy}
              className="h-9"
            />
            <span className="text-muted-foreground text-sm">{t('sats')}</span>
          </div>
        </div>
      ) : null}

      {status === 'paid' ? (
        <div className="flex items-center gap-2 font-semibold text-green-500">
          <Check className="h-5 w-5" />
          {t('Paid')}
        </div>
      ) : status === 'confirm' && pendingBolt11 ? (
        <>
          <div className="text-lg font-bold">
            {formatAmount(getAmountFromInvoice(pendingBolt11))} {t('sats')}
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => pay(pendingBolt11)}>
              {t('Pay')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setPendingBolt11(null)
                setStatus('idle')
              }}
            >
              {t('Cancel')}
            </Button>
          </div>
        </>
      ) : movedTo ? (
        <div className="flex flex-col gap-2">
          <div className="text-muted-foreground text-sm">
            {t('The offer was updated by the service')}
          </div>
          {identityChanged && (
            <div className="text-destructive text-sm">{t('The service identity changed')}</div>
          )}
          <Button
            variant="outline"
            onClick={() => {
              setOffer(movedTo)
              setMovedTo(null)
              setError(null)
              if (movedTo.priceType !== NofferPriceType.Fixed && movedTo.price) {
                setAmountInput(String(movedTo.price))
              }
            }}
          >
            {t('Use updated offer')}
          </Button>
        </div>
      ) : (
        <Button onClick={handleRequest} disabled={busy}>
          {busy && <Loader className="h-4 w-4 animate-spin" />}
          {status === 'fetching' ? t('Requesting invoice...') : t('Pay')}
        </Button>
      )}

      {error && <div className="text-destructive text-sm">{error}</div>}
    </div>
  )
}
