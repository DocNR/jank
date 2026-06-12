// src/lib/hashtag.ts
//
// Hashtag normalization for the Hashtag column type. The per-tag grammar is
// the body of `HASHTAG_REGEX` (src/constants.ts) without the leading `#` —
// Unicode letters / numbers / marks / underscore.

const HASHTAG_TAG_REGEX = /^[\p{L}\p{N}\p{M}_]+$/u

/**
 * Normalizes a raw hashtag input for storage and `#t` filtering: strips a
 * leading `#`, trims, lowercases. Returns `null` when the result is empty or
 * contains characters outside the hashtag grammar.
 */
export function normalizeHashtag(raw: string): string | null {
  const cleaned = raw.trim().replace(/^#/, '').trim().toLowerCase()
  if (!cleaned || !HASHTAG_TAG_REGEX.test(cleaned)) return null
  return cleaned
}
