import i18n from 'i18next'
import { toast } from 'sonner'

export type StripFormat = 'jpeg' | 'png' | 'webp' | 'heic' | 'gif' | 'unknown' | 'oversized'

export type StripResult = {
  file: File
  stripped: boolean
  format: StripFormat
}

const MAX_STRIP_BYTES = 100 * 1024 * 1024 // 100 MB — above this, bail to avoid main-thread memory blow-up

// --- JPEG ---------------------------------------------------------------

const ICC_IDENTIFIER = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00] // "ICC_PROFILE\0"

function isIccProfilePayload(buf: Uint8Array, start: number, end: number): boolean {
  if (end - start < ICC_IDENTIFIER.length) return false
  for (let k = 0; k < ICC_IDENTIFIER.length; k++) {
    if (buf[start + k] !== ICC_IDENTIFIER[k]) return false
  }
  return true
}

function stripJpeg(buf: Uint8Array): Uint8Array {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error('strip-image-metadata: not a JPEG (no SOI)')
  }

  const parts: Uint8Array[] = []
  parts.push(buf.subarray(0, 2)) // SOI

  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      throw new Error(`strip-image-metadata: expected marker at offset ${i}, got 0x${buf[i].toString(16)}`)
    }
    // Skip any 0xFF fill bytes preceding the actual marker byte.
    while (i + 1 < buf.length && buf[i + 1] === 0xff) i++
    if (i + 1 >= buf.length) {
      throw new Error('strip-image-metadata: truncated JPEG (no marker byte)')
    }

    const marker = buf[i + 1]

    if (marker === 0xda) {
      // SOS: past this point is entropy-coded scan data with byte-stuffing
      // (0xFF in scan data is escaped as `FF 00`) and RST markers
      // (`FF D0`..`FF D7`). Neither escape mechanism can produce `FF D9` in
      // valid scan data — so a forward scan from SOS to the first `FF D9`
      // safely identifies the main image's EOI.
      //
      // We deliberately stop at the FIRST EOI (not the last). iPhone MPF
      // photos append an embedded HDR-gain-map / depth-map sub-image after
      // the main image's EOI; dropping it removes a privacy leak (the
      // sub-image carries its own metadata) and saves ~200KB. The MPF
      // directory entry in the main image's APP2 segment is dropped
      // separately by the APP2 filter below.
      let eoi = i
      while (eoi < buf.length - 1 && !(buf[eoi] === 0xff && buf[eoi + 1] === 0xd9)) eoi++
      if (eoi >= buf.length - 1) {
        throw new Error('strip-image-metadata: truncated JPEG (no EOI after SOS)')
      }
      parts.push(buf.subarray(i, eoi + 2))
      i = eoi + 2
      break
    }

    if (marker === 0xd9) {
      // Bare EOI without prior SOS — malformed but tolerable.
      parts.push(buf.subarray(i, i + 2))
      i += 2
      break
    }

    if (marker >= 0xd0 && marker <= 0xd7) {
      // RST0..RST7 — should only appear inside scan data, but copy if seen.
      parts.push(buf.subarray(i, i + 2))
      i += 2
      continue
    }

    if (i + 4 > buf.length) {
      throw new Error('strip-image-metadata: truncated JPEG segment header')
    }
    const segLen = (buf[i + 2] << 8) | buf[i + 3]
    const segEnd = i + 2 + segLen
    if (segLen < 2 || segEnd > buf.length) {
      throw new Error('strip-image-metadata: bad JPEG segment length')
    }

    // Drop policy:
    //   - APPn (0xE0–0xEF) except APP0 (JFIF) — drop. Most carry metadata.
    //   - APP2 — keep ONLY when payload starts with `ICC_PROFILE\0`. Apple's
    //     MPF (Multi-Picture Format) directory also lives in APP2 with a
    //     `MPF\0` identifier; that directory references the embedded
    //     sub-image we drop at SOS, so we drop the directory too.
    //   - COM (0xFE) — drop.
    // Everything else (DQT/DHT/DRI/SOFn/...) is kept.
    const isAppN = marker >= 0xe0 && marker <= 0xef
    const isComment = marker === 0xfe
    let keep = !isAppN && !isComment
    if (marker === 0xe0) keep = true // APP0 JFIF
    if (marker === 0xe2) {
      // APP2 payload starts at i + 4 (after 2-byte marker + 2-byte length).
      keep = isIccProfilePayload(buf, i + 4, segEnd)
    }

    if (keep) {
      parts.push(buf.subarray(i, segEnd))
    }
    i = segEnd
  }

  let total = 0
  for (const part of parts) total += part.length
  const result = new Uint8Array(total)
  let off = 0
  for (const part of parts) {
    result.set(part, off)
    off += part.length
  }

  if (result.length > buf.length) {
    throw new Error('strip-image-metadata: JPEG strip produced larger output (parser bug)')
  }
  return result
}

// --- PNG ----------------------------------------------------------------

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_DROP_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'])

function stripPng(buf: Uint8Array): Uint8Array {
  if (buf.length < 8) {
    throw new Error('strip-image-metadata: truncated PNG (no magic)')
  }
  for (let k = 0; k < 8; k++) {
    if (buf[k] !== PNG_MAGIC[k]) {
      throw new Error('strip-image-metadata: not a PNG')
    }
  }

  const parts: Uint8Array[] = []
  parts.push(buf.subarray(0, 8)) // magic

  let i = 8
  let sawIEND = false
  while (i < buf.length) {
    if (i + 8 > buf.length) {
      throw new Error('strip-image-metadata: truncated PNG chunk header')
    }
    const len = (buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]
    const type = String.fromCharCode(buf[i + 4], buf[i + 5], buf[i + 6], buf[i + 7])
    const chunkEnd = i + 12 + (len >>> 0) // 4 length + 4 type + len data + 4 CRC
    if (chunkEnd > buf.length) {
      throw new Error('strip-image-metadata: truncated PNG chunk data')
    }

    if (!PNG_DROP_CHUNKS.has(type)) {
      parts.push(buf.subarray(i, chunkEnd))
    }

    if (type === 'IEND') {
      sawIEND = true
      i = chunkEnd
      break
    }
    i = chunkEnd
  }

  if (!sawIEND) {
    throw new Error('strip-image-metadata: PNG missing IEND')
  }

  let total = 0
  for (const part of parts) total += part.length
  const result = new Uint8Array(total)
  let off = 0
  for (const part of parts) {
    result.set(part, off)
    off += part.length
  }

  if (result.length > buf.length) {
    throw new Error('strip-image-metadata: PNG strip produced larger output (parser bug)')
  }
  return result
}

// --- Format detection ---------------------------------------------------

function detectFormat(buf: Uint8Array): StripFormat {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpeg'
  }
  if (buf.length >= 8) {
    let isPng = true
    for (let k = 0; k < 8; k++) {
      if (buf[k] !== PNG_MAGIC[k]) {
        isPng = false
        break
      }
    }
    if (isPng) return 'png'
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // "RIFF"
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // "WEBP"
  ) {
    return 'webp'
  }
  if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    // ISO base media "ftyp" box — HEIC/HEIF/etc. Brand at bytes 8..11.
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11])
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1' || brand === 'heim' || brand === 'heis') {
      return 'heic'
    }
  }
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return 'gif'
  }
  return 'unknown'
}

// --- Public entry -------------------------------------------------------

export async function stripImageMetadata(file: File): Promise<StripResult> {
  if (file.size > MAX_STRIP_BYTES) {
    return { file, stripped: false, format: 'oversized' }
  }

  const buf = new Uint8Array(await file.arrayBuffer())
  const format = detectFormat(buf)

  if (format === 'jpeg') {
    const stripped = stripJpeg(buf)
    const out = new File([stripped], file.name, { type: file.type, lastModified: Date.now() })
    return { file: out, stripped: true, format }
  }
  if (format === 'png') {
    const stripped = stripPng(buf)
    const out = new File([stripped], file.name, { type: file.type, lastModified: Date.now() })
    return { file: out, stripped: true, format }
  }
  return { file, stripped: false, format }
}

// --- Per-session warning dedupe -----------------------------------------

const warnedFormats = new Set<StripFormat>()

export function shouldWarnFormat(format: StripFormat): boolean {
  if (warnedFormats.has(format)) return false
  warnedFormats.add(format)
  return true
}

// Formats we won't warn about: 'unknown' (likely not an image, e.g. PDF), and
// 'oversized' (file > 100MB — we don't strip but the user already knows they
// uploaded a huge file).
const WARNABLE_FORMATS: ReadonlySet<StripFormat> = new Set(['webp', 'heic', 'gif'])

// Best-effort warning toast for passthrough image formats. Fires once per
// format per session via shouldWarnFormat. No-op for stripped formats and for
// non-image files.
export function maybeWarnUnsupportedFormat(result: StripResult): void {
  if (result.stripped) return
  if (!WARNABLE_FORMATS.has(result.format)) return
  if (!shouldWarnFormat(result.format)) return

  toast.warning(
    i18n.t(
      'Metadata stripping is not yet supported for {{format}}. Image may contain location or camera data.',
      { format: result.format.toUpperCase() }
    )
  )
}
