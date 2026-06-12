import { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { TColumn, TColumnType } from '@/types/column'
import { columnLabel } from './ColumnHeader'
import { dispatchBody } from './index'

// Adding a column type touches 7 files (see CLAUDE.md "Adding a new column
// type"), and the two runtime dispatchers are the ones that slip: a missed
// case isn't a type error (the switch just falls through to the Unknown
// fallback) and the AddColumnModal preview renders the body component
// directly, so picker smoke-tests pass while the real column shows
// "Unknown column type". This has shipped twice: Relatr People (PR #66,
// caught in browser smoke) and Favorites (PR #87, the dispatch wiring was
// lost before merge and the column was broken from ship until #137).
//
// The `satisfies Record<TColumnType, true>` map makes this spec exhaustive at
// compile time: adding a value to TColumnType without extending the map fails
// `npm run build`, which drags the new type into this coverage check.
const ALL_COLUMN_TYPES = Object.keys({
  home: true,
  notifications: true,
  detail: true,
  relay: true,
  bookmarks: true,
  hashtag: true,
  profile: true,
  search: true,
  'dvm-discover': true,
  'dvm-feed': true,
  'relatr-discovery': true,
  articles: true,
  favorites: true,
  messages: true
} satisfies Record<TColumnType, true>) as TColumnType[]

function makeColumn(type: TColumnType): TColumn {
  return {
    id: `test-${type}`,
    viewContext: 'a'.repeat(64),
    signingIdentity: null,
    type
  }
}

// dispatchBody only constructs elements (no render), so comparing element
// types against the fallback produced by a bogus column type detects a
// missing case without mounting anything.
const UNKNOWN_BODY = (dispatchBody(makeColumn('bogus' as TColumnType)) as ReactElement).type

describe('column type runtime dispatchers', () => {
  it('dispatchBody has a case for every TColumnType', () => {
    for (const type of ALL_COLUMN_TYPES) {
      const el = dispatchBody(makeColumn(type)) as ReactElement
      expect(el.type, `dispatchBody is missing case '${type}'`).not.toBe(UNKNOWN_BODY)
    }
  })

  it('columnLabel has a case for every TColumnType', () => {
    const identityT = (k: string) => k
    for (const type of ALL_COLUMN_TYPES) {
      const label = columnLabel(makeColumn(type), identityT)
      expect(label, `columnLabel is missing case '${type}'`).not.toBe('Unknown column')
    }
  })
})
