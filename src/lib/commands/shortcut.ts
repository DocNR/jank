/**
 * Shortcut string ↔ KeyboardEvent matching, plus per-platform display.
 *
 * Shortcut strings use the form `mod+shift+w`, where:
 *   - `mod`   → Cmd on macOS, Ctrl elsewhere
 *   - `shift` → Shift
 *   - `alt`   → Alt/Option
 *   - final segment is a single key, lowercased (e.g. `w`, `,`, `[`, `1`)
 *
 * Matching is done against KeyboardEvent fields. Display formatting picks
 * platform-appropriate glyphs (⌘ ⇧ ⌥ on Mac, "Ctrl" "Shift" "Alt" on
 * Win/Linux) — call `formatShortcut()` to render as kbd segments.
 */

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

export type TParsedShortcut = {
  mod: boolean
  shift: boolean
  alt: boolean
  key: string // lowercased single key
}

/** Friendly aliases → KeyboardEvent.key (lowercased). */
const KEY_ALIASES: Record<string, string> = {
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  esc: 'escape',
  return: 'enter',
  space: ' '
}

export function parseShortcut(combo: string): TParsedShortcut | null {
  const parts = combo
    .toLowerCase()
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  let mod = false
  let shift = false
  let alt = false
  let key: string | null = null
  for (const part of parts) {
    if (part === 'mod' || part === 'cmd' || part === 'ctrl') mod = true
    else if (part === 'shift') shift = true
    else if (part === 'alt' || part === 'option') alt = true
    else key = KEY_ALIASES[part] ?? part
  }
  if (!key) return null
  return { mod, shift, alt, key }
}

/** Does a KeyboardEvent match the given parsed shortcut? */
export function matchesShortcut(e: KeyboardEvent, parsed: TParsedShortcut): boolean {
  const modPressed = IS_MAC ? e.metaKey : e.ctrlKey
  // We don't want to fire `mod+w` when the user is also holding the OTHER
  // mod (e.g. Cmd+Ctrl+W) — that's a different combo. Be strict.
  const otherModPressed = IS_MAC ? e.ctrlKey : e.metaKey
  if (parsed.mod !== modPressed) return false
  if (otherModPressed) return false
  if (parsed.shift !== e.shiftKey) return false
  if (parsed.alt !== e.altKey) return false
  return e.key.toLowerCase() === parsed.key
}

/**
 * Render a shortcut combo as a list of segments for `<kbd>` rendering.
 * macOS uses glyphs (⌘ ⇧ ⌥); other platforms use plain text (Ctrl Shift Alt).
 * The final key segment is always uppercased single-character or the literal
 * symbol (`,`, `[`, etc.).
 */
/** Lowercased KeyboardEvent.key → display glyph for the kbd chip. */
const KEY_DISPLAY: Record<string, string> = {
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  enter: '↵',
  escape: 'Esc',
  ' ': 'Space'
}

export function formatShortcut(combo: string): string[] {
  const parsed = parseShortcut(combo)
  if (!parsed) return []
  const segments: string[] = []
  if (parsed.mod) segments.push(IS_MAC ? '⌘' : 'Ctrl')
  if (parsed.alt) segments.push(IS_MAC ? '⌥' : 'Alt')
  if (parsed.shift) segments.push(IS_MAC ? '⇧' : 'Shift')
  const display =
    KEY_DISPLAY[parsed.key] ??
    (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key)
  segments.push(display)
  return segments
}

/** True iff running on macOS (or iPadOS with desktop UA). Exported for tests. */
export const isMac = (): boolean => IS_MAC
