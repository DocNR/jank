// Ephemeral optimistic overlay for the five user-lists. Holds an in-flight
// optimistic event per coordinate while a mutation publishes. NEVER persisted
// and NEVER written into replaceableEventCache — so anything reading the
// canonical cache (profiles, naddr resolution, the AI agent) only ever sees
// real signed events. Lifecycle: setOptimistic on mutate → clear on settle.
import { Event as NEvent } from 'nostr-tools'

class ListOverlayService {
  private overlayMap = new Map<string, NEvent>()
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

  getSnapshot(coordinate: string): NEvent | undefined {
    return this.overlayMap.get(coordinate)
  }

  setOptimistic(coordinate: string, event: NEvent) {
    this.overlayMap.set(coordinate, event)
    this.notify(coordinate)
  }

  clear(coordinate: string) {
    if (this.overlayMap.delete(coordinate)) {
      this.notify(coordinate)
    }
  }

  private notify(coordinate: string) {
    this.subscribers.get(coordinate)?.forEach((cb) => cb())
  }
}

const instance = new ListOverlayService()
export default instance
