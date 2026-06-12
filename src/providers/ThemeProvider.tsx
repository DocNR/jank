import { PRIMARY_COLORS, StorageKey, TPrimaryColor } from '@/constants'
import storage from '@/services/local-storage.service'
import { TTheme, TThemePreset, TThemeSetting } from '@/types'
import { createContext, useContext, useEffect, useState } from 'react'

type ThemeProviderState = {
  theme: TTheme
  themeSetting: TThemeSetting
  setThemeSetting: (themeSetting: TThemeSetting) => void
  primaryColor: TPrimaryColor
  setPrimaryColor: (color: TPrimaryColor) => void
  preset: TThemePreset
  setPreset: (preset: TThemePreset) => void
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined)

const PRIMARY_INLINE_VARS = [
  '--primary',
  '--primary-hover',
  '--primary-foreground',
  '--ring'
] as const

const updateCSSVariables = (color: TPrimaryColor, currentTheme: TTheme) => {
  const root = window.document.documentElement
  const colorConfig = PRIMARY_COLORS[color] ?? PRIMARY_COLORS.DEFAULT

  const config = currentTheme === 'light' ? colorConfig.light : colorConfig.dark

  root.style.setProperty('--primary', config.primary)
  root.style.setProperty('--primary-hover', config['primary-hover'])
  root.style.setProperty('--primary-foreground', config['primary-foreground'])
  root.style.setProperty('--ring', config.ring)
}

const clearPrimaryInlineVars = () => {
  const root = window.document.documentElement
  for (const name of PRIMARY_INLINE_VARS) {
    root.style.removeProperty(name)
  }
}

// Runtime meta theme-color values, keyed by preset + theme. Pure-black under
// terminal collapses to the same near-black as terminal-dark by design (Q7 in
// the plan — defer special-casing until interactive verification proves it's
// needed).
const META_THEME_COLOR: Record<TThemePreset, Record<TTheme, string>> = {
  modern: {
    light: '#FFFFFF',
    dark: '#171717',
    'pure-black': '#000000'
  },
  terminal: {
    light: '#faf6e8',
    dark: '#050505',
    'pure-black': '#050505'
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeSetting, setThemeSetting] = useState<TThemeSetting>(
    (localStorage.getItem(StorageKey.THEME_SETTING) as TThemeSetting) ?? 'dark'
  )
  const [theme, setTheme] = useState<TTheme>('dark')
  const [primaryColor, setPrimaryColor] = useState<TPrimaryColor>(
    (localStorage.getItem(StorageKey.PRIMARY_COLOR) as TPrimaryColor) ?? 'DEFAULT'
  )
  const [preset, setPreset] = useState<TThemePreset>(() => {
    const stored = localStorage.getItem(StorageKey.THEME_PRESET) as TThemePreset | null
    // Default to terminal when no explicit choice; respect an explicit 'modern' pick.
    return stored === 'modern' ? 'modern' : 'terminal'
  })

  useEffect(() => {
    if (themeSetting !== 'system') {
      setTheme(themeSetting)
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light')
    }
    mediaQuery.addEventListener('change', handleChange)
    setTheme(mediaQuery.matches ? 'dark' : 'light')

    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [themeSetting])

  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(theme === 'pure-black' ? 'dark' : theme)

    if (theme === 'pure-black') {
      root.classList.add('pure-black')
    } else {
      root.classList.remove('pure-black')
    }
  }, [theme])

  useEffect(() => {
    const root = window.document.documentElement
    if (preset === 'terminal') {
      root.setAttribute('data-theme-preset', 'terminal')
    } else {
      root.removeAttribute('data-theme-preset')
    }
  }, [preset])

  useEffect(() => {
    // Terminal preset owns its primary via CSS — modern's inline writes would
    // beat the CSS-defined terminal value (inline > attr/class specificity).
    if (preset === 'terminal') {
      clearPrimaryInlineVars()
      return
    }
    updateCSSVariables(primaryColor, theme)
  }, [theme, primaryColor, preset])

  useEffect(() => {
    const meta = window.document.getElementById('theme-color-meta')
    if (meta) {
      meta.setAttribute('content', META_THEME_COLOR[preset][theme])
    }
  }, [preset, theme])

  const updateThemeSetting = (themeSetting: TThemeSetting) => {
    storage.setThemeSetting(themeSetting)
    setThemeSetting(themeSetting)
  }

  const updatePrimaryColor = (color: TPrimaryColor) => {
    storage.setPrimaryColor(color)
    setPrimaryColor(color)
  }

  const updatePreset = (next: TThemePreset) => {
    storage.setThemePreset(next)
    setPreset(next)
  }

  return (
    <ThemeProviderContext.Provider
      value={{
        theme,
        themeSetting,
        setThemeSetting: updateThemeSetting,
        primaryColor,
        setPrimaryColor: updatePrimaryColor,
        preset,
        setPreset: updatePreset
      }}
    >
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider')

  return context
}
