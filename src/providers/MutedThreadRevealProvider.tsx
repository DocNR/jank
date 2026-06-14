import { createContext, ReactNode, useContext, useMemo, useState } from 'react'

type TMutedThreadReveal = {
  /** Thread ROOT ids revealed within this column. */
  revealed: Set<string>
  /** Reveal a muted thread (by its root id) for this column. */
  reveal: (rootId: string) => void
}

const MutedThreadRevealContext = createContext<TMutedThreadReveal | null>(null)

/**
 * Per-column reveal state for muted threads. Mounted once inside every
 * <Column>, so the reveal is scoped to that column's lifetime:
 *
 * - A muted thread opens COLLAPSED ("Reveal muted thread").
 * - Clicking reveal adds the thread root here; the `Note` collapse (root +
 *   parent notes) and the reply filters (useFilteredReplies /
 *   useFilteredAllReplies) both read it, so one click reveals the whole
 *   conversation — note AND replies — together.
 * - CLOSING the column drops this state. Reopening the thread starts collapsed
 *   again, because the thread is still muted. This keeps "reveal" (a temporary
 *   peek) visually distinct from "unmute" (permanent).
 *
 * Not persisted; not shared across columns. Threads stay muted in feeds /
 * notifications regardless.
 */
export function MutedThreadRevealProvider({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set())
  const value = useMemo<TMutedThreadReveal>(
    () => ({
      revealed,
      reveal: (rootId: string) =>
        setRevealed((prev) => {
          if (prev.has(rootId)) return prev
          const next = new Set(prev)
          next.add(rootId)
          return next
        })
    }),
    [revealed]
  )
  return (
    <MutedThreadRevealContext.Provider value={value}>{children}</MutedThreadRevealContext.Provider>
  )
}

// Stable empty fallback for notes rendered outside any column (e.g. tests).
const EMPTY: TMutedThreadReveal = { revealed: new Set(), reveal: () => {} }

export function useMutedThreadReveal(): TMutedThreadReveal {
  return useContext(MutedThreadRevealContext) ?? EMPTY
}
