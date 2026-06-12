import AboutInfoDialog from '@/components/AboutInfoDialog'
import Donation from '@/components/Donation'
import {
  toAgentsSettings,
  toAppearanceSettings,
  toEmojiPackSettings,
  toGeneralSettings,
  toPostSettings,
  toRelaySettings,
  toSystemSettings,
  toTranslation,
  toWallet
} from '@/lib/link'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/DeckManager'
import { useNostr } from '@/providers/NostrProvider'
import {
  Bot,
  Check,
  ChevronRight,
  Cog,
  Copy,
  Info,
  KeyRound,
  Languages,
  Palette,
  PencilLine,
  Server,
  Settings2,
  Smile,
  Wallet
} from 'lucide-react'
import { forwardRef, HTMLProps, useState } from 'react'
import { useTranslation } from 'react-i18next'

// onItemClick fires before each push() so a host can run pre-navigation
// cleanup (e.g. close a dismissable surface) before the secondary page
// opens. Default no-op = unchanged behavior for the standalone secondary-page
// usage (the only consumer after the SettingsSheet experiment was retired).
export default function Settings({ onItemClick }: { onItemClick?: () => void } = {}) {
  const { t } = useTranslation()
  const { pubkey, nsec, ncryptsec } = useNostr()
  const { push } = useSecondaryPage()
  const [copiedNsec, setCopiedNsec] = useState(false)
  const [copiedNcryptsec, setCopiedNcryptsec] = useState(false)

  const navigate = (path: string) => {
    onItemClick?.()
    push(path)
  }

  return (
    <div>
      <SettingItem className="clickable" onClick={() => navigate(toGeneralSettings())}>
        <div className="flex items-center gap-4">
          <Settings2 />
          <div>{t('General')}</div>
        </div>
        <ChevronRight className="rtl:-scale-x-100" />
      </SettingItem>
      <SettingItem className="clickable" onClick={() => navigate(toAppearanceSettings())}>
        <div className="flex items-center gap-4">
          <Palette />
          <div>{t('Appearance')}</div>
        </div>
        <ChevronRight className="rtl:-scale-x-100" />
      </SettingItem>
      <SettingItem className="clickable" onClick={() => navigate(toRelaySettings())}>
        <div className="flex items-center gap-4">
          <Server />
          <div>{t('Relays')}</div>
        </div>
        <ChevronRight className="rtl:-scale-x-100" />
      </SettingItem>
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigate(toTranslation())}>
          <div className="flex items-center gap-4">
            <Languages />
            <div>{t('Translation')}</div>
          </div>
          <ChevronRight className="rtl:-scale-x-100" />
        </SettingItem>
      )}
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigate(toWallet())}>
          <div className="flex items-center gap-4">
            <Wallet />
            <div>{t('Wallet')}</div>
          </div>
          <ChevronRight className="rtl:-scale-x-100" />
        </SettingItem>
      )}
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigate(toPostSettings())}>
          <div className="flex items-center gap-4">
            <PencilLine />
            <div>{t('Post settings')}</div>
          </div>
          <ChevronRight className="rtl:-scale-x-100" />
        </SettingItem>
      )}
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigate(toEmojiPackSettings())}>
          <div className="flex items-center gap-4">
            <Smile />
            <div>{t('Emoji Packs')}</div>
          </div>
          <ChevronRight className="rtl:-scale-x-100" />
        </SettingItem>
      )}
      {!!pubkey && (
        <SettingItem className="clickable" onClick={() => navigate(toAgentsSettings())}>
          <div className="flex items-center gap-4">
            <Bot />
            <div>{t('Agents')}</div>
          </div>
          <ChevronRight className="rtl:-scale-x-100" />
        </SettingItem>
      )}
      {!!nsec && (
        <SettingItem
          className="clickable"
          onClick={() => {
            navigator.clipboard.writeText(nsec)
            setCopiedNsec(true)
            setTimeout(() => setCopiedNsec(false), 2000)
          }}
        >
          <div className="flex items-center gap-4">
            <KeyRound />
            <div>{t('Copy private key')} (nsec)</div>
          </div>
          {copiedNsec ? <Check /> : <Copy />}
        </SettingItem>
      )}
      {!!ncryptsec && (
        <SettingItem
          className="clickable"
          onClick={() => {
            navigator.clipboard.writeText(ncryptsec)
            setCopiedNcryptsec(true)
            setTimeout(() => setCopiedNcryptsec(false), 2000)
          }}
        >
          <div className="flex items-center gap-4">
            <KeyRound />
            <div>{t('Copy private key')} (ncryptsec)</div>
          </div>
          {copiedNcryptsec ? <Check /> : <Copy />}
        </SettingItem>
      )}
      <SettingItem className="clickable" onClick={() => navigate(toSystemSettings())}>
        <div className="flex items-center gap-4">
          <Cog />
          <div>{t('System')}</div>
        </div>
        <ChevronRight className="rtl:-scale-x-100" />
      </SettingItem>
      <AboutInfoDialog>
        <SettingItem className="clickable">
          <div className="flex items-center gap-4">
            <Info />
            <div>{t('About')}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-muted-foreground">
              v{import.meta.env.APP_VERSION} ({import.meta.env.GIT_COMMIT})
            </div>
            <ChevronRight className="rtl:-scale-x-100" />
          </div>
        </SettingItem>
      </AboutInfoDialog>
      <div className="p-4">
        <Donation />
      </div>
    </div>
  )
}

const SettingItem = forwardRef<HTMLDivElement, HTMLProps<HTMLDivElement>>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        className={cn(
          'flex h-[52px] items-center justify-between rounded-lg px-4 py-2 select-none [&_svg]:size-4 [&_svg]:shrink-0',
          className
        )}
        {...props}
        ref={ref}
      >
        {children}
      </div>
    )
  }
)
SettingItem.displayName = 'SettingItem'
