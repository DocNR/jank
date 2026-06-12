import { Label } from '@/components/ui/label'
import { PRIMARY_COLORS, PROFILE_PICTURE_AUTO_LOAD_POLICY, TPrimaryColor } from '@/constants'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { cn } from '@/lib/utils'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useTheme } from '@/providers/ThemeProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { TProfilePictureAutoLoadPolicy, TThemePreset } from '@/types'
import {
  AlignLeft,
  IndentIncrease,
  LayoutList,
  List,
  Monitor,
  Moon,
  Palette,
  Plus,
  Replace,
  Rows3,
  Rows4,
  Sun,
  Terminal
} from 'lucide-react'
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'

const PRESETS = [
  { key: 'modern' as const, label: 'Modern', icon: <Palette className="size-5" /> },
  { key: 'terminal' as const, label: 'Terminal', icon: <Terminal className="size-5" /> }
] as const

const THEMES = [
  { key: 'system', label: 'System', icon: <Monitor className="size-5" /> },
  { key: 'light', label: 'Light', icon: <Sun className="size-5" /> },
  { key: 'dark', label: 'Dark', icon: <Moon className="size-5" /> },
  { key: 'pure-black', label: 'Pure Black', icon: <Moon className="size-5 fill-current" /> }
] as const

const NOTIFICATION_STYLES = [
  { key: 'detailed', label: 'Detailed', icon: <LayoutList className="size-5" /> },
  { key: 'compact', label: 'Compact', icon: <List className="size-5" /> }
] as const

const TRANSIENT_COLUMN_MODES = [
  { key: 'replace', label: 'Replace existing transient', icon: <Replace className="size-5" /> },
  { key: 'append', label: 'Open as new column', icon: <Plus className="size-5" /> }
] as const

const DENSITIES = [
  { key: 'comfortable', label: 'Comfortable', icon: <Rows3 className="size-5" /> },
  { key: 'compact', label: 'Compact', icon: <Rows4 className="size-5" /> }
] as const

const DECK_ALIGNMENTS = [
  { key: false, label: 'Flush left', icon: <AlignLeft className="size-5" /> },
  { key: true, label: 'Indented', icon: <IndentIncrease className="size-5" /> }
] as const

const AppearanceSettingsPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { themeSetting, setThemeSetting, primaryColor, setPrimaryColor, preset, setPreset } =
    useTheme()
  const { profilePictureAutoLoadPolicy, setProfilePictureAutoLoadPolicy } = useContentPolicy()
  const {
    notificationListStyle,
    updateNotificationListStyle,
    transientColumnMode,
    updateTransientColumnMode,
    density,
    updateDensity,
    deckLeadingGutter,
    updateDeckLeadingGutter
  } = useUserPreferences()

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Appearance')}>
      <div className="my-3 space-y-4">
        <div className="flex flex-col gap-2 px-4">
          <Label className="text-base">{t('Preset')}</Label>
          <div className="grid w-full grid-cols-2 gap-4">
            {PRESETS.map(({ key, label, icon }) => (
              <OptionButton
                key={key}
                isSelected={preset === key}
                icon={icon}
                label={t(label)}
                onClick={() => setPreset(key as TThemePreset)}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4">
          <Label className="text-base">{t('Theme')}</Label>
          <div className="grid w-full grid-cols-2 gap-4 md:grid-cols-4">
            {THEMES.map(({ key, label, icon }) => (
              <OptionButton
                key={key}
                isSelected={themeSetting === key}
                icon={icon}
                label={t(label)}
                onClick={() => setThemeSetting(key)}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4">
          <Label className="text-base">{t('Density')}</Label>
          <div className="grid w-full grid-cols-2 gap-4">
            {DENSITIES.map(({ key, label, icon }) => (
              <OptionButton
                key={key}
                isSelected={density === key}
                icon={icon}
                label={t(label)}
                onClick={() => updateDensity(key)}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4">
          <Label className="text-base">{t('Deck alignment')}</Label>
          <div className="grid w-full grid-cols-2 gap-4">
            {DECK_ALIGNMENTS.map(({ key, label, icon }) => (
              <OptionButton
                key={String(key)}
                isSelected={deckLeadingGutter === key}
                icon={icon}
                label={t(label)}
                onClick={() => updateDeckLeadingGutter(key)}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4">
          <Label className="text-base">{t('Note open behavior')}</Label>
          <div className="grid w-full grid-cols-2 gap-4">
            {TRANSIENT_COLUMN_MODES.map(({ key, label, icon }) => (
              <OptionButton
                key={key}
                isSelected={transientColumnMode === key}
                icon={icon}
                label={t(label)}
                onClick={() => updateTransientColumnMode(key)}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4">
          <Label className="text-base">{t('Notification list style')}</Label>
          <div className="grid w-full grid-cols-2 gap-4">
            {NOTIFICATION_STYLES.map(({ key, label, icon }) => (
              <OptionButton
                key={key}
                isSelected={notificationListStyle === key}
                icon={icon}
                label={t(label)}
                onClick={() => updateNotificationListStyle(key)}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4">
          <Label className="text-base">{t('Show avatars')}</Label>
          <div className="grid w-full grid-cols-2 gap-4">
            <AvatarPolicyCard
              showAvatar
              label={t('Show')}
              isSelected={profilePictureAutoLoadPolicy !== PROFILE_PICTURE_AUTO_LOAD_POLICY.NEVER}
              onClick={() =>
                setProfilePictureAutoLoadPolicy(
                  PROFILE_PICTURE_AUTO_LOAD_POLICY.ALWAYS as TProfilePictureAutoLoadPolicy
                )
              }
            />
            <AvatarPolicyCard
              label={t('Hide')}
              isSelected={profilePictureAutoLoadPolicy === PROFILE_PICTURE_AUTO_LOAD_POLICY.NEVER}
              onClick={() =>
                setProfilePictureAutoLoadPolicy(
                  PROFILE_PICTURE_AUTO_LOAD_POLICY.NEVER as TProfilePictureAutoLoadPolicy
                )
              }
            />
          </div>
        </div>
        {preset === 'modern' && (
          <div className="flex flex-col gap-2 px-4">
            <Label className="text-base">{t('Primary color')}</Label>
            <div className="grid w-full grid-cols-4 gap-4">
              {Object.entries(PRIMARY_COLORS).map(([key, config]) => (
                <OptionButton
                  key={key}
                  isSelected={primaryColor === key}
                  icon={
                    <div
                      className="size-8 rounded-full shadow-md"
                      style={{
                        backgroundColor: `hsl(${config.light.primary})`
                      }}
                    />
                  }
                  label={t(config.name)}
                  onClick={() => setPrimaryColor(key as TPrimaryColor)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </SecondaryPageLayout>
  )
})
AppearanceSettingsPage.displayName = 'AppearanceSettingsPage'
export default AppearanceSettingsPage

const NoteSkeletonLine = ({ className }: { className?: string }) => (
  <div className={cn('bg-muted-foreground/20 h-1.5 rounded-full', className)} />
)

const AvatarPolicyCard = ({
  showAvatar,
  label,
  isSelected,
  onClick
}: {
  showAvatar?: boolean
  label?: string
  isSelected: boolean
  onClick: () => void
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col gap-2 rounded-lg border-2 px-3 py-4 transition-all',
        isSelected ? 'border-primary' : 'border-border hover:border-muted-foreground/40'
      )}
    >
      <div className="flex w-full items-center gap-1.5">
        {showAvatar && <div className="bg-muted-foreground/20 size-5 shrink-0 rounded-full" />}
        <div className="flex flex-1 flex-col gap-1">
          <NoteSkeletonLine className="w-8" />
          <NoteSkeletonLine className="w-5" />
        </div>
      </div>
      <div className="flex w-full flex-col gap-1">
        <NoteSkeletonLine className="w-full" />
        <NoteSkeletonLine className="w-2/3" />
      </div>
      {label && <span className="mt-1 self-center text-xs font-medium">{label}</span>}
    </button>
  )
}

const OptionButton = ({
  isSelected,
  onClick,
  icon,
  label
}: {
  isSelected: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border-2 py-4 transition-all',
        isSelected ? 'border-primary' : 'border-border hover:border-muted-foreground/40'
      )}
    >
      <div className="flex h-8 w-8 items-center justify-center">{icon}</div>
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}
