import { ExtendedKind } from '@/constants'
import { getReplaceableCoordinateFromEvent, isReplaceableEvent } from '@/lib/event'
import { tagNameEquals } from '@/lib/tag'
import { TRelayInfo } from '@/types'
import dayjs from 'dayjs'
import { Event, Filter, kinds, matchFilter } from 'nostr-tools'

type TValue<T = any> = {
  key: string
  value: T | null
  addedAt: number
}

// v23: Cordn agent drawer — MLS group state + per-group fetch cursors.

export interface MlsStateRecord {
  groupId: string
  ownerPubkey: string // which paired account owns this MLS leaf
  stateB64: string // base64-encoded ts-mls group state
  updatedAt: number
}

export interface CursorRecord {
  groupId: string
  cursor: string // opaque pagination cursor for the next Cordn fetch
  updatedAt: number
}

const StoreNames = {
  PROFILE_EVENTS: 'profileEvents',
  RELAY_LIST_EVENTS: 'relayListEvents',
  FOLLOW_LIST_EVENTS: 'followListEvents',
  MUTE_LIST_EVENTS: 'muteListEvents',
  BOOKMARK_LIST_EVENTS: 'bookmarkListEvents',
  BLOSSOM_SERVER_LIST_EVENTS: 'blossomServerListEvents',
  USER_EMOJI_LIST_EVENTS: 'userEmojiListEvents',
  EMOJI_SET_EVENTS: 'emojiSetEvents',
  PIN_LIST_EVENTS: 'pinListEvents',
  FAVORITE_RELAYS: 'favoriteRelays',
  RELAY_SETS: 'relaySets',
  FOLLOWING_FAVORITE_RELAYS: 'followingFavoriteRelays',
  RELAY_INFOS: 'relayInfos',
  DECRYPTED_CONTENTS: 'decryptedContents',
  PINNED_USERS_EVENTS: 'pinnedUsersEvents',
  EVENTS: 'events',
  RELATR_TRUST: 'relatrTrust',
  RELATR_TRUST_COMPONENTS: 'relatrTrustComponents',
  RELATR_METADATA: 'relatrMetadata',
  MLS_STATE: 'mls_state',
  CORDN_GROUP_CURSORS: 'cordn_group_cursors',
  DM_MESSAGES: 'dmMessages',
  DM_SYNC_STATE: 'dmSyncState',
  MUTE_DECRYPTED_TAGS: 'muteDecryptedTags', // deprecated
  RELAY_INFO_EVENTS: 'relayInfoEvents' // deprecated
}

class IndexedDbService {
  static instance: IndexedDbService
  static getInstance(): IndexedDbService {
    if (!IndexedDbService.instance) {
      IndexedDbService.instance = new IndexedDbService()
      IndexedDbService.instance.init()
    }
    return IndexedDbService.instance
  }

  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null

  init(): Promise<void> {
    if (!this.initPromise) {
      // No-op when IndexedDB is unavailable (happy-dom test env, SSR).
      // Consumer methods already guard on `this.db === null`.
      if (typeof window === 'undefined' || !window.indexedDB) {
        this.initPromise = Promise.resolve()
        return this.initPromise
      }
      this.initPromise = new Promise((resolve, reject) => {
        const request = window.indexedDB.open('jumble', 25) // v25: NIP-17 DM stores (dmMessages + dmSyncState)

        request.onerror = (event) => {
          reject(event)
        }

        request.onsuccess = () => {
          this.db = request.result
          resolve()
        }

        request.onupgradeneeded = (event) => {
          const db = request.result
          const oldVersion = (event as IDBVersionChangeEvent).oldVersion
          if (!db.objectStoreNames.contains(StoreNames.PROFILE_EVENTS)) {
            db.createObjectStore(StoreNames.PROFILE_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELAY_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.RELAY_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.FOLLOW_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.FOLLOW_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.MUTE_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.MUTE_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.BOOKMARK_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.BOOKMARK_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.DECRYPTED_CONTENTS)) {
            db.createObjectStore(StoreNames.DECRYPTED_CONTENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.FAVORITE_RELAYS)) {
            db.createObjectStore(StoreNames.FAVORITE_RELAYS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELAY_SETS)) {
            db.createObjectStore(StoreNames.RELAY_SETS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.FOLLOWING_FAVORITE_RELAYS)) {
            db.createObjectStore(StoreNames.FOLLOWING_FAVORITE_RELAYS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.BLOSSOM_SERVER_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.BLOSSOM_SERVER_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.USER_EMOJI_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.USER_EMOJI_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.EMOJI_SET_EVENTS)) {
            db.createObjectStore(StoreNames.EMOJI_SET_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELAY_INFOS)) {
            db.createObjectStore(StoreNames.RELAY_INFOS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.PIN_LIST_EVENTS)) {
            db.createObjectStore(StoreNames.PIN_LIST_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.PINNED_USERS_EVENTS)) {
            db.createObjectStore(StoreNames.PINNED_USERS_EVENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.EVENTS)) {
            const feedEventsStore = db.createObjectStore(StoreNames.EVENTS, {
              keyPath: 'event.id'
            })
            feedEventsStore.createIndex('createdAtIndex', 'event.created_at')
            // v24: coordinate index for addressable events (e.g. kind:30023
            // articles) that have no dedicated per-kind store. Records carry a
            // `coord` (kind:pubkey:d) only when replaceable; non-replaceable
            // notes have no `coord` and are simply absent from this index.
            feedEventsStore.createIndex('coordinateIndex', 'coord')
          }
          // v22: Path B — Relatr trust swap. Three new stores keyed by pubkey.
          if (!db.objectStoreNames.contains(StoreNames.RELATR_TRUST)) {
            db.createObjectStore(StoreNames.RELATR_TRUST, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELATR_TRUST_COMPONENTS)) {
            db.createObjectStore(StoreNames.RELATR_TRUST_COMPONENTS, { keyPath: 'key' })
          }
          if (!db.objectStoreNames.contains(StoreNames.RELATR_METADATA)) {
            db.createObjectStore(StoreNames.RELATR_METADATA, { keyPath: 'key' })
          }
          if (db.objectStoreNames.contains(StoreNames.RELAY_INFO_EVENTS)) {
            db.deleteObjectStore(StoreNames.RELAY_INFO_EVENTS)
          }
          if (db.objectStoreNames.contains(StoreNames.MUTE_DECRYPTED_TAGS)) {
            db.deleteObjectStore(StoreNames.MUTE_DECRYPTED_TAGS)
          }

          // v23: Track B Feature 2 — Cordn agent drawer. MLS group state + per-group fetch cursors.
          if (oldVersion < 23) {
            db.createObjectStore(StoreNames.MLS_STATE, { keyPath: 'groupId' })
            db.createObjectStore(StoreNames.CORDN_GROUP_CURSORS, { keyPath: 'groupId' })
          }

          // v24: add the coordinate index to an EXISTING events store (fresh
          // installs get it in the create block above). Lets the Bookmarks
          // column resolve a-tag (addressable) bookmarks locally instead of
          // depending on a relay round-trip.
          if (oldVersion > 0 && oldVersion < 24 && db.objectStoreNames.contains(StoreNames.EVENTS)) {
            const eventsStore = request.transaction!.objectStore(StoreNames.EVENTS)
            if (!eventsStore.indexNames.contains('coordinateIndex')) {
              eventsStore.createIndex('coordinateIndex', 'coord')
            }
          }

          // v21: DM feature removed. Drop the four DM-related stores so
          // existing users' browsers reclaim the space on next load.
          // (Hardcoded names — the StoreNames entries themselves were dropped
          // alongside the deletion.) Fresh installs skip this branch.
          if (oldVersion > 0 && oldVersion < 21) {
            if (db.objectStoreNames.contains('dmConversations')) {
              db.deleteObjectStore('dmConversations')
            }
            if (db.objectStoreNames.contains('dmMessages')) {
              db.deleteObjectStore('dmMessages')
            }
            if (db.objectStoreNames.contains('dmRelaysEvents')) {
              db.deleteObjectStore('dmRelaysEvents')
            }
            if (db.objectStoreNames.contains('encryptionKeyAnnouncementEvents')) {
              db.deleteObjectStore('encryptionKeyAnnouncementEvents')
            }
            window.localStorage.removeItem('dmDeletedConversationsMap')
          }

          // v25: NIP-17 DM stores — created LAST so a prior (oldVersion < 21) deletion of
          // an old, differently-shaped `dmMessages` store cannot clobber these.
          if (!db.objectStoreNames.contains(StoreNames.DM_MESSAGES)) {
            const dmMessages = db.createObjectStore(StoreNames.DM_MESSAGES, { keyPath: 'wrapId' })
            dmMessages.createIndex('byAccountAndCreatedAt', ['account', 'createdAt'])
            dmMessages.createIndex('byAccountAndCounterparty', ['account', 'counterparty'])
          }
          if (!db.objectStoreNames.contains(StoreNames.DM_SYNC_STATE)) {
            db.createObjectStore(StoreNames.DM_SYNC_STATE, { keyPath: 'account' })
          }

          this.db = db
        }
      })
      setTimeout(() => {
        this.cleanUpOldEvents()
        this.cleanUp()
      }, 1000 * 30) // 30 seconds after initialization
    }
    return this.initPromise
  }

  async putNullReplaceableEvent(pubkey: string, kind: number, d?: string) {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) {
      return Promise.reject('store name not found')
    }
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)

      const key = this.getReplaceableEventKey(pubkey, d)
      const getRequest = store.get(key)
      getRequest.onsuccess = () => {
        const oldValue = getRequest.result as TValue<Event> | undefined
        if (oldValue) {
          transaction.commit()
          return resolve(oldValue.value)
        }
        const putRequest = store.put(this.formatValue(key, null))
        putRequest.onsuccess = () => {
          transaction.commit()
          resolve(null)
        }

        putRequest.onerror = (event) => {
          transaction.commit()
          reject(event)
        }
      }

      getRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putReplaceableEvent(event: Event): Promise<Event> {
    const storeName = this.getStoreNameByKind(event.kind)
    if (!storeName) {
      return Promise.reject('store name not found')
    }
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)

      const key = this.getReplaceableEventKeyFromEvent(event)
      const getRequest = store.get(key)
      getRequest.onsuccess = () => {
        const oldValue = getRequest.result as TValue<Event> | undefined
        if (oldValue?.value && oldValue.value.created_at >= event.created_at) {
          transaction.commit()
          return resolve(oldValue.value)
        }
        const putRequest = store.put(this.formatValue(key, event))
        putRequest.onsuccess = () => {
          transaction.commit()
          resolve(event)
        }

        putRequest.onerror = (event) => {
          transaction.commit()
          reject(event)
        }
      }

      getRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getReplaceableEventByCoordinate(coordinate: string): Promise<Event | undefined | null> {
    const [kind, pubkey, ...rest] = coordinate.split(':')
    const d = rest.length > 0 ? rest.join(':') : undefined
    return this.getReplaceableEvent(pubkey, parseInt(kind), d)
  }

  async getReplaceableEvent(
    pubkey: string,
    kind: number,
    d?: string
  ): Promise<Event | undefined | null> {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) {
      return undefined
    }
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const key = this.getReplaceableEventKey(pubkey, d)
      const request = store.get(key)

      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<Event>)?.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getManyReplaceableEvents(
    pubkeys: readonly string[],
    kind: number
  ): Promise<(Event | undefined | null)[]> {
    const storeName = this.getStoreNameByKind(kind)
    if (!storeName) {
      return Promise.reject('store name not found')
    }
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(storeName, 'readonly')
      const store = transaction.objectStore(storeName)
      const events: (Event | null)[] = new Array(pubkeys.length).fill(undefined)
      let count = 0
      pubkeys.forEach((pubkey, i) => {
        const request = store.get(this.getReplaceableEventKey(pubkey))

        request.onsuccess = () => {
          const event = (request.result as TValue<Event | null>)?.value
          if (event || event === null) {
            events[i] = event
          }

          if (++count === pubkeys.length) {
            transaction.commit()
            resolve(events)
          }
        }

        request.onerror = () => {
          if (++count === pubkeys.length) {
            transaction.commit()
            resolve(events)
          }
        }
      })
    })
  }

  async getDecryptedContent(key: string): Promise<string | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(StoreNames.DECRYPTED_CONTENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.DECRYPTED_CONTENTS)
      const request = store.get(key)

      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<string>)?.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putDecryptedContent(key: string, content: string): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(StoreNames.DECRYPTED_CONTENTS, 'readwrite')
      const store = transaction.objectStore(StoreNames.DECRYPTED_CONTENTS)

      const putRequest = store.put(this.formatValue(key, content))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async iterateProfileEvents(callback: (event: Event) => Promise<void>): Promise<void> {
    await this.initPromise
    if (!this.db) {
      return
    }

    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.PROFILE_EVENTS, 'readwrite')
      const store = transaction.objectStore(StoreNames.PROFILE_EVENTS)
      const request = store.openCursor()
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const value = (cursor.value as TValue<Event>).value
          if (value) {
            callback(value)
          }
          cursor.continue()
        } else {
          transaction.commit()
          resolve()
        }
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putFollowingFavoriteRelays(pubkey: string, relays: [string, string[]][]): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(StoreNames.FOLLOWING_FAVORITE_RELAYS, 'readwrite')
      const store = transaction.objectStore(StoreNames.FOLLOWING_FAVORITE_RELAYS)

      const putRequest = store.put(this.formatValue(pubkey, relays))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getFollowingFavoriteRelays(pubkey: string): Promise<[string, string[]][] | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(StoreNames.FOLLOWING_FAVORITE_RELAYS, 'readonly')
      const store = transaction.objectStore(StoreNames.FOLLOWING_FAVORITE_RELAYS)
      const request = store.get(pubkey)

      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<[string, string[]][]>)?.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putRelayInfo(relayInfo: TRelayInfo): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(StoreNames.RELAY_INFOS, 'readwrite')
      const store = transaction.objectStore(StoreNames.RELAY_INFOS)

      const putRequest = store.put(this.formatValue(relayInfo.url, relayInfo))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }

      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getRelayInfo(url: string): Promise<TRelayInfo | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(StoreNames.RELAY_INFOS, 'readonly')
      const store = transaction.objectStore(StoreNames.RELAY_INFOS)
      const request = store.get(url)

      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<TRelayInfo>)?.value)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putEvents(items: { event: Event; relays: string[] }[]): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(StoreNames.EVENTS, 'readwrite')
      const store = transaction.objectStore(StoreNames.EVENTS)

      let completed = 0
      items.forEach((item) => {
        if (isReplaceableEvent(item.event.kind)) {
          // Replaceable events with a dedicated per-kind store (Profile,
          // RelayList, Contacts, BookmarkList, etc.) are saved via
          // putReplaceableEvent elsewhere; skip them here to avoid double-
          // storage. Replaceable events with NO dedicated store (e.g.
          // kind:30023 LongFormArticle, kind:30311 LiveEvent) fall through
          // and land in the events store — better to over-store than to
          // silently drop, since the timeline-cache replay relies on them
          // being persisted somewhere when needSaveToDb is true.
          if (this.getStoreNameByKind(item.event.kind)) {
            return
          }
          // Tag with the replaceable coordinate so the v24 coordinateIndex can
          // resolve it (the Bookmarks column looks up addressable bookmarks by
          // coordinate). Non-replaceable notes get no `coord` and stay out of
          // the index.
          ;(item as { coord?: string }).coord = getReplaceableCoordinateFromEvent(item.event)
        }
        const putRequest = store.put(item)
        putRequest.onsuccess = () => {
          completed++
          if (completed === items.length) {
            transaction.commit()
            resolve()
          }
        }

        putRequest.onerror = (event) => {
          transaction.commit()
          reject(event)
        }
      })
    })
  }

  async getEvents({ limit, ...filter }: Filter): Promise<{ event: Event; relays: string[] }[]> {
    await this.initPromise
    if (!this.db) {
      throw new Error('database not initialized')
    }
    const transaction = this.db.transaction(StoreNames.EVENTS, 'readonly')
    const store = transaction.objectStore(StoreNames.EVENTS)

    // Fast path for ids-bounded queries (e.g. Bookmarks column passing
    // `{ids:[...]}`): primary-key lookups are O(1) each, vs the cursor scan
    // below which walks the entire createdAtIndex. With ~3k cached events
    // and 60 bookmark ids on cold start this saved ~1.5s of cursor walk
    // contention (the timeline-cache subscribe and the profile fetcher both
    // open their own IDB transactions, queueing behind the cursor sweep).
    // Other filter fields (kinds, authors, etc.) are still applied via
    // matchFilter on the looked-up items.
    if (filter.ids && filter.ids.length > 0) {
      const items = await Promise.all(
        filter.ids.map(
          (id) =>
            new Promise<{ event: Event; relays: string[] } | undefined>((res, rej) => {
              const r = store.get(id)
              // The events store uses keyPath: 'event.id' and stores
              // `{event, relays}` records directly (no `.value` wrapper unlike
              // the per-list-event stores which use the {key, value} envelope
              // via formatValue). Use r.result as-is when present.
              r.onsuccess = () =>
                res(r.result ? (r.result as { event: Event; relays: string[] }) : undefined)
              r.onerror = (e) => rej(e)
            })
        )
      )
      transaction.commit()
      const results = items
        .filter((it): it is { event: Event; relays: string[] } => !!it)
        .filter((it) => matchFilter(filter, it.event))
      // Same created_at-desc ordering the cursor path would produce, so
      // downstream merge logic (timeline-cache.getEventsFromIndexed,
      // NoteList processEvents) stays equivalent.
      results.sort((a, b) => b.event.created_at - a.event.created_at)
      return limit ? results.slice(0, limit) : results
    }

    return new Promise((resolve, reject) => {
      const index = store.index('createdAtIndex')
      const request = index.openCursor(null, 'prev')

      const results: { event: Event; relays: string[] }[] = []
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor && (!limit || results.length < limit)) {
          const item = cursor.value as { event: Event; relays: string[] }
          if (matchFilter(filter, item.event)) {
            results.push(item)
          }
          cursor.continue()
        } else {
          transaction.commit()
          resolve(results)
        }
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getEventById(id: string): Promise<{ event: Event; relays: string[] } | undefined> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject('database not initialized')
      }
      const transaction = this.db.transaction(StoreNames.EVENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.EVENTS)
      const request = store.get(id)

      request.onsuccess = () => {
        transaction.commit()
        resolve(request.result as { event: Event; relays: string[] } | undefined)
      }

      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  /**
   * Resolve replaceable events by their NIP-33 coordinate (`kind:pubkey:d`)
   * via the v24 coordinateIndex. Returns the latest version per coordinate
   * (multiple cached versions of an edited article share a coordinate). Used
   * by the Bookmarks column to resolve a-tag (addressable) bookmarks locally
   * instead of round-tripping a relay. Reads records directly ({event, relays,
   * coord}); the events store is keyed by event.id with no {key,value} wrapper.
   */
  async getEventsByCoordinates(coordinates: string[]): Promise<Event[]> {
    await this.initPromise
    if (!this.db || coordinates.length === 0) return []
    const db = this.db
    const unique = Array.from(new Set(coordinates))
    return new Promise((resolve) => {
      const transaction = db.transaction(StoreNames.EVENTS, 'readonly')
      const index = transaction.objectStore(StoreNames.EVENTS).index('coordinateIndex')
      const out: Event[] = []
      let pending = unique.length
      const done = () => {
        if (--pending <= 0) {
          transaction.commit()
          resolve(out)
        }
      }
      unique.forEach((coord) => {
        const req = index.getAll(coord)
        req.onsuccess = () => {
          const records = (req.result || []) as { event: Event }[]
          if (records.length) {
            records.sort((a, b) => b.event.created_at - a.event.created_at)
            out.push(records[0].event)
          }
          done()
        }
        req.onerror = () => done()
      })
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // Path B (v22): Relatr trust caches
  // ────────────────────────────────────────────────────────────────────────

  async putRelatrTrust(
    pubkey: string,
    value: { rank: number | null; computedAt: number }
  ): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const transaction = this.db.transaction(StoreNames.RELATR_TRUST, 'readwrite')
      const store = transaction.objectStore(StoreNames.RELATR_TRUST)
      const putRequest = store.put(this.formatValue(pubkey, value))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getRelatrTrust(
    pubkey: string
  ): Promise<{ rank: number | null; computedAt: number } | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const transaction = this.db.transaction(StoreNames.RELATR_TRUST, 'readonly')
      const store = transaction.objectStore(StoreNames.RELATR_TRUST)
      const request = store.get(pubkey)
      request.onsuccess = () => {
        transaction.commit()
        resolve(
          (request.result as TValue<{ rank: number | null; computedAt: number }>)?.value ?? null
        )
      }
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async iterateRelatrTrust(
    callback: (pubkey: string, value: { rank: number | null; computedAt: number }) => void
  ): Promise<void> {
    await this.initPromise
    if (!this.db) return
    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(StoreNames.RELATR_TRUST, 'readonly')
      const store = transaction.objectStore(StoreNames.RELATR_TRUST)
      const request = store.openCursor()
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const stored = cursor.value as TValue<{ rank: number | null; computedAt: number }>
          if (stored?.value) callback(stored.key, stored.value)
          cursor.continue()
        } else {
          transaction.commit()
          resolve()
        }
      }
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putRelatrTrustComponents<T>(pubkey: string, value: T): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const transaction = this.db.transaction(StoreNames.RELATR_TRUST_COMPONENTS, 'readwrite')
      const store = transaction.objectStore(StoreNames.RELATR_TRUST_COMPONENTS)
      const putRequest = store.put(this.formatValue(pubkey, value))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getRelatrTrustComponents<T>(pubkey: string): Promise<T | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const transaction = this.db.transaction(StoreNames.RELATR_TRUST_COMPONENTS, 'readonly')
      const store = transaction.objectStore(StoreNames.RELATR_TRUST_COMPONENTS)
      const request = store.get(pubkey)
      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<T>)?.value ?? null)
      }
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putRelatrMetadata<T>(key: string, value: T): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const transaction = this.db.transaction(StoreNames.RELATR_METADATA, 'readwrite')
      const store = transaction.objectStore(StoreNames.RELATR_METADATA)
      const putRequest = store.put(this.formatValue(key, value))
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getRelatrMetadata<T>(key: string): Promise<T | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const transaction = this.db.transaction(StoreNames.RELATR_METADATA, 'readonly')
      const store = transaction.objectStore(StoreNames.RELATR_METADATA)
      const request = store.get(key)
      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as TValue<T>)?.value ?? null)
      }
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  // ────────────────────────────────────────────────────────────────────────
  // v23: Track B Feature 2 — Cordn MLS state + per-group cursors
  // ────────────────────────────────────────────────────────────────────────

  async putMlsState(record: MlsStateRecord): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const transaction = this.db.transaction(StoreNames.MLS_STATE, 'readwrite')
      const store = transaction.objectStore(StoreNames.MLS_STATE)
      const putRequest = store.put({ ...record, updatedAt: Date.now() })
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getMlsState(groupId: string): Promise<MlsStateRecord | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const transaction = this.db.transaction(StoreNames.MLS_STATE, 'readonly')
      const store = transaction.objectStore(StoreNames.MLS_STATE)
      const request = store.get(groupId)
      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as MlsStateRecord) ?? null)
      }
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putCursor(record: CursorRecord): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const transaction = this.db.transaction(StoreNames.CORDN_GROUP_CURSORS, 'readwrite')
      const store = transaction.objectStore(StoreNames.CORDN_GROUP_CURSORS)
      const putRequest = store.put({ ...record, updatedAt: Date.now() })
      putRequest.onsuccess = () => {
        transaction.commit()
        resolve()
      }
      putRequest.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async getCursor(groupId: string): Promise<string | null> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const transaction = this.db.transaction(StoreNames.CORDN_GROUP_CURSORS, 'readonly')
      const store = transaction.objectStore(StoreNames.CORDN_GROUP_CURSORS)
      const request = store.get(groupId)
      request.onsuccess = () => {
        transaction.commit()
        resolve((request.result as CursorRecord)?.cursor ?? null)
      }
      request.onerror = (event) => {
        transaction.commit()
        reject(event)
      }
    })
  }

  async putDmMessages(
    items: {
      wrapId: string
      account: string
      counterparty: string
      fromPubkey: string
      content: string
      createdAt: number
      rumorId: string
    }[]
  ): Promise<void> {
    if (!items.length) return
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const tx = this.db.transaction(StoreNames.DM_MESSAGES, 'readwrite')
      const store = tx.objectStore(StoreNames.DM_MESSAGES)
      for (const it of items) store.put(it)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  async getDmMessages(
    account: string,
    opts: { since?: number; until?: number; limit?: number } = {}
  ): Promise<
    {
      wrapId: string
      account: string
      counterparty: string
      fromPubkey: string
      content: string
      createdAt: number
      rumorId: string
    }[]
  > {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const tx = this.db.transaction(StoreNames.DM_MESSAGES, 'readonly')
      const index = tx.objectStore(StoreNames.DM_MESSAGES).index('byAccountAndCreatedAt')
      const lower: [string, number] = [account, opts.since ?? 0]
      const upper: [string, number] = [account, opts.until ?? Number.MAX_SAFE_INTEGER]
      const range = IDBKeyRange.bound(lower, upper)
      const out: {
        wrapId: string
        account: string
        counterparty: string
        fromPubkey: string
        content: string
        createdAt: number
        rumorId: string
      }[] = []
      const req = index.openCursor(range, 'prev') // newest first
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor || (opts.limit !== undefined && out.length >= opts.limit)) {
          resolve(out)
          return
        }
        out.push(cursor.value)
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
  }

  async getDmSyncState(
    account: string
  ): Promise<
    | { account: string; oldestFetched: number; newestFetched: number; processedWrapIds: string[] }
    | undefined
  > {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const tx = this.db.transaction(StoreNames.DM_SYNC_STATE, 'readonly')
      const req = tx.objectStore(StoreNames.DM_SYNC_STATE).get(account)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async putDmSyncState(state: {
    account: string
    oldestFetched: number
    newestFetched: number
    processedWrapIds: string[]
  }): Promise<void> {
    await this.initPromise
    return new Promise((resolve, reject) => {
      if (!this.db) return reject('database not initialized')
      const tx = this.db.transaction(StoreNames.DM_SYNC_STATE, 'readwrite')
      tx.objectStore(StoreNames.DM_SYNC_STATE).put(state)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  private getReplaceableEventKeyFromEvent(event: Event): string {
    if (
      [kinds.Metadata, kinds.Contacts].includes(event.kind) ||
      (event.kind >= 10000 && event.kind < 20000)
    ) {
      return this.getReplaceableEventKey(event.pubkey)
    }

    const [, d] = event.tags.find(tagNameEquals('d')) ?? []
    return this.getReplaceableEventKey(event.pubkey, d)
  }

  private getReplaceableEventKey(pubkey: string, d?: string): string {
    return d === undefined ? pubkey : `${pubkey}:${d}`
  }

  private getStoreNameByKind(kind: number): string | undefined {
    switch (kind) {
      case kinds.Metadata:
        return StoreNames.PROFILE_EVENTS
      case kinds.RelayList:
        return StoreNames.RELAY_LIST_EVENTS
      case kinds.Contacts:
        return StoreNames.FOLLOW_LIST_EVENTS
      case kinds.Mutelist:
        return StoreNames.MUTE_LIST_EVENTS
      case ExtendedKind.BLOSSOM_SERVER_LIST:
        return StoreNames.BLOSSOM_SERVER_LIST_EVENTS
      case kinds.Relaysets:
        return StoreNames.RELAY_SETS
      case ExtendedKind.FAVORITE_RELAYS:
        return StoreNames.FAVORITE_RELAYS
      case kinds.BookmarkList:
        return StoreNames.BOOKMARK_LIST_EVENTS
      case kinds.UserEmojiList:
        return StoreNames.USER_EMOJI_LIST_EVENTS
      case kinds.Emojisets:
        return StoreNames.EMOJI_SET_EVENTS
      case kinds.Pinlist:
        return StoreNames.PIN_LIST_EVENTS
      case ExtendedKind.PINNED_USERS:
        return StoreNames.PINNED_USERS_EVENTS
      default:
        return undefined
    }
  }

  private formatValue<T>(key: string, value: T): TValue<T> {
    return {
      key,
      value,
      addedAt: Date.now()
    }
  }

  private async cleanUp() {
    await this.initPromise
    if (!this.db) {
      return
    }

    const stores = [
      {
        name: StoreNames.PROFILE_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 30 // 30 day
      },
      {
        name: StoreNames.RELAY_LIST_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 30 // 30 day
      },
      {
        name: StoreNames.FOLLOW_LIST_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 30 // 30 day
      },
      {
        name: StoreNames.BLOSSOM_SERVER_LIST_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 30 // 30 day
      },
      {
        name: StoreNames.RELAY_INFOS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 30 // 30 day
      },
      {
        name: StoreNames.PIN_LIST_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 30 // 30 days
      },
      {
        name: StoreNames.USER_EMOJI_LIST_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 7 // 7 days
      },
      {
        name: StoreNames.EMOJI_SET_EVENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 7 // 7 days
      },
      // v22 — Path B 3-day TTL on Relatr-derived caches.
      {
        name: StoreNames.RELATR_TRUST,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 3 // 3 days
      },
      {
        name: StoreNames.RELATR_TRUST_COMPONENTS,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 3 // 3 days
      },
      {
        name: StoreNames.RELATR_METADATA,
        expirationTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 3 // 3 days
      }
    ]
    const transaction = this.db!.transaction(
      stores.map((store) => store.name),
      'readwrite'
    )
    await Promise.allSettled(
      stores.map(({ name, expirationTimestamp }) => {
        if (expirationTimestamp < 0) {
          return Promise.resolve()
        }
        return new Promise<void>((resolve, reject) => {
          const store = transaction.objectStore(name)
          const request = store.openCursor()
          request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest).result
            if (cursor) {
              const value: TValue = cursor.value
              if (value.addedAt < expirationTimestamp) {
                cursor.delete()
              }
              cursor.continue()
            } else {
              resolve()
            }
          }

          request.onerror = (event) => {
            reject(event)
          }
        })
      })
    )
  }

  private async cleanUpOldEvents() {
    await this.initPromise
    if (!this.db) {
      return
    }

    // Collect protected references first (events referenced by any user's
    // kind-10003 bookmark list). The events store has a 5-day TTL by default;
    // without this guard the Bookmarks column would find nothing cached for
    // any bookmark older than 5 days (the common case — users bookmark older
    // posts they want to keep), forcing a relay round-trip every reload.
    // `ids` protects e-tag (note) bookmarks by exact id; `coords` protects
    // a-tag (addressable, e.g. kind:30023 article) bookmarks by replaceable
    // coordinate via the v24 coordinateIndex, so saved articles persist too.
    const { ids: protectedIds, coords: protectedCoords } =
      await this.collectBookmarkProtection()

    const transaction = this.db!.transaction(StoreNames.EVENTS, 'readwrite')
    const store = transaction.objectStore(StoreNames.EVENTS)
    const index = store.index('createdAtIndex')
    const request = index.openCursor(IDBKeyRange.upperBound(dayjs().subtract(5, 'days').unix()))

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result
      if (cursor) {
        const item = cursor.value as { event: Event; relays: string[]; coord?: string }
        const protectedById = protectedIds.has(item.event.id)
        const protectedByCoord =
          protectedCoords.size > 0 &&
          isReplaceableEvent(item.event.kind) &&
          protectedCoords.has(item.coord ?? getReplaceableCoordinateFromEvent(item.event))
        if (!protectedById && !protectedByCoord) {
          cursor.delete()
        }
        cursor.continue()
      } else {
        transaction.commit()
      }
    }

    request.onerror = (event) => {
      transaction.commit()
      console.error('Failed to clean up old events:', event)
    }
  }

  /**
   * Collect the references held by any cached kind-10003 bookmark list (one per
   * paired pubkey), split into:
   *  - `ids`: e-tag event ids (non-replaceable bookmarks — notes, etc.)
   *  - `coords`: a-tag replaceable coordinates (`kind:pubkey:d`) for addressable
   *    bookmarks (kind:30023 articles, etc.) that land in the events store
   *    because they have no dedicated per-kind store.
   *
   * Used by cleanUpOldEvents to skip eviction for bookmarked events regardless
   * of age.
   */
  private async collectBookmarkProtection(): Promise<{
    ids: Set<string>
    coords: Set<string>
  }> {
    const ids = new Set<string>()
    const coords = new Set<string>()
    if (!this.db) return { ids, coords }
    return new Promise((resolve) => {
      const tx = this.db!.transaction(StoreNames.BOOKMARK_LIST_EVENTS, 'readonly')
      const store = tx.objectStore(StoreNames.BOOKMARK_LIST_EVENTS)
      const req = store.openCursor()
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest).result
        if (cursor) {
          const wrapper = cursor.value as { value: Event | null }
          const bmEvent = wrapper?.value
          if (bmEvent && Array.isArray(bmEvent.tags)) {
            for (const tag of bmEvent.tags) {
              if (typeof tag[1] !== 'string' || tag[1].length === 0) continue
              if (tag[0] === 'e') ids.add(tag[1])
              else if (tag[0] === 'a') coords.add(tag[1])
            }
          }
          cursor.continue()
        } else {
          tx.commit()
          resolve({ ids, coords })
        }
      }
      req.onerror = () => {
        // Best-effort: on error, fall back to no protection (existing behavior).
        tx.commit()
        resolve({ ids, coords })
      }
    })
  }
}

const instance = IndexedDbService.getInstance()
export default instance
