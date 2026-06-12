import DeckArea from '@/components/DeckArea'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { TPageRef } from '@/types'
import { forwardRef } from 'react'

const DeckHomePage = forwardRef<TPageRef>((_, ref) => {
  return (
    <PrimaryPageLayout ref={ref} pageName="home" noTitlebar noScrollArea>
      <DeckArea />
    </PrimaryPageLayout>
  )
})
DeckHomePage.displayName = 'DeckHomePage'
export default DeckHomePage
