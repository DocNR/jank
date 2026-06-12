import { createDeletionRequestDraftEvent } from '@/lib/draft-event'
import { isProtectedEvent, minePow } from '@/lib/event'
import seenOnService from '@/services/caches/seen-on.service'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import profileFetcher from '@/services/profile-fetcher.service'
import { ISigner, TAccountPointer, TDraftEvent, TProfile, TPublishOptions } from '@/types'
import dayjs from 'dayjs'
import { Event, kinds, VerifiedEvent } from 'nostr-tools'

type Translate = (key: string, options?: Record<string, unknown>) => string

// --- Sign / publish primitives -------------------------------------------------

export async function signEvent(signer: ISigner, draftEvent: TDraftEvent): Promise<VerifiedEvent> {
  const event = await signer.signEvent(draftEvent)
  if (!event) {
    throw new Error('sign event failed')
  }
  return event as VerifiedEvent
}

export async function publish(opts: {
  account: TAccountPointer
  signer: ISigner
  profile: TProfile | null
  draftEvent: TDraftEvent
  options?: TPublishOptions
  t: Translate
}): Promise<Event> {
  const { account, signer, profile, draftEvent, options = {}, t } = opts
  const { minPow = 0, ...rest } = options

  const draft = JSON.parse(JSON.stringify(draftEvent)) as TDraftEvent
  let event: VerifiedEvent
  if (minPow > 0) {
    const unsignedEvent = await minePow({ ...draft, pubkey: account.pubkey }, minPow)
    event = await signEvent(signer, unsignedEvent)
  } else {
    event = await signEvent(signer, draft)
  }

  if (event.kind !== kinds.Application && event.pubkey !== account.pubkey) {
    const eventAuthor = await profileFetcher.fetchProfile(event.pubkey)
    const result = confirm(
      t(
        'You are about to publish an event signed by [{{eventAuthorName}}]. You are currently logged in as [{{currentUsername}}]. Are you sure?',
        { eventAuthorName: eventAuthor?.username, currentUsername: profile?.username }
      )
    )
    if (!result) {
      throw new Error(t('Cancelled'))
    }
  }

  const relays = await client.determineTargetRelays(event, rest)
  await client.publishEvent(relays, event)
  return event
}

export async function attemptDelete(opts: {
  signer: ISigner
  account: TAccountPointer
  targetEvent: Event
  addDeletedEvent: (e: Event) => void
  t: Translate
}): Promise<{ relayCount: number }> {
  const { signer, account, targetEvent, addDeletedEvent, t } = opts
  if (account.pubkey !== targetEvent.pubkey) {
    throw new Error(t('You can only delete your own notes'))
  }

  const deletionRequest = await signEvent(signer, createDeletionRequestDraftEvent(targetEvent))

  const seenOnUrls = seenOnService.getSeenEventRelayUrls(targetEvent.id)
  const relays = await client.determineTargetRelays(targetEvent, {
    specifiedRelayUrls: isProtectedEvent(targetEvent) ? seenOnUrls : undefined,
    additionalRelayUrls: seenOnUrls
  })

  await client.publishEvent(relays, deletionRequest)
  addDeletedEvent(targetEvent)
  return { relayCount: relays.length }
}

export async function signHttpAuth(
  signer: ISigner,
  url: string,
  method: string,
  content = ''
): Promise<string> {
  const event = await signEvent(signer, {
    content,
    kind: kinds.HTTPAuth,
    created_at: dayjs().unix(),
    tags: [
      ['u', url],
      ['method', method]
    ]
  })
  return 'Nostr ' + btoa(JSON.stringify(event))
}

// --- Persist-replaceable-event helpers ----------------------------------------
// Each takes the event and returns the persisted version (or null if a newer
// version already exists in IndexedDB). NostrProvider's wrapper handles the
// setState calls; these helpers stay free of React state.

export async function persistFavoriteRelaysEvent(event: Event): Promise<Event | null> {
  const persisted = await indexedDb.putReplaceableEvent(event)
  if (persisted.id !== event.id) return null
  return persisted
}

export async function persistUserEmojiListEvent(event: Event): Promise<Event | null> {
  const persisted = await indexedDb.putReplaceableEvent(event)
  if (persisted.id !== event.id) return null
  return persisted
}

