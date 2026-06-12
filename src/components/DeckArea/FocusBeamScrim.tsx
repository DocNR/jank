import { focusBeamActiveAtom } from '@/atoms/active-column'
import { cn } from '@/lib/utils'
import { useSetAtom } from 'jotai'

/**
 * Focus Beam backdrop scrim. Sits between the deck (z-index 0) and the
 * focused column (z-index 50). The radial gradient brightens slightly
 * toward the center where the focused column sits — the literal
 * "spotlight beam" optical effect, achieved with a single CSS gradient
 * (no `backdrop-filter`, per the project perf rule).
 *
 * Entry / exit are pure CSS keyframe animations (see `focus-beam-scrim-*`
 * in index.css). The class swaps based on the `active` prop:
 *   - active=true  → focus-beam-scrim-enter (fade 0 → 1)
 *   - active=false → focus-beam-scrim-exit  (fade 1 → 0)
 *
 * The parent (DeckArea) keeps the scrim mounted for the exit animation
 * duration after `active` flips false, then unmounts. No useState +
 * requestAnimationFrame here — the previous version raced React's render
 * cycle and left the scrim invisible until something else triggered a
 * paint (user scrolling).
 *
 * Click anywhere on the scrim to exit beam. Clicks on the focused
 * column itself don't bubble here (column is on top in z-order and
 * intercepts the click). When `active` is false (during exit fade),
 * pointer-events are disabled so clicks fall through to the deck.
 */
export default function FocusBeamScrim({ active }: { active: boolean }) {
  const setFocusBeamActive = useSetAtom(focusBeamActiveAtom)
  return (
    <div
      className={cn(
        'fixed inset-0 z-40',
        active ? 'focus-beam-scrim-enter cursor-pointer' : 'focus-beam-scrim-exit'
      )}
      style={{
        background:
          'radial-gradient(ellipse 60% 75% at center, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.86) 70%)',
        pointerEvents: active ? 'auto' : 'none'
      }}
      onClick={() => setFocusBeamActive(false)}
      aria-hidden
    />
  )
}
