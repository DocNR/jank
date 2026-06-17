import postEditor from '@/services/post-editor.service'
import { ComponentProps, lazy, Suspense, useEffect, useState } from 'react'

const PostEditor = lazy(() => import('./index'))

/**
 * Defers loading the TipTap/ProseMirror-based PostEditor (the single largest
 * non-critical contributor to the initial bundle) until the composer is first
 * opened. Behavior is identical to importing PostEditor directly:
 *
 * - Before the first open we render nothing, so the editor chunk never lands in
 *   the initial bundle and is fetched lazily on first compose.
 * - Once opened we keep the (already-loaded) component mounted across closes so
 *   the Radix Dialog/Sheet exit animation still plays and reopening is instant.
 *
 * Drop-in replacement: it accepts the exact same props as PostEditor.
 */
export default function LazyPostEditor(props: ComponentProps<typeof PostEditor>) {
  const [mounted, setMounted] = useState(props.open)
  useEffect(() => {
    if (props.open) setMounted(true)
  }, [props.open])

  // Tell feeds a composer is open so they hold their timeline steady (see
  // post-editor.service `openCount`). Registered here rather than inside the
  // lazy PostEditor so it fires the moment `open` flips true — before the
  // Suspense chunk resolves — closing the race where a live note arrives
  // during first-compose chunk load and churns the row that owns this dialog.
  useEffect(() => {
    if (!props.open) return
    postEditor.registerOpen()
    return () => postEditor.unregisterOpen()
  }, [props.open])

  if (!mounted) return null

  // Fallback is null: the editor is a modal/sheet that owns its own backdrop,
  // and the chunk loads in well under a frame on a warm cache. A floating
  // spinner without the backdrop would look worse than the brief nothing.
  return (
    <Suspense fallback={null}>
      <PostEditor {...props} />
    </Suspense>
  )
}
