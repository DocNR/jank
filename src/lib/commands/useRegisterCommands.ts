import { useEffect, useState } from 'react'
import registry, { TCommand } from './registry'

/**
 * Register a batch of commands for the lifetime of the calling component.
 * Re-registers when the array reference changes (memoize callers via
 * useMemo with appropriate deps to avoid thrash). Unregisters on unmount.
 *
 * NB: identity of the `commands` array matters — the hook keys its diff
 * on it. Pass a useMemo'd array, not a fresh literal each render.
 */
export function useRegisterCommands(commands: TCommand[]): void {
  useEffect(() => {
    for (const cmd of commands) registry.register(cmd)
    return () => {
      for (const cmd of commands) registry.unregister(cmd.id)
    }
  }, [commands])
}

/**
 * Subscribe to registry changes for re-rendering (e.g. the palette list).
 * Returns a snapshot version number that increments on every change.
 * The palette reads this to force a re-render when commands appear/disappear.
 */
export function useRegistryVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => registry.subscribe(() => setV((n) => n + 1)), [])
  return v
}
