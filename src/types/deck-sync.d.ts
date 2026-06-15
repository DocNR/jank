import type { TAccountWorkspace, TColumn } from './column'

/** A column on the wire — TColumn minus the ephemeral `transient` flag. */
export type TWireColumn = Pick<
  TColumn,
  'id' | 'viewContext' | 'signingIdentity' | 'type' | 'width' | 'config' | 'parentColumnId'
>

export type TWireDeck = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  lastSavedAt: number
  /** The deck's SAVED columns (never live unsaved edits), transient excluded. */
  columns: TWireColumn[]
}

export type TWireWorkspace = {
  version: 1
  activeDeckId: string
  decks: TWireDeck[]
  /** deckId → deletedAt (unix ms). Omitted when empty. */
  deletedDecks?: Record<string, number>
}

export type TDecodeResult =
  | { ok: true; workspace: TAccountWorkspace; version: number }
  | { ok: false; reason: 'parse' | 'shape' | 'unsupported-version' }

export type TFetchResult = { workspace: TAccountWorkspace; createdAt: number }

export type TRemoteStatus =
  | { status: 'no-remote' }
  | { status: 'up-to-date' }
  | { status: 'remote-newer'; workspace: TAccountWorkspace; createdAt: number }

export type TConflictChoice = 'overwrite' | 'reload' | 'cancel'

/** Per-pubkey record of the remote event our local workspace currently corresponds to. */
export type TDeckSyncMeta = Record<string, { lastAppliedCreatedAt: number }>
