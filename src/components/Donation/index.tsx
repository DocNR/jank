import { BRAND } from '@/branding'
import { Button } from '@/components/ui/button'
import { UPSTREAM_DONATION_PUBKEY } from '@/constants'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ZapDialog from '../ZapDialog'
import PlatinumSponsors from './PlatinumSponsors'
import RecentSupporters from './RecentSupporters'

export default function Donation({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [donationAmount, setDonationAmount] = useState<number | undefined>(undefined)

  return (
    <div className={cn('space-y-4 rounded-lg border p-4', className)}>
      <div className="text-center font-semibold">
        {t('Enjoying {{appName}}?', { appName: BRAND.name })}
      </div>
      <div className="text-muted-foreground text-center">
        {t('Your donation helps me maintain {{appName}} and make it better! 😊', {
          appName: BRAND.name
        })}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { amount: 1000, text: '☕️ 1k' },
          { amount: 10000, text: '🍜 10k' },
          { amount: 100000, text: '🍣 100k' },
          { amount: 1000000, text: '✈️ 1M' }
        ].map(({ amount, text }) => {
          return (
            <Button
              variant="secondary"
              className=""
              key={amount}
              onClick={() => {
                setDonationAmount(amount)
                setOpen(true)
              }}
            >
              {text}
            </Button>
          )
        })}
      </div>
      <PlatinumSponsors />
      <RecentSupporters />
      <ZapDialog
        open={open}
        setOpen={setOpen}
        pubkey={UPSTREAM_DONATION_PUBKEY}
        defaultAmount={donationAmount}
      />
    </div>
  )
}
