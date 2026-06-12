import { commandPaletteOpenAtom } from '@/atoms/active-column'
import registry from '@/lib/commands/registry'
import modalManager from '@/services/modal-manager.service'
import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

/**
 * One global keydown listener on `window`. On each keydown it asks the
 * registry for a command whose shortcut matches the event (skipping any
 * whose condition() returns false). If found, prevents default and fires
 * the command's run().
 *
 * Skips events whose target is an editable surface so the user can type
 * `cmd-w` inside the post editor without closing the active column.
 *
 * Mount once in the provider tree, above DeckManager.
 */
export default function CommandDispatcher() {
  const setPaletteOpen = useSetAtom(commandPaletteOpenAtom)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // In editable fields, only plain typing is exempt. A `mod`+key combo
      // (Cmd on Mac, Ctrl elsewhere) is always a command, never text — so we
      // honor it even when focus is in the palette input or a textarea. This
      // is what makes the discovery path work: user sees `⌘⇧N` in the
      // palette and can hit it without first dismissing the palette.
      if (target && isEditableTarget(target) && !hasModifier(e)) return

      // While any modal-like surface is open (Dialog / Sheet / lightbox —
      // anything that registers with modalManager), plain-key shortcuts
      // should not leak through to the deck behind. Focused buttons inside
      // a Dialog don't trip the editable-target guard above, so without
      // this check `]`, arrow keys, or single-letter shortcuts in
      // AddColumnModal also moved/focused the active column behind it.
      // mod+key still fires — preserves the palette discovery flow
      // (e.g. ⌘K to toggle the palette from inside another modal).
      if (modalManager.isOpen() && !hasModifier(e)) return

      const cmd = registry.findByEvent(e)
      if (!cmd) return
      e.preventDefault()
      // Discovery flow: user sees a shortcut in the palette and presses it.
      // Close the palette so the resulting action (open another modal,
      // navigate, focus a column) isn't visually buried under it. Commands
      // that manage their own palette state (only the toggle today) opt out.
      if (!cmd.managesPaletteState) setPaletteOpen(false)
      void cmd.run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])

  return null
}

function isEditableTarget(el: HTMLElement): boolean {
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return false
}

function hasModifier(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey
}
