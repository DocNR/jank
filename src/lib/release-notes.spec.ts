import { describe, expect, it } from 'vitest'
import { getUnseenReleaseNotes } from './release-notes'
import type { ReleaseNote } from '@/release-notes'

const notes: ReleaseNote[] = [
  { version: '3', date: '2026-05-29', highlights: ['c'] },
  { version: '2', date: '2026-05-28', highlights: ['b'] },
  { version: '1', date: '2026-05-27', highlights: ['a'] }
]

describe('getUnseenReleaseNotes', () => {
  it('returns nothing on first run (no lastSeen)', () => {
    expect(getUnseenReleaseNotes(null, '3', notes)).toEqual({ notes: [], truncated: false })
  })
  it('returns nothing when lastSeen equals current', () => {
    expect(getUnseenReleaseNotes('3', '3', notes)).toEqual({ notes: [], truncated: false })
  })
  it('returns the entries newer than lastSeen, newest-first (cumulative)', () => {
    const result = getUnseenReleaseNotes('1', '3', notes)
    expect(result.notes.map((n) => n.version)).toEqual(['3', '2'])
    expect(result.truncated).toBe(false)
  })
  it('falls back to newest-only when lastSeen is unknown', () => {
    const result = getUnseenReleaseNotes('99', '3', notes)
    expect(result.notes.map((n) => n.version)).toEqual(['3'])
    expect(result.truncated).toBe(false)
  })
  it('returns nothing when there is no entry for the current version', () => {
    expect(getUnseenReleaseNotes('1', '4', notes)).toEqual({ notes: [], truncated: false })
  })
  it('caps at 5 entries and flags truncation', () => {
    const many: ReleaseNote[] = Array.from({ length: 8 }, (_, i) => ({
      version: String(8 - i), date: '2026-05-29', highlights: [String(8 - i)]
    }))
    const result = getUnseenReleaseNotes('1', '8', many)
    expect(result.notes).toHaveLength(5)
    expect(result.notes.map((n) => n.version)).toEqual(['8', '7', '6', '5', '4'])
    expect(result.truncated).toBe(true)
  })
})
