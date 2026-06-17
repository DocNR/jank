import { atom } from 'jotai'

/**
 * Mobile native push/pop navigation stack. Each in-feed drill-down (note
 * thread, profile, settings, ...) on mobile appends an entry here and renders
 * as a full-screen pushed screen instead of spawning a deck column. Back chevron
 * / hardware back / Overview pop or clear it. Desktop never uses this — it keeps
 * spawning transient columns. Ephemeral (not persisted).
 */
export type TMobileNavEntry = {
  /** Stable key for the layer (also the React key + slide-in animation reset). */
  id: string
  /** The pushed URL, dispatched against SECONDARY_ROUTES. */
  url: string
}

export const mobileNavStackAtom = atom<TMobileNavEntry[]>([])
