import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import { TEmoji, TNotificationStyle } from '@/types'
import { createContext, useContext, useState } from 'react'

type TUserPreferencesContext = {
  notificationListStyle: TNotificationStyle
  updateNotificationListStyle: (style: TNotificationStyle) => void

  muteMedia: boolean
  updateMuteMedia: (mute: boolean) => void

  transientColumnMode: 'replace' | 'append'
  updateTransientColumnMode: (mode: 'replace' | 'append') => void

  density: 'compact' | 'comfortable'
  updateDensity: (density: 'compact' | 'comfortable') => void

  deckLeadingGutter: boolean
  updateDeckLeadingGutter: (enabled: boolean) => void

  quickReaction: boolean
  updateQuickReaction: (enable: boolean) => void

  quickReactionEmoji: string | TEmoji
  updateQuickReactionEmoji: (emoji: string | TEmoji) => void

  allowInsecureConnection: boolean
  updateAllowInsecureConnection: (allow: boolean) => void
}

const UserPreferencesContext = createContext<TUserPreferencesContext | undefined>(undefined)

// Phase 2 migration — strip user prefs retired with the sidebar. Runs once
// per browser per app version (idempotent via the migration-marker key).
function migrateUserPrefs() {
  try {
    // legacy localStorage key — do NOT rename; renaming re-runs the one-time migration
    const PHASE_2_MIGRATION_KEY = 'spectr.userPrefsPhase2Migrated'
    if (window.localStorage.getItem(PHASE_2_MIGRATION_KEY)) return
    window.localStorage.removeItem('sidebarCollapse')
    window.localStorage.removeItem('enableSingleColumnLayout')
    window.localStorage.setItem(PHASE_2_MIGRATION_KEY, '1')
  } catch {
    /* localStorage unavailable — skip */
  }
}
migrateUserPrefs()

export const useUserPreferences = () => {
  const context = useContext(UserPreferencesContext)
  if (!context) {
    throw new Error('useUserPreferences must be used within a UserPreferencesProvider')
  }
  return context
}

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [notificationListStyle, setNotificationListStyle] = useState(
    storage.getNotificationListStyle()
  )
  const [muteMedia, setMuteMedia] = useState(true)
  const [transientColumnMode, setTransientColumnMode] = useState<'replace' | 'append'>(
    storage.getTransientColumnMode()
  )
  const [density, setDensity] = useState<'compact' | 'comfortable'>(storage.getDensity())
  const [deckLeadingGutter, setDeckLeadingGutter] = useState(storage.getDeckLeadingGutter())
  const [quickReaction, setQuickReaction] = useState(storage.getQuickReaction())
  const [quickReactionEmoji, setQuickReactionEmoji] = useState(storage.getQuickReactionEmoji())

  const [allowInsecureConnection, setAllowInsecureConnection] = useState(
    storage.getAllowInsecureConnection()
  )

  const updateNotificationListStyle = (style: TNotificationStyle) => {
    setNotificationListStyle(style)
    storage.setNotificationListStyle(style)
  }

  const updateTransientColumnMode = (mode: 'replace' | 'append') => {
    setTransientColumnMode(mode)
    storage.setTransientColumnMode(mode)
  }

  const updateDensity = (next: 'compact' | 'comfortable') => {
    setDensity(next)
    storage.setDensity(next)
  }

  const updateDeckLeadingGutter = (enabled: boolean) => {
    setDeckLeadingGutter(enabled)
    storage.setDeckLeadingGutter(enabled)
  }

  const updateQuickReaction = (enable: boolean) => {
    setQuickReaction(enable)
    storage.setQuickReaction(enable)
  }

  const updateQuickReactionEmoji = (emoji: string | TEmoji) => {
    setQuickReactionEmoji(emoji)
    storage.setQuickReactionEmoji(emoji)
  }

  const updateAllowInsecureConnection = (allow: boolean) => {
    setAllowInsecureConnection(allow)
    storage.setAllowInsecureConnection(allow)
    client.setAllowInsecure(allow)
  }

  return (
    <UserPreferencesContext.Provider
      value={{
        notificationListStyle,
        updateNotificationListStyle,
        muteMedia,
        updateMuteMedia: setMuteMedia,
        transientColumnMode,
        updateTransientColumnMode,
        density,
        updateDensity,
        deckLeadingGutter,
        updateDeckLeadingGutter,
        quickReaction,
        updateQuickReaction,
        quickReactionEmoji,
        updateQuickReactionEmoji,
        allowInsecureConnection,
        updateAllowInsecureConnection
      }}
    >
      {children}
    </UserPreferencesContext.Provider>
  )
}
