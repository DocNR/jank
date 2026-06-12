import { describe, expect, it } from 'vitest'
import { Event } from 'nostr-tools'
import { extractMediaItems } from './profile-media'

function evt(partial: Partial<Event>): Event {
  return {
    id: 'id1',
    pubkey: 'pk',
    created_at: 1,
    kind: 1,
    tags: [],
    content: '',
    sig: 'sig',
    ...partial
  } as Event
}

describe('extractMediaItems', () => {
  it('extracts image URLs from kind-1 content', () => {
    const e = evt({ content: 'hello https://img.example/a.jpg world' })
    expect(extractMediaItems(e)).toEqual([
      { url: 'https://img.example/a.jpg', type: 'image', sourceEvent: e }
    ])
  })

  it('extracts video URLs as type video', () => {
    const e = evt({ content: 'clip https://v.example/b.mp4' })
    expect(extractMediaItems(e)).toEqual([
      { url: 'https://v.example/b.mp4', type: 'video', sourceEvent: e }
    ])
  })

  it('extracts imeta image urls (kind-20 picture note with no inline url)', () => {
    const e = evt({
      kind: 20,
      content: 'my pic',
      tags: [['imeta', 'url https://img.example/c.png', 'm image/png']]
    })
    expect(extractMediaItems(e)).toEqual([
      { url: 'https://img.example/c.png', type: 'image', sourceEvent: e }
    ])
  })

  it('dedupes a url that appears in both imeta and content', () => {
    const e = evt({
      content: 'see https://img.example/d.jpg',
      tags: [['imeta', 'url https://img.example/d.jpg']]
    })
    expect(extractMediaItems(e).map((m) => m.url)).toEqual(['https://img.example/d.jpg'])
  })

  it('accepts an extension-less imeta url for a picture note (kind 20) as image', () => {
    const e = evt({
      kind: 20,
      content: 'pic',
      tags: [['imeta', 'url https://blossom.example/abc123def']]
    })
    expect(extractMediaItems(e)).toEqual([
      { url: 'https://blossom.example/abc123def', type: 'image', sourceEvent: e }
    ])
  })

  it('accepts an extension-less imeta url for a video note (kind 21) as video', () => {
    const e = evt({
      kind: 21,
      content: 'clip',
      tags: [['imeta', 'url https://blossom.example/xyz789']]
    })
    expect(extractMediaItems(e)).toEqual([
      { url: 'https://blossom.example/xyz789', type: 'video', sourceEvent: e }
    ])
  })

  it('does NOT treat an extension-less content url in a plain kind-1 note as media', () => {
    const e = evt({ kind: 1, content: 'see https://blossom.example/nope' })
    expect(extractMediaItems(e)).toEqual([])
  })

  it('returns empty for a note with no media', () => {
    expect(extractMediaItems(evt({ content: 'just text, no links' }))).toEqual([])
  })
})
