import { BRAND } from '@/branding'
import { CODY_PUBKEY, UPSTREAM_DONATION_PUBKEY } from '@/constants'
import { getZapInfoFromEvent } from '@/lib/event-metadata'
import { getDefaultRelayUrls } from '@/lib/relay'
import { TProfile } from '@/types'
import { init, launchPaymentModal } from '@getalby/bitcoin-connect-react'
import { Invoice } from '@getalby/lightning-tools'
import { bech32 } from '@scure/base'
import { WebLNProvider } from '@webbtc/webln-types'
import dayjs from 'dayjs'
import { Filter, kinds, NostrEvent } from 'nostr-tools'
import { SubCloser } from 'nostr-tools/abstract-pool'
import { makeZapRequest } from 'nostr-tools/nip57'
import { utf8Decoder } from 'nostr-tools/utils'
import eventCache from './caches/event-cache.service'
import client from './client.service'
import profileFetcher from './profile-fetcher.service'
import relayListService from './fetchers/relay-list.service'

export type TRecentSupporter = { pubkey: string; amount: number; comment?: string }

const OFFICIAL_PUBKEYS = [UPSTREAM_DONATION_PUBKEY, CODY_PUBKEY]

class LightningService {
  static instance: LightningService
  provider: WebLNProvider | null = null
  private recentSupportersCache: TRecentSupporter[] | null = null

  constructor() {
    if (!LightningService.instance) {
      LightningService.instance = this
      init({
        appName: BRAND.name,
        showBalance: false
      })
    }
    return LightningService.instance
  }

  async zap(
    sender: string,
    recipientOrEvent: string | NostrEvent,
    sats: number,
    comment: string,
    closeOuterModel?: () => void
  ): Promise<{ preimage: string; invoice: string } | null> {
    if (!sender) {
      throw new Error('You need to be logged in to zap')
    }
    // Pre-check the per-account signer registry. Surfaces a clean user-facing
    // error before client.signAs's descriptive throw (which leaks the pubkey
    // hex into the toast). Hits the rare unpair-mid-zap path; the normal flow
    // has the signer registered.
    if (!client.getSignerFor(sender)) {
      throw new Error('Could not sign zap request — sender account signer unavailable')
    }
    const { recipient, event } =
      typeof recipientOrEvent === 'string'
        ? { recipient: recipientOrEvent }
        : { recipient: recipientOrEvent.pubkey, event: recipientOrEvent }

    const [profile, receiptRelayList, senderRelayList] = await Promise.all([
      profileFetcher.fetchProfile(recipient),
      relayListService.fetchRelayList(recipient),
      sender
        ? relayListService.fetchRelayList(sender)
        : Promise.resolve({ read: getDefaultRelayUrls(), write: getDefaultRelayUrls() })
    ])
    if (!profile) {
      throw new Error('Recipient not found')
    }
    const zapEndpoint = await this.getZapEndpoint(profile)
    if (!zapEndpoint) {
      throw new Error("Recipient's lightning address is invalid")
    }
    const { callback, lnurl } = zapEndpoint
    const amount = sats * 1000
    const zapRequestDraft = makeZapRequest({
      ...(event ? { event } : { pubkey: recipient }),
      amount,
      relays: receiptRelayList.read
        .slice(0, 4)
        .concat(senderRelayList.write.slice(0, 3))
        .concat(getDefaultRelayUrls()),
      comment
    })
    // NIP-57 §A "SHOULD" — lets receipt validators recompute the callback
    // (§F's lnurl check). makeZapRequest already emits `k` for events.
    zapRequestDraft.tags.push(['lnurl', lnurl])
    // Sign the kind-9734 zap request as the column's account (NIP-57
    // requires event.pubkey === sender; verified by the receipt's embedded
    // description tag), not the active singleton.
    const zapRequest = await client.signAs(sender, zapRequestDraft)

    const zapRequestUrl = new URL(callback)
    zapRequestUrl.searchParams.append('amount', amount.toString())
    zapRequestUrl.searchParams.append('nostr', JSON.stringify(zapRequest))
    zapRequestUrl.searchParams.append('lnurl', lnurl)

    const zapRequestRes = await fetch(zapRequestUrl.toString())
    const zapRequestResBody = await zapRequestRes.json()
    if (zapRequestResBody.error) {
      throw new Error(zapRequestResBody.message)
    }
    const { pr, verify, reason } = zapRequestResBody
    if (!pr) {
      throw new Error(reason ?? 'Failed to create invoice')
    }

    if (this.provider) {
      const { preimage } = await this.provider.sendPayment(pr)
      closeOuterModel?.()
      return { preimage, invoice: pr }
    }

    return new Promise((resolve) => {
      closeOuterModel?.()
      let checkPaymentInterval: ReturnType<typeof setInterval> | undefined
      let subCloser: SubCloser | undefined
      const { setPaid } = launchPaymentModal({
        invoice: pr,
        onPaid: (response) => {
          clearInterval(checkPaymentInterval)
          subCloser?.close()
          resolve({ preimage: response.preimage, invoice: pr })
        },
        onCancelled: () => {
          clearInterval(checkPaymentInterval)
          subCloser?.close()
          resolve(null)
        }
      })

      if (verify) {
        checkPaymentInterval = setInterval(async () => {
          const invoice = new Invoice({ pr, verify })
          const paid = await invoice.verifyPayment()

          if (paid && invoice.preimage) {
            setPaid({
              preimage: invoice.preimage
            })
          }
        }, 1000)
      } else {
        const filter: Filter = {
          kinds: [kinds.Zap],
          '#p': [recipient],
          since: dayjs().subtract(1, 'minute').unix()
        }
        if (event) {
          filter['#e'] = [event.id]
        }
        subCloser = client.subscribe(
          senderRelayList.write.concat(getDefaultRelayUrls()).slice(0, 4),
          filter,
          {
            onevent: (evt) => {
              const info = getZapInfoFromEvent(evt)
              if (!info) return

              if (info.invoice === pr) {
                setPaid({ preimage: info.preimage ?? '' })
              }
            }
          }
        )
      }
    })
  }

  async payInvoice(
    invoice: string,
    closeOuterModel?: () => void,
    options?: {
      /**
       * Receives the Bitcoin Connect payment modal's setPaid handle (only
       * when the modal is used, i.e. no WebLN provider). The modal cannot
       * detect external-wallet payments itself; an out-of-band confirmation
       * (e.g. a CLINK payment receipt) can call setPaid to flip it to its
       * success screen, which also resolves this promise via onPaid.
       */
      onModalLaunched?: (handles: {
        setPaid: (response: { preimage: string }) => void
      }) => void
    }
  ): Promise<{ preimage: string; invoice: string } | null> {
    if (this.provider) {
      const { preimage } = await this.provider.sendPayment(invoice)
      closeOuterModel?.()
      return { preimage, invoice: invoice }
    }

    return new Promise((resolve) => {
      closeOuterModel?.()
      const { setPaid } = launchPaymentModal({
        invoice: invoice,
        onPaid: (response) => {
          resolve({ preimage: response.preimage, invoice: invoice })
        },
        onCancelled: () => {
          resolve(null)
        }
      })
      options?.onModalLaunched?.({ setPaid })
    })
  }

  async fetchRecentSupporters() {
    if (this.recentSupportersCache) {
      return this.recentSupportersCache
    }
    const relayList = await relayListService.fetchRelayList(CODY_PUBKEY)
    const events = await eventCache.fetchEvents(relayList.read.slice(0, 4), {
      authors: ['79f00d3f5a19ec806189fcab03c1be4ff81d18ee4f653c88fac41fe03570f432'], // alby
      kinds: [kinds.Zap],
      '#p': OFFICIAL_PUBKEYS,
      since: dayjs().subtract(1, 'month').unix()
    })
    events.sort((a, b) => b.created_at - a.created_at)
    const map = new Map<string, { pubkey: string; amount: number; comment?: string }>()
    events.forEach((event) => {
      const info = getZapInfoFromEvent(event)
      if (!info || !info.senderPubkey || OFFICIAL_PUBKEYS.includes(info.senderPubkey)) return

      const { amount, comment, senderPubkey } = info
      const item = map.get(senderPubkey)
      if (!item) {
        map.set(senderPubkey, { pubkey: senderPubkey, amount, comment })
      } else {
        item.amount += amount
        if (!item.comment && comment) item.comment = comment
      }
    })
    this.recentSupportersCache = Array.from(map.values())
      .filter((item) => item.amount >= 1000)
      .sort((a, b) => b.amount - a.amount)
    return this.recentSupportersCache
  }

  private async getZapEndpoint(profile: TProfile): Promise<null | {
    callback: string
    lnurl: string
  }> {
    try {
      let lnurl: string = ''

      // Some clients have incorrectly filled in the positions for lud06 and lud16
      if (!profile.lightningAddress) {
        console.warn('Profile has no lightning address', profile)
        return null
      }

      if (profile.lightningAddress.includes('@')) {
        const [name, domain] = profile.lightningAddress.split('@')
        lnurl = new URL(`/.well-known/lnurlp/${name}`, `https://${domain}`).toString()
      } else {
        const { words } = bech32.decode(profile.lightningAddress as any, 1000)
        const data = bech32.fromWords(words)
        lnurl = utf8Decoder.decode(data)
      }

      const res = await fetch(lnurl)
      const body = await res.json()

      console.log('Zap endpoint:', body)
      if (body.allowsNostr !== false && body.callback) {
        return {
          callback: body.callback,
          lnurl
        }
      }
    } catch (err) {
      console.error(err)
    }

    return null
  }
}

const instance = new LightningService()
export default instance
