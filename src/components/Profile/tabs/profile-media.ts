import { ExtendedKind } from '@/constants'
import { getImetaInfosFromEvent } from '@/lib/event'
import { Event } from 'nostr-tools'

export type TMediaItem = {
  url: string
  type: 'image' | 'video'
  sourceEvent: Event
}

const URL_RE = /https?:\/\/[^\s]+/gi
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg)(\?.*)?$/i
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i

function classify(url: string): 'image' | 'video' | null {
  if (IMAGE_EXT_RE.test(url)) return 'image'
  if (VIDEO_EXT_RE.test(url)) return 'video'
  return null
}

/**
 * Extracts every media item (image/video) from a note. Combines NIP-92 `imeta`
 * tag URLs with URLs found in content. Each item carries its `sourceEvent` so the
 * grid can link the tile back to the original note. Dedupes by URL.
 */
export function extractMediaItems(event: Event): TMediaItem[] {
  const seen = new Set<string>()
  const items: TMediaItem[] = []

  const push = (url: string, type: 'image' | 'video') => {
    if (seen.has(url)) return
    seen.add(url)
    items.push({ url, type, sourceEvent: event })
  }

  // For dedicated media note kinds the kind itself asserts the media type, so
  // imeta URLs without a recognizable file extension (common with blossom/CDN
  // hash URLs) are still valid media. kind 20 = picture, 21/22 = video.
  const kindMediaType: 'image' | 'video' | null =
    event.kind === ExtendedKind.PICTURE
      ? 'image'
      : event.kind === ExtendedKind.VIDEO || event.kind === ExtendedKind.SHORT_VIDEO
        ? 'video'
        : null

  // imeta tags first (authoritative)
  for (const info of getImetaInfosFromEvent(event)) {
    if (!info.url) continue
    const type = classify(info.url) ?? kindMediaType
    if (type) push(info.url, type)
  }

  // content URLs
  for (const raw of event.content.match(URL_RE) ?? []) {
    const url = raw.replace(/[.,;:'")\]}]+$/, '')
    const type = classify(url)
    if (type) push(url, type)
  }

  return items
}
