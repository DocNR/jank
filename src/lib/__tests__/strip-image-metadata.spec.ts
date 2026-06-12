import { describe, it, expect } from 'vitest'
import { stripImageMetadata, shouldWarnFormat } from '../strip-image-metadata'

function concat(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrs) {
    out.set(a, off)
    off += a.length
  }
  return out
}

function u16be(n: number): Uint8Array {
  return new Uint8Array([(n >> 8) & 0xff, n & 0xff])
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])
}

// JPEG markers we use in fixtures
const SOI = new Uint8Array([0xff, 0xd8])
const EOI = new Uint8Array([0xff, 0xd9])

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  // Marker FF + n, then 16-bit BE length (includes the 2 length bytes), then payload.
  return concat(new Uint8Array([0xff, marker]), u16be(payload.length + 2), payload)
}

const APP0_JFIF = jpegSegment(0xe0, new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00]))
const APP1_EXIF = jpegSegment(0xe1, new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x49, 0x49, 0x2a, 0x00, 0xde, 0xad, 0xbe, 0xef]))
const APP2_ICC = jpegSegment(0xe2, new Uint8Array([0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00, 0xca, 0xfe]))
const APP13_PSIRB = jpegSegment(0xed, new Uint8Array([0x50, 0x68, 0x6f, 0x74, 0x6f, 0x73, 0x68, 0x6f, 0x70, 0x00]))
const APP14_ADOBE = jpegSegment(0xee, new Uint8Array([0x41, 0x64, 0x6f, 0x62, 0x65, 0x00]))
const COM_COMMENT = jpegSegment(0xfe, new Uint8Array([0x73, 0x65, 0x63, 0x72, 0x65, 0x74]))

// Minimal SOS + a few scan bytes. The walker copies SOS-through-EOI verbatim
// without parsing the contents, so any byte pattern is fine here.
const SOS_AND_SCAN = concat(new Uint8Array([0xff, 0xda, 0x00, 0x02]), new Uint8Array([0x12, 0x34, 0x56]))

function jpegFile(...segments: Uint8Array[]): File {
  const bytes = concat(SOI, ...segments, SOS_AND_SCAN, EOI)
  return new File([bytes], 'photo.jpg', { type: 'image/jpeg', lastModified: 1700000000000 })
}

// PNG fixtures
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  // 4-byte BE length, 4-char ASCII type, data, 4-byte CRC (zeros — strip code doesn't verify).
  const typeBytes = new TextEncoder().encode(type)
  const crc = new Uint8Array(4)
  return concat(u32be(data.length), typeBytes, data, crc)
}

const IHDR = pngChunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]))
const IDAT = pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x00, 0x05]))
const IEND = pngChunk('IEND', new Uint8Array(0))

const TEXT_AUTHOR = pngChunk('tEXt', new TextEncoder().encode('Author\0Daniel Wyler'))
const ITXT_XMP = pngChunk('iTXt', new Uint8Array([0x58, 0x4d, 0x50, 0x00, 0, 0, 0, 0, 0xfa, 0xce]))
const EXIF_CHUNK = pngChunk('eXIf', new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0xde, 0xad]))
const TIME_CHUNK = pngChunk('tIME', new Uint8Array([0x07, 0xe7, 0x01, 0x02, 0x03, 0x04, 0x05]))
const ICCP_CHUNK = pngChunk('iCCP', new Uint8Array([0x73, 0x52, 0x47, 0x42, 0, 0, 0x12, 0x34]))

function pngFile(...chunks: Uint8Array[]): File {
  const bytes = concat(PNG_MAGIC, IHDR, ...chunks, IDAT, IEND)
  return new File([bytes], 'image.png', { type: 'image/png', lastModified: 1700000000000 })
}

async function readBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

describe('stripImageMetadata — JPEG', () => {
  it('drops APP1 EXIF, output starts with SOI+APP0', async () => {
    const input = jpegFile(APP0_JFIF, APP1_EXIF)
    const result = await stripImageMetadata(input)
    expect(result.stripped).toBe(true)
    expect(result.format).toBe('jpeg')
    const out = await readBytes(result.file)
    // SOI (FF D8) + APP0 marker (FF E0)
    expect(out[0]).toBe(0xff)
    expect(out[1]).toBe(0xd8)
    expect(out[2]).toBe(0xff)
    expect(out[3]).toBe(0xe0)
    // No APP1 marker anywhere in output
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === 0xff && out[i + 1] === 0xe1) {
        throw new Error(`APP1 marker survived at offset ${i}`)
      }
    }
  })

  it('preserves APP2 ICC color profile', async () => {
    const input = jpegFile(APP0_JFIF, APP2_ICC)
    const result = await stripImageMetadata(input)
    const out = await readBytes(result.file)
    // Find APP2 marker (FF E2) in output
    let foundApp2 = false
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === 0xff && out[i + 1] === 0xe2) {
        foundApp2 = true
        break
      }
    }
    expect(foundApp2).toBe(true)
  })

  it('drops APP13 + APP14 + COM together', async () => {
    const input = jpegFile(APP0_JFIF, APP13_PSIRB, APP14_ADOBE, COM_COMMENT)
    const result = await stripImageMetadata(input)
    const out = await readBytes(result.file)
    for (let i = 0; i < out.length - 1; i++) {
      const m = out[i + 1]
      if (out[i] === 0xff && (m === 0xed || m === 0xee || m === 0xfe)) {
        throw new Error(`Forbidden marker 0xff 0x${m.toString(16)} at offset ${i}`)
      }
    }
  })

  it('passes through a JPEG with no privacy metadata byte-identically (segments only)', async () => {
    const input = jpegFile(APP0_JFIF, APP2_ICC)
    const inputBytes = await readBytes(input)
    const result = await stripImageMetadata(input)
    const out = await readBytes(result.file)
    expect(out.length).toBe(inputBytes.length)
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== inputBytes[i]) throw new Error(`Byte mismatch at offset ${i}`)
    }
  })

  it('drops EXIF but keeps ICC in a combined fixture', async () => {
    const input = jpegFile(APP0_JFIF, APP1_EXIF, APP2_ICC)
    const result = await stripImageMetadata(input)
    const out = await readBytes(result.file)
    let foundApp1 = false
    let foundApp2 = false
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === 0xff && out[i + 1] === 0xe1) foundApp1 = true
      if (out[i] === 0xff && out[i + 1] === 0xe2) foundApp2 = true
    }
    expect(foundApp1).toBe(false)
    expect(foundApp2).toBe(true)
  })

  it('throws on truncated JPEG (no EOI)', async () => {
    const truncated = concat(SOI, APP1_EXIF.slice(0, 4))
    const file = new File([truncated], 'bad.jpg', { type: 'image/jpeg' })
    await expect(stripImageMetadata(file)).rejects.toThrow()
  })

  it('output is smaller than input when metadata is dropped', async () => {
    const input = jpegFile(APP0_JFIF, APP1_EXIF, APP13_PSIRB, COM_COMMENT)
    const inputBytes = await readBytes(input)
    const result = await stripImageMetadata(input)
    const out = await readBytes(result.file)
    expect(out.length).toBeLessThan(inputBytes.length)
  })

  it('terminates at the first EOI, dropping iPhone MPF embedded sub-image', async () => {
    // Simulate iPhone JPEG: main image ending in EOI, then a second complete
    // JPEG (the HDR gain map / depth map / etc.) appended. The strip must
    // drop the embedded sub-image entirely or it carries its own metadata.
    const mainImage = concat(SOI, APP0_JFIF, APP1_EXIF, SOS_AND_SCAN, EOI)
    const embeddedSub = concat(SOI, APP1_EXIF, SOS_AND_SCAN, EOI) // independent JPEG w/ own EXIF
    const input = new File([concat(mainImage, embeddedSub)], 'iphone.jpg', { type: 'image/jpeg' })
    const result = await stripImageMetadata(input)
    const out = await readBytes(result.file)
    // Count SOI markers — must be exactly 1 (the main image's), not 2.
    let soiCount = 0
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === 0xff && out[i + 1] === 0xd8) soiCount++
    }
    expect(soiCount).toBe(1)
  })

  it('drops APP2 MPF directory while keeping APP2 ICC profile', async () => {
    // APP2 segments carry different payloads depending on the leading
    // identifier. ICC_PROFILE\0 = color profile (keep); MPF\0 = MPF
    // directory pointing at the embedded sub-image (drop).
    const iccPayload = concat(
      new TextEncoder().encode('ICC_PROFILE\0'),
      new Uint8Array([0x01, 0x01, 0xca, 0xfe, 0xba, 0xbe])
    )
    const mpfPayload = concat(
      new TextEncoder().encode('MPF\0'),
      new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0xde, 0xad])
    )
    const app2_icc = jpegSegment(0xe2, iccPayload)
    const app2_mpf = jpegSegment(0xe2, mpfPayload)
    const input = jpegFile(APP0_JFIF, app2_icc, app2_mpf)
    const result = await stripImageMetadata(input)
    const out = await readBytes(result.file)
    const dec = new TextDecoder('latin1').decode(out)
    expect(dec).toContain('ICC_PROFILE')
    expect(dec).not.toContain('MPF\0')
  })
})

describe('stripImageMetadata — PNG', () => {
  it('drops tEXt, iTXt, eXIf, tIME', async () => {
    const input = pngFile(TEXT_AUTHOR, ITXT_XMP, EXIF_CHUNK, TIME_CHUNK)
    const result = await stripImageMetadata(input)
    expect(result.stripped).toBe(true)
    expect(result.format).toBe('png')
    const out = await readBytes(result.file)
    const dec = new TextDecoder('latin1').decode(out)
    expect(dec).not.toContain('tEXt')
    expect(dec).not.toContain('iTXt')
    expect(dec).not.toContain('eXIf')
    expect(dec).not.toContain('tIME')
  })

  it('preserves iCCP color profile chunk', async () => {
    const input = pngFile(ICCP_CHUNK, TEXT_AUTHOR)
    const result = await stripImageMetadata(input)
    const out = await readBytes(result.file)
    const dec = new TextDecoder('latin1').decode(out)
    expect(dec).toContain('iCCP')
    expect(dec).not.toContain('tEXt')
  })

  it('passes through a PNG with no privacy chunks byte-identically', async () => {
    const input = pngFile(ICCP_CHUNK)
    const inputBytes = await readBytes(input)
    const result = await stripImageMetadata(input)
    const out = await readBytes(result.file)
    expect(out.length).toBe(inputBytes.length)
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== inputBytes[i]) throw new Error(`Byte mismatch at offset ${i}`)
    }
  })

  it('preserves APNG animation chunks (acTL, fcTL, fdAT) while dropping tEXt', async () => {
    const acTL = pngChunk('acTL', new Uint8Array([0, 0, 0, 3, 0, 0, 0, 0]))
    const fcTL = pngChunk('fcTL', new Uint8Array(26))
    const fdAT = pngChunk('fdAT', new Uint8Array([0, 0, 0, 1, 0x78, 0x9c]))
    const input = pngFile(acTL, fcTL, TEXT_AUTHOR, fdAT)
    const result = await stripImageMetadata(input)
    const out = await readBytes(result.file)
    const dec = new TextDecoder('latin1').decode(out)
    expect(dec).toContain('acTL')
    expect(dec).toContain('fcTL')
    expect(dec).toContain('fdAT')
    expect(dec).not.toContain('tEXt')
  })

  it('throws on truncated PNG (no IEND)', async () => {
    const noIend = concat(PNG_MAGIC, IHDR, IDAT)
    const file = new File([noIend], 'bad.png', { type: 'image/png' })
    await expect(stripImageMetadata(file)).rejects.toThrow()
  })
})

describe('stripImageMetadata — wrapper', () => {
  it('passes through unknown format unchanged (e.g. WebP magic)', async () => {
    const webpMagic = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x10, 0x00, 0x00, 0x00, // size
      0x57, 0x45, 0x42, 0x50, // WEBP
      0x00, 0x01, 0x02, 0x03 // some payload
    ])
    const input = new File([webpMagic], 'image.webp', { type: 'image/webp' })
    const inputBytes = await readBytes(input)
    const result = await stripImageMetadata(input)
    expect(result.stripped).toBe(false)
    expect(result.format).toBe('webp')
    const out = await readBytes(result.file)
    expect(out.length).toBe(inputBytes.length)
    for (let i = 0; i < out.length; i++) {
      if (out[i] !== inputBytes[i]) throw new Error(`Byte mismatch at offset ${i}`)
    }
  })

  it('detects HEIC by ftyp box', async () => {
    const heic = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, // box size
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x68, 0x65, 0x69, 0x63, // 'heic'
      0x00, 0x00, 0x00, 0x00,
      0x6d, 0x69, 0x66, 0x31,
      0x68, 0x65, 0x69, 0x63
    ])
    const input = new File([heic], 'pic.heic', { type: 'image/heic' })
    const result = await stripImageMetadata(input)
    expect(result.stripped).toBe(false)
    expect(result.format).toBe('heic')
  })

  it('detects GIF', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80])
    const input = new File([gif], 'a.gif', { type: 'image/gif' })
    const result = await stripImageMetadata(input)
    expect(result.stripped).toBe(false)
    expect(result.format).toBe('gif')
  })

  it('returns unknown format for non-image files', async () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05])
    const input = new File([bytes], 'foo.bin', { type: 'application/octet-stream' })
    const result = await stripImageMetadata(input)
    expect(result.stripped).toBe(false)
    expect(result.format).toBe('unknown')
  })

  it('returned File preserves name and MIME type', async () => {
    const input = jpegFile(APP0_JFIF, APP1_EXIF)
    const result = await stripImageMetadata(input)
    expect(result.file.name).toBe('photo.jpg')
    expect(result.file.type).toBe('image/jpeg')
  })

  it('returned File has fresh lastModified (sanitizes the date leak)', async () => {
    const input = jpegFile(APP0_JFIF, APP1_EXIF)
    // Input lastModified = 1700000000000 (set in jpegFile helper); output must differ.
    const before = Date.now()
    const result = await stripImageMetadata(input)
    const after = Date.now()
    expect(result.file.lastModified).not.toBe(1700000000000)
    expect(result.file.lastModified).toBeGreaterThanOrEqual(before)
    expect(result.file.lastModified).toBeLessThanOrEqual(after)
  })

  it('detects format by magic bytes, ignoring MIME type', async () => {
    // A JPEG that the user has renamed to .png (wrong MIME)
    const bytes = concat(SOI, APP0_JFIF, APP1_EXIF, SOS_AND_SCAN, EOI)
    const input = new File([bytes], 'mislabeled.png', { type: 'image/png' })
    const result = await stripImageMetadata(input)
    expect(result.format).toBe('jpeg')
    expect(result.stripped).toBe(true)
  })

  it('passes through files larger than 100MB without stripping', async () => {
    // Build a fake 101 MB file (we don't need real JPEG bytes — wrapper bails before format detection).
    const size = 101 * 1024 * 1024
    const bytes = new Uint8Array(size)
    bytes.set(SOI, 0)
    bytes.set(APP1_EXIF, 2) // even though it "looks like" a JPEG, size bail kicks in first
    const input = new File([bytes], 'huge.jpg', { type: 'image/jpeg' })
    const result = await stripImageMetadata(input)
    expect(result.stripped).toBe(false)
    expect(result.format).toBe('oversized')
    expect(result.file).toBe(input) // identity passthrough — no copy
  })
})

describe('shouldWarnFormat (per-session dedupe)', () => {
  it('returns true the first time a format is seen, false thereafter', () => {
    // Use a unique format string to avoid pollution from other tests.
    const fmt = `test-format-${Math.random()}`
    expect(shouldWarnFormat(fmt as never)).toBe(true)
    expect(shouldWarnFormat(fmt as never)).toBe(false)
    expect(shouldWarnFormat(fmt as never)).toBe(false)
  })
})
