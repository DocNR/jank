import type { TAccountWorkspace, TColumn, TDeck } from '@/types/column'
import type { TDecodeResult, TWireColumn, TWireDeck, TWireWorkspace } from '@/types/deck-sync'

const WIRE_VERSION = 1

function toWireColumn(c: TColumn): TWireColumn {
  const wire: TWireColumn = {
    id: c.id,
    viewContext: c.viewContext,
    signingIdentity: c.signingIdentity,
    type: c.type
  }
  if (c.width !== undefined) wire.width = c.width
  if (c.config !== undefined) wire.config = c.config
  if (c.parentColumnId !== undefined) wire.parentColumnId = c.parentColumnId
  return wire
}

function fromWireColumn(c: TWireColumn): TColumn {
  return {
    ...c,
    ...(c.config !== undefined ? { config: { ...c.config } } : {})
  } as TColumn
}

/** Serialize a storage workspace to canonical wire JSON. Emits SAVED columns only; drops transient. */
export function encodeWorkspace(workspace: TAccountWorkspace): string {
  const wire: TWireWorkspace = {
    version: WIRE_VERSION,
    activeDeckId: workspace.activeDeckId,
    decks: workspace.decks.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      lastSavedAt: d.lastSavedAt,
      columns: d.savedColumns.filter((c) => !c.transient).map(toWireColumn)
    }))
  }
  return JSON.stringify(wire)
}

function isWireWorkspace(v: unknown): v is TWireWorkspace {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.version !== 'number') return false
  if (typeof o.activeDeckId !== 'string') return false
  if (!Array.isArray(o.decks)) return false
  return o.decks.every((d) => {
    if (typeof d !== 'object' || d === null) return false
    const dd = d as Record<string, unknown>
    return (
      typeof dd.id === 'string' &&
      typeof dd.name === 'string' &&
      typeof dd.createdAt === 'number' &&
      typeof dd.updatedAt === 'number' &&
      typeof dd.lastSavedAt === 'number' &&
      Array.isArray(dd.columns) &&
      dd.columns.every((col) => typeof col === 'object' && col !== null)
    )
  })
}

/** Parse + validate + version-check wire JSON into a storage workspace. Never throws. */
export function decodeWorkspace(json: string): TDecodeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'parse' }
  }
  if (!isWireWorkspace(parsed)) return { ok: false, reason: 'shape' }
  if (parsed.version !== WIRE_VERSION) return { ok: false, reason: 'unsupported-version' }

  const decks: TDeck[] = parsed.decks.map((wd: TWireDeck) => ({
    id: wd.id,
    name: wd.name,
    createdAt: wd.createdAt,
    updatedAt: wd.updatedAt,
    lastSavedAt: wd.lastSavedAt,
    columns: wd.columns.map(fromWireColumn),
    savedColumns: wd.columns.map(fromWireColumn)
  }))
  return {
    ok: true,
    workspace: { activeDeckId: parsed.activeDeckId, decks },
    version: parsed.version
  }
}
