import { atom } from 'jotai'

/**
 * The currently-selected ("active") column id. Sticky — set by click on a
 * column body or by keyboard (Cmd-1..9, Cmd-Shift-[/]). Keyboard commands
 * that target a column (close, pin/unpin, compose, move) read this atom.
 *
 * Ephemeral: not persisted to localStorage. Reset to `null` if the deck
 * empties; auto-set to first column on mount and to newly-added columns
 * on creation (lifecycle wired in DeckArea).
 */
export const activeColumnIdAtom = atom<string | null>(null)

/**
 * Open/closed state of the command palette (Cmd-K). Lives in Jotai (not
 * local component state) so commands can open or close it from anywhere
 * — e.g., a column-header button could trigger the palette without
 * prop-drilling.
 */
export const commandPaletteOpenAtom = atom<boolean>(false)

/**
 * Open/closed state of the "Add column" picker dialog. Lifted out of
 * DeckArea so the `column.add` palette command can trigger it without
 * prop-drilling through DeckManager / DeckArea.
 */
export const addColumnDialogOpenAtom = atom<boolean>(false)

/**
 * One-shot request to focus + scroll a specific column into view. Any code
 * outside DeckArea (e.g. ColumnsProvider when it handles a re-click on an
 * already-open transient detail column) sets this to a column id; DeckArea
 * watches it, sets that column as active, scrolls it horizontally into the
 * viewport, then clears the atom back to `null`. The atom value carries no
 * additional info — id only.
 *
 * Cleared by DeckArea after handling. Setting it to a column id that no
 * longer exists is a no-op (DeckArea ignores + clears).
 */
export const focusedColumnRequestAtom = atom<string | null>(null)

/**
 * Focus Beam: when true, the active column expands to a comfortable
 * reading width, picks up its account hue as a glow + frame + tint, and
 * auto-centers in the deck viewport. All other columns dim to opacity
 * 0.35. Beam follows `activeColumnIdAtom` — there is no second source
 * of truth for "the focused column."
 *
 * Ephemeral: not persisted. Toggles via the `f` shortcut, exits via
 * `Esc`, and is force-cleared by `column.add` / `column.close` (modal-
 * split rule from the design).
 */
export const focusBeamActiveAtom = atom<boolean>(false)

/**
 * Open/closed state of the Track B agent chat drawer. Lifted into Jotai so the
 * TopBar toggle button and the AgentDrawer shell (mounted in DeckManager) share
 * one source of truth without prop-drilling.
 *
 * Ephemeral: not persisted. The drawer re-fetches conversation history from
 * relays on each open (no local store).
 */
export const agentDrawerOpenAtom = atom<boolean>(false)
