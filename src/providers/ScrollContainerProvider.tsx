import { createContext, ReactNode, RefObject, useContext } from 'react'

const ScrollContainerContext = createContext<RefObject<HTMLDivElement> | null>(null)

export function ScrollContainerProvider({
  scrollRef,
  children
}: {
  scrollRef: RefObject<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <ScrollContainerContext.Provider value={scrollRef}>{children}</ScrollContainerContext.Provider>
  )
}

/**
 * Returns the nearest enclosing scroll container ref, or null if rendered
 * outside any <ScrollContainerProvider>. Consumers should fall back to
 * window scroll when null.
 */
export function useScrollContainer(): RefObject<HTMLDivElement> | null {
  return useContext(ScrollContainerContext)
}
