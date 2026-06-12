import { describe, expect, it } from 'vitest'
import { COLUMN_TYPES } from '../column-types'

describe('COLUMN_TYPES', () => {
  it('has no duplicate effective shortcuts', () => {
    // The AddColumnModal PickerGrid uses each descriptor's `shortcut` field if
    // set, else the first letter of `label` (lowercased). Two descriptors with
    // the same effective shortcut collide silently in the picker, with
    // first-in-array winning. PR #66 hit this: Relatr People explicitly set
    // shortcut 'p' which collided with Profile's first-letter default; pressing
    // p in the picker landed on Profile (which has supportsViewAs: true) and
    // surfaced an account picker + profile preview, which looked like a deeply
    // broken column type. Fixed by switching to shortcut 'e' for what is now
    // Profile Search.
    //
    // This test guards against the next silent collision when someone adds a
    // descriptor or renames an existing label. Assertion is a Map of
    // colliding-shortcut -> [colliding labels] so a failure tells you exactly
    // which letter collides and between which descriptors.
    const byShortcut = new Map<string, string[]>()
    for (const d of COLUMN_TYPES) {
      const sc = (d.shortcut ?? d.label[0]).toLowerCase()
      const labels = byShortcut.get(sc) ?? []
      labels.push(d.label)
      byShortcut.set(sc, labels)
    }
    const collisions: Record<string, string[]> = {}
    for (const [sc, labels] of byShortcut) {
      if (labels.length > 1) collisions[sc] = labels
    }
    expect(collisions).toEqual({})
  })
})
