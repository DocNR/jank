// src/hooks/useColumnVisible.ts
import { createContext, useContext } from 'react'

export const ColumnVisibilityContext = createContext<boolean>(true)

/**
 * Returns whether the enclosing <Column> is currently in the horizontal viewport.
 * Outside any Column, returns true (no-op default — keeps non-Column NoteList
 * consumers like ProfileFeed unaffected).
 */
export function useColumnVisible(): boolean {
  return useContext(ColumnVisibilityContext)
}
