import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import storage from '@/services/local-storage.service'

type TKindFilterContext = {
  showKinds: number[]
  updateShowKinds: (kinds: number[]) => void
  getShowKinds: (feedId: string) => number[]
  updateShowKindsForFeed: (feedId: string, kinds: number[]) => void
  clearShowKindsForFeed: (feedId: string) => void
}

const KindFilterContext = createContext<TKindFilterContext | undefined>(undefined)

export const useKindFilter = () => {
  const context = useContext(KindFilterContext)
  if (!context) {
    throw new Error('useKindFilter must be used within a KindFilterProvider')
  }
  return context
}

export function KindFilterProvider({ children }: { children: React.ReactNode }) {
  const [showKinds, setShowKinds] = useState<number[]>(storage.getShowKinds())
  const [showKindsMap, setShowKindsMap] = useState<Record<string, number[]>>(
    storage.getShowKindsMap()
  )

  const updateShowKinds = useCallback((kinds: number[]) => {
    storage.setShowKinds(kinds)
    setShowKinds(kinds)
  }, [])

  const getShowKinds = useCallback(
    (feedId: string): number[] => {
      return showKindsMap[feedId] ?? showKinds
    },
    [showKindsMap, showKinds]
  )

  const updateShowKindsForFeed = useCallback((feedId: string, kinds: number[]) => {
    storage.setShowKindsForFeed(feedId, kinds)
    setShowKindsMap((prev) => ({ ...prev, [feedId]: kinds }))
  }, [])

  const clearShowKindsForFeed = useCallback((feedId: string) => {
    storage.clearShowKindsForFeed(feedId)
    setShowKindsMap((prev) => {
      const { [feedId]: _, ...rest } = prev
      return rest
    })
  }, [])

  const value = useMemo(
    () => ({
      showKinds,
      updateShowKinds,
      getShowKinds,
      updateShowKindsForFeed,
      clearShowKindsForFeed
    }),
    [showKinds, updateShowKinds, getShowKinds, updateShowKindsForFeed, clearShowKindsForFeed]
  )

  return <KindFilterContext.Provider value={value}>{children}</KindFilterContext.Provider>
}
