import { Label } from '@/components/ui/label'
import MutedWordsSection from '@/components/Mute/MutedWordsSection'
import { useTranslation } from 'react-i18next'
import SettingItem from './SettingItem'

export default function MutedWords() {
  const { t } = useTranslation()

  return (
    <SettingItem className="flex-col items-start gap-2">
      <Label className="text-base font-normal">{t('Muted words')}</Label>
      <MutedWordsSection />
    </SettingItem>
  )
}
