import { addColumnDialogOpenAtom } from '@/atoms/active-column'
import { Plus } from '@phosphor-icons/react'
import { useSetAtom } from 'jotai'
import BottomNavigationBarItem from './BottomNavigationBarItem'

// Opens the column picker (AddColumnModal, mounted in DeckArea and driven by
// addColumnDialogOpenAtom). The bottom-bar "+" reads as "new column" — compose
// has its own pencil button now.
export default function NewColumnButton() {
  const setAddOpen = useSetAtom(addColumnDialogOpenAtom)
  return (
    <BottomNavigationBarItem onClick={() => setAddOpen(true)}>
      <Plus weight="bold" />
    </BottomNavigationBarItem>
  )
}
