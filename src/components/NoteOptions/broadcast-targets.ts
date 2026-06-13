import { TRelaySet } from '@/types'

/**
 * A single republish target shown under the "Republish to ..." menu item.
 *
 * `optimal` republishes via `client.determineTargetRelays(event)`, which is
 * driven entirely by the event (its author's write relays + mentioned users'
 * read relays). It therefore works for ANY note, not just your own — so it is
 * the dependable fallback that keeps the submenu from ever being empty when a
 * user is signed in but has no favorite relays or relay sets configured.
 */
export type TBroadcastTarget =
  | { kind: 'optimal'; separator: boolean }
  | { kind: 'relaySet'; name: string; relayUrls: string[]; separator: boolean }
  | { kind: 'relay'; url: string; separator: boolean }

/**
 * Compute the ordered list of republish targets for a note.
 *
 * In jank's deck model nothing populates `CurrentRelaysProvider` (the upstream
 * Jumble pages that called `addRelayUrls` live in the retired secondary route
 * stack), so `relayUrls` is usually just the user's favorite relays. Without
 * the `optimal` fallback, viewing a foreign note while having no favorite
 * relays / relay sets produced an empty submenu — the reported blank menu.
 */
export function computeBroadcastTargets({
  signedIn,
  relaySets,
  relayUrls
}: {
  signedIn: boolean
  relaySets: TRelaySet[]
  relayUrls: string[]
}): TBroadcastTarget[] {
  const targets: TBroadcastTarget[] = []

  if (signedIn) {
    targets.push({ kind: 'optimal', separator: false })
  }

  relaySets
    .filter((set) => set.relayUrls.length)
    .forEach((set, index) => {
      targets.push({
        kind: 'relaySet',
        name: set.name,
        relayUrls: set.relayUrls,
        separator: index === 0
      })
    })

  relayUrls.forEach((url, index) => {
    targets.push({ kind: 'relay', url, separator: index === 0 })
  })

  return targets
}
