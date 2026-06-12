import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { TEmoji } from '@/types'
import { useState } from 'react'
import EmojiPicker from '../EmojiPicker'

export default function EmojiPickerDialog({
  children,
  onEmojiClick,
  onOpenChange
}: {
  children: React.ReactNode
  onEmojiClick?: (emoji: string | TEmoji) => void
  onOpenChange?: (open: boolean) => void
}) {
  const { isSmallScreen } = useScreenSize()
  const [open, setOpen] = useState(false)

  const handleOpenChange = (value: boolean) => {
    // Dismiss virtual keyboard before opening the drawer so the layout stays
    // stable and tapped emojis land on the intended cell.
    if (value && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setOpen(value)
    onOpenChange?.(value)
  }

  const handlePick = (emoji: string | TEmoji) => {
    setOpen(false)
    onOpenChange?.(false)
    onEmojiClick?.(emoji)
  }

  if (isSmallScreen) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange}>
        <DrawerTrigger asChild>{children}</DrawerTrigger>
        <DrawerContent onClick={(e) => e.stopPropagation()}>
          <EmojiPicker onEmojiClick={handlePick} />
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" className="w-fit p-0" onClick={(e) => e.stopPropagation()}>
        <EmojiPicker onEmojiClick={handlePick} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
