import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut
} from '@/components/ui/command'
import { commandPaletteOpenAtom } from '@/atoms/active-column'
import registry, { TCommand, TCommandGroup } from '@/lib/commands/registry'
import { formatShortcut } from '@/lib/commands/shortcut'
import { useRegistryVersion } from '@/lib/commands/useRegisterCommands'
import { useAtom } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const GROUP_ORDER: TCommandGroup[] = ['columns', 'navigation', 'account', 'app']
const GROUP_LABELS: Record<TCommandGroup, string> = {
  columns: 'Columns',
  navigation: 'Navigation',
  account: 'Account',
  app: 'App'
}

/**
 * Command palette modal. Reads commands from the global registry (registered
 * by StarterCommands and any future contributors via useRegisterCommands).
 * Filters out commands whose condition() returns false. Grouped by the
 * `group` field, rendered with shortcuts on the right.
 *
 * Open state is in a Jotai atom so any command (including itself) can toggle
 * it. cmdk's built-in fuzzy filter handles typed search.
 */
export default function CommandPalette() {
  const { t } = useTranslation()
  const [open, setOpen] = useAtom(commandPaletteOpenAtom)
  // Subscribe so the visible list updates when commands appear/disappear
  // (e.g. when the active column changes, swapping Pin ↔ Unpin).
  useRegistryVersion()

  const visibleCommands = useMemo(() => {
    return registry
      .getAll()
      .filter((c) => !c.hideFromPalette)
      .filter((c) => !c.condition || c.condition())
  }, [open])
  // The deps `[open]` look light, but combined with useRegistryVersion()
  // above (which subscribes to registry changes) the memo recomputes on
  // every meaningful trigger. cmdk re-renders the rows itself.

  const grouped = useMemo(() => groupCommands(visibleCommands), [visibleCommands])

  return (
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter>
      <CommandInput placeholder={t('Type a command or search…')} />
      {/* Cap the scrollable list at ~65% of viewport height so the full
          column command set (Add / Close / Pin / Unpin / Close-all /
          Compose / Move-L / Move-R / Focus-prev / Focus-next / Focus 1..9
          + Account + App groups) doesn't push the dialog past the bottom
          of the viewport. cmdk's built-in keyboard nav scrolls the active
          item into view inside the ScrollArea. */}
      <CommandList scrollAreaClassName="max-h-[65vh]">
        <CommandEmpty>{t('No matching commands.')}</CommandEmpty>
        {GROUP_ORDER.map((g) => {
          const items = grouped.get(g)
          if (!items || items.length === 0) return null
          return (
            <CommandGroup key={g} heading={t(GROUP_LABELS[g])}>
              {items.map((cmd) => (
                <CommandRow
                  key={cmd.id}
                  cmd={cmd}
                  onRun={() => {
                    setOpen(false)
                    void cmd.run()
                  }}
                />
              ))}
            </CommandGroup>
          )
        })}
      </CommandList>
    </CommandDialog>
  )
}

function CommandRow({ cmd, onRun }: { cmd: TCommand; onRun: () => void }) {
  const segments = cmd.shortcut ? formatShortcut(cmd.shortcut) : []
  return (
    <CommandItem onSelect={onRun} value={cmd.id + ' ' + cmd.label}>
      <span className="flex-1">{cmd.label}</span>
      {segments.length > 0 && (
        <CommandShortcut>
          {segments.map((s, i) => (
            <span
              key={i}
              className="bg-muted text-muted-foreground border-border ms-0.5 inline-block min-w-[18px] rounded border px-1.5 py-0.5 text-center font-mono text-[10px] leading-none"
            >
              {s}
            </span>
          ))}
        </CommandShortcut>
      )}
    </CommandItem>
  )
}

function groupCommands(commands: TCommand[]): Map<TCommandGroup, TCommand[]> {
  const map = new Map<TCommandGroup, TCommand[]>()
  for (const cmd of commands) {
    const g = cmd.group ?? 'app'
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(cmd)
  }
  return map
}
