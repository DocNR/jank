import { createContext, useContext, useEffect, useState } from 'react'

type TScreenSizeContext = {
  isSmallScreen: boolean
  isLargeScreen: boolean
}

const ScreenSizeContext = createContext<TScreenSizeContext | undefined>(undefined)

export const useScreenSize = () => {
  const context = useContext(ScreenSizeContext)
  if (!context) {
    throw new Error('useScreenSize must be used within a ScreenSizeProvider')
  }
  return context
}

const SMALL_QUERY = '(max-width: 768px)'
const LARGE_QUERY = '(min-width: 1280px)'

export function ScreenSizeProvider({ children }: { children: React.ReactNode }) {
  // Reactive: WS2 unified the DeckManager shell so a viewport cross of 768px
  // (rotation, resize, devtools toggle) reflows chrome without remounting the
  // deck. Mirrors the matchMedia pattern in ThemeProvider's prefers-color-scheme.
  const [isSmallScreen, setIsSmallScreen] = useState(
    () => window.matchMedia(SMALL_QUERY).matches
  )
  const [isLargeScreen, setIsLargeScreen] = useState(
    () => window.matchMedia(LARGE_QUERY).matches
  )

  useEffect(() => {
    const smallMql = window.matchMedia(SMALL_QUERY)
    const largeMql = window.matchMedia(LARGE_QUERY)
    const onSmall = (e: MediaQueryListEvent) => setIsSmallScreen(e.matches)
    const onLarge = (e: MediaQueryListEvent) => setIsLargeScreen(e.matches)
    smallMql.addEventListener('change', onSmall)
    largeMql.addEventListener('change', onLarge)
    return () => {
      smallMql.removeEventListener('change', onSmall)
      largeMql.removeEventListener('change', onLarge)
    }
  }, [])

  return (
    <ScreenSizeContext.Provider
      value={{
        isSmallScreen,
        isLargeScreen
      }}
    >
      {children}
    </ScreenSizeContext.Provider>
  )
}
