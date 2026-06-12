// src/services/caches/private-tags-cache.service.ts
//
// Reactive decrypted-private-tags store for the two encrypted lists (Mute
// k10000, Pinned-users). Keyed on the AUTHOR pubkey. Decryption only runs when
// a signer for that author is registered (client.getSignerFor) — a foreign
// viewContext gets an empty private slice, never an invalid-MAC error. Plaintext
// is cached in indexedDb; NIP-04 → NIP-44 migration is signalled via wasNip04.
import { getReplaceableCoordinate } from '@/lib/event'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import { Event as NEvent } from 'nostr-tools'
import { z } from 'zod'

class PrivateTagsCacheService {
  private tagsMap = new Map<string, string[][]>()
  private subscribers = new Map<string, Set<() => void>>()

  subscribe(coordinate: string, callback: () => void) {
    let set = this.subscribers.get(coordinate)
    if (!set) {
      set = new Set()
      this.subscribers.set(coordinate, set)
    }
    set.add(callback)
    return () => {
      set?.delete(callback)
      if (set?.size === 0) this.subscribers.delete(coordinate)
    }
  }

  getSnapshot(coordinate: string): string[][] | undefined {
    return this.tagsMap.get(coordinate)
  }

  setOptimistic(coordinate: string, tags: string[][]) {
    this.tagsMap.set(coordinate, tags)
    this.notify(coordinate)
  }

  /**
   * Decrypt (or skip for foreign authors) and store. Returns wasNip04 so the
   * caller can trigger the existing NIP-04 → NIP-44 re-encryption migration.
   */
  async loadFor(event: NEvent): Promise<{ wasNip04: boolean }> {
    const coordinate = getReplaceableCoordinate(event.kind, event.pubkey)
    const signer = client.getSignerFor(event.pubkey)
    if (!event.content || !signer) {
      this.set(coordinate, [])
      return { wasNip04: false }
    }
    try {
      const wasNip04 = event.content.includes('?iv=')
      const stored = await indexedDb.getDecryptedContent(event.id)
      let plain: string
      if (stored) {
        plain = stored
      } else {
        plain = wasNip04
          ? await signer.nip04Decrypt(event.pubkey, event.content)
          : await signer.nip44Decrypt(event.pubkey, event.content)
        await indexedDb.putDecryptedContent(event.id, plain)
      }
      this.set(coordinate, z.array(z.array(z.string())).parse(JSON.parse(plain)))
      return { wasNip04 }
    } catch (error) {
      console.error('[privateTagsCache] decrypt failed', error)
      this.set(coordinate, [])
      return { wasNip04: false }
    }
  }

  private set(coordinate: string, tags: string[][]) {
    this.tagsMap.set(coordinate, tags)
    this.notify(coordinate)
  }

  private notify(coordinate: string) {
    this.subscribers.get(coordinate)?.forEach((cb) => cb())
  }
}

const instance = new PrivateTagsCacheService()
export default instance
