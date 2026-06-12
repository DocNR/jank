import { Event, kinds } from 'nostr-tools'
import { describe, expect, it } from 'vitest'
import { buildNoteRows } from '../note-rows'

let counter = 0
function makeEvent(partial: Partial<Event> = {}): Event {
  counter++
  return {
    id: partial.id ?? `event-id-${counter}`.padEnd(64, '0'),
    pubkey: partial.pubkey ?? `pubkey-${counter}`.padEnd(64, '0'),
    created_at: partial.created_at ?? 1_700_000_000 + counter,
    kind: partial.kind ?? kinds.ShortTextNote,
    tags: partial.tags ?? [],
    content: partial.content ?? `note ${counter}`,
    sig: 'sig'
  }
}

function makeRepost(target: Event, partial: Partial<Event> = {}): Event {
  return makeEvent({
    kind: kinds.Repost,
    tags: [['e', target.id]],
    content: '',
    ...partial
  })
}

describe('buildNoteRows', () => {
  it('renders one row per plain note, keyed by id, preserving order', () => {
    const a = makeEvent()
    const b = makeEvent()
    const rows = buildNoteRows([a, b])
    expect(rows.map((r) => r.key)).toEqual([a.id, b.id])
    expect(rows.map((r) => r.event)).toEqual([a, b])
    expect(rows.every((r) => r.reposters.length === 0)).toBe(true)
  })

  it('drops duplicate events by key', () => {
    const a = makeEvent()
    const rows = buildNoteRows([a, { ...a }])
    expect(rows).toHaveLength(1)
  })

  it('respects shouldHideEvent', () => {
    const a = makeEvent()
    const b = makeEvent()
    const rows = buildNoteRows([a, b], { shouldHideEvent: (evt) => evt.id === a.id })
    expect(rows.map((r) => r.key)).toEqual([b.id])
  })

  it('hides replies when hideReplies is set', () => {
    const parent = makeEvent()
    const reply = makeEvent({ tags: [['e', parent.id]] })
    const rows = buildNoteRows([parent, reply], { hideReplies: true })
    expect(rows.map((r) => r.key)).toEqual([parent.id])
  })

  it('renders a repost of an unseen target as one row keyed by the target', () => {
    const target = makeEvent()
    const repost = makeRepost(target)
    const rows = buildNoteRows([repost])
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe(target.id)
    expect(rows[0].event).toBe(repost)
    expect(rows[0].reposters).toEqual([repost.pubkey])
  })

  it('collapses a repost of an already-listed note into reposters (no new row)', () => {
    const target = makeEvent()
    const repost = makeRepost(target)
    const rows = buildNoteRows([repost, target])
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe(target.id)
    expect(rows[0].reposters).toEqual([repost.pubkey])
  })

  it('collapses multiple reposts of the same target into a single row', () => {
    const target = makeEvent()
    const repostA = makeRepost(target)
    const repostB = makeRepost(target)
    const rows = buildNoteRows([repostA, repostB])
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe(target.id)
    expect(rows[0].reposters.sort()).toEqual([repostA.pubkey, repostB.pubkey].sort())
  })

  it('resolves a tag-less repost target from JSON content', () => {
    const target = makeEvent()
    const repost = makeEvent({ kind: kinds.Repost, tags: [], content: JSON.stringify(target) })
    const rows = buildNoteRows([repost])
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe(target.id)
  })

  it('drops a repost with no derivable target', () => {
    const repost = makeEvent({ kind: kinds.Repost, tags: [], content: 'not json' })
    expect(buildNoteRows([repost])).toHaveLength(0)
  })

  it('drops a repost whose embedded content is itself a repost', () => {
    const inner = makeEvent({ kind: kinds.Repost })
    const repost = makeEvent({ kind: kinds.Repost, tags: [], content: JSON.stringify(inner) })
    expect(buildNoteRows([repost])).toHaveLength(0)
  })

  it('still records reposters for rows added as plain notes earlier', () => {
    const target = makeEvent()
    const repost = makeRepost(target)
    const rows = buildNoteRows([target, repost])
    expect(rows).toHaveLength(1)
    expect(rows[0].event).toBe(target)
    expect(rows[0].reposters).toEqual([repost.pubkey])
  })
})
