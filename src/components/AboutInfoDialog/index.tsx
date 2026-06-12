import { BRAND } from '@/branding'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import { CODY_PUBKEY } from '@/constants'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { useState } from 'react'
import Username from '../Username'

export default function AboutInfoDialog({ children }: { children: React.ReactNode }) {
  const { isSmallScreen } = useScreenSize()
  const [open, setOpen] = useState(false)

  const content = (
    <>
      <div className="text-xl font-semibold">{BRAND.name}</div>
      <div className="text-muted-foreground">{BRAND.description}</div>
      <div>
        Forked from Jumble by{' '}
        <Username userId={CODY_PUBKEY} className="text-primary inline-block" showAt />
      </div>
      <div>
        Source code:{' '}
        <a
          href={BRAND.repo}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          GitHub
        </a>
        <div className="text-muted-foreground text-sm">
          If you like {BRAND.name}, please consider giving it a star ⭐
        </div>
      </div>
    </>
  )

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent>
          <div className="space-y-4 p-4">{content}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="sr-only">{BRAND.name}</DialogTitle>
        <DialogDescription className="sr-only">{BRAND.description}</DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  )
}
