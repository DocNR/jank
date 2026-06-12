// Jotai atomFamily for per-pubkey trust-compute state. Lets badges + popovers
// subscribe to a specific pubkey's compute state without re-rendering on
// every other pubkey's transitions. Matches the notification-read atom
// pattern (see src/atoms/notification-read.ts).

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

export type TComputeState = 'idle' | 'pending' | 'failed'

/**
 * Returns an atom for the compute state of a specific pubkey. Default 'idle'.
 * Atom family caches one atom per pubkey; JS GC reclaims unused atoms when
 * no subscribers remain.
 */
export const relatrComputeStateAtomFamily = atomFamily((_pubkey: string) =>
  atom<TComputeState>('idle')
)
