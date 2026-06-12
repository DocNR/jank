import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TGif } from '@/services/klipy.service'
import { useState } from 'react'
import GifPicker from './GifPicker'

export default function GifPickerDialog({
  children,
  onSelect,
  onOpenChange
}: {
  children: React.ReactNode
  onSelect: (gif: TGif) => void
  onOpenChange?: (open: boolean) => void
}) {
  const { isSmallScreen } = useScreenSize()
  const [open, setOpen] = useState(false)

  const handleOpenChange = (value: boolean) => {
    // Dismiss the virtual keyboard before opening so the layout stays stable.
    if (value && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setOpen(value)
    onOpenChange?.(value)
  }

  const handleSelect = (gif: TGif) => {
    setOpen(false)
    onOpenChange?.(false)
    onSelect(gif)
  }

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent onClick={(e) => e.stopPropagation()}>
          <GifPicker onSelect={handleSelect} />
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-fit p-0" onClick={(e) => e.stopPropagation()}>
        <GifPicker onSelect={handleSelect} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
