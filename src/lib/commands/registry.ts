import { matchesShortcut, parseShortcut, TParsedShortcut } from './shortcut'

export type TCommandGroup = 'columns' | 'navigation' | 'account' | 'app'

export type TCommand = {
  /** Stable id. e.g. 'column.add', 'app.search'. */
  id: string
  /** User-facing label (should be a plain string already translated via t()). */
  label: string
  /** Group for palette section heading. */
  group?: TCommandGroup
  /** Keyboard shortcut combo, e.g. 'mod+shift+n'. Optional — palette-only is fine. */
  shortcut?: string
  /**
   * Predicate: when false, the command is hidden from the palette AND its
   * keyboard shortcut is ignored. Use to gate context-dependent commands
   * (e.g. "Unpin column" only shows when there's an active, pinned column).
   */
  condition?: () => boolean
  /**
   * When `true`, the command is hidden from the palette UI but still
   * keyboard-active. Use for fan-out shortcuts where N parallel rows would
   * be redundant (e.g. the 1..9 focus-column commands are summarized by a
   * single synthetic display row).
   */
  hideFromPalette?: boolean
  /**
   * When `true`, the dispatcher will NOT auto-close the command palette
   * before firing this command. Default `false` — i.e. firing a shortcut
   * always closes the palette first, so a discovery-then-shortcut flow
   * dismisses the palette before the action runs. Used by the palette-
   * toggle command (`app.openPalette`), which needs to read the current
   * palette state itself.
   */
  managesPaletteState?: boolean
  /** Action to fire when the command is invoked (palette enter or keyboard). */
  run: () => void | Promise<void>
}

type TRegistryListener = () => void

/**
 * Process-singleton command registry. Components register their commands
 * via useRegisterCommands() (a thin React wrapper that re-runs on dep change
 * and cleans up on unmount). The CommandDispatcher reads the registry on
 * each keydown to find a matching shortcut; the CommandPalette reads it to
 * render the list.
 */
class CommandRegistry {
  private commands = new Map<string, TCommand>()
  private parsedCache = new Map<string, TParsedShortcut | null>()
  private listeners = new Set<TRegistryListener>()

  register(cmd: TCommand): void {
    this.commands.set(cmd.id, cmd)
    if (cmd.shortcut) {
      this.parsedCache.set(cmd.id, parseShortcut(cmd.shortcut))
    } else {
      this.parsedCache.delete(cmd.id)
    }
    this.notify()
  }

  unregister(id: string): void {
    this.commands.delete(id)
    this.parsedCache.delete(id)
    this.notify()
  }

  getAll(): TCommand[] {
    return Array.from(this.commands.values())
  }

  /**
   * Find a command whose shortcut matches the given KeyboardEvent.
   * Returns null if none match or the matching command's condition is false.
   */
  findByEvent(e: KeyboardEvent): TCommand | null {
    for (const cmd of this.commands.values()) {
      const parsed = this.parsedCache.get(cmd.id)
      if (!parsed) continue
      if (!matchesShortcut(e, parsed)) continue
      if (cmd.condition && !cmd.condition()) continue
      return cmd
    }
    return null
  }

  subscribe(listener: TRegistryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const l of this.listeners) l()
  }
}

const registry = new CommandRegistry()
export default registry
