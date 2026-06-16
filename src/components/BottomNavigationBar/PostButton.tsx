import PostEditor from '@/components/PostEditor/LazyPostEditor'
import { useNostr } from '@/providers/NostrProvider'
import { NotePencil } from '@phosphor-icons/react'
import { useState } from 'react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

// Compose a note. A pencil now, not a plus — the bottom-bar "+" means "new
// column". Kept as PostButton (it drives the PostEditor) to avoid churn.
export default function PostButton() {
  const { checkLogin } = useNostr()
  const [open, setOpen] = useState(false)

  return (
    <>
      <BottomNavigationBarItem
        onClick={() => {
          checkLogin(() => {
            setOpen(true)
          })
        }}
      >
        <NotePencil weight="fill" />
      </BottomNavigationBarItem>
      <PostEditor open={open} setOpen={setOpen} />
    </>
  )
}
