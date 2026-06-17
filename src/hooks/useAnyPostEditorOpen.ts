import postEditor from '@/services/post-editor.service'
import { useSyncExternalStore } from 'react'

/**
 * True while any composer dialog/sheet is open anywhere in the app. Feeds use
 * this to keep their virtualized timeline steady while the user is composing —
 * see post-editor.service `openCount` for the why (a re-laid-out feed can
 * unmount the NoteCard row that owns an open reply dialog).
 */
export function useAnyPostEditorOpen() {
  return useSyncExternalStore(
    (onChange) => {
      postEditor.addEventListener('openStateChange', onChange)
      return () => postEditor.removeEventListener('openStateChange', onChange)
    },
    () => postEditor.isAnyOpen
  )
}
