/**
 * NIP-44 v3 typed error.
 *
 * Per-layer errors (key/ciphertext/encryption parse failures) are mapped to a
 * single discriminated union at the public boundary. The collapsed shape
 * exists to avoid leaking which specific check failed to a network observer:
 * MAC tamper, context mismatch, and padding tamper are byte-indistinguishable
 * to anyone but the decrypting party, so they all surface as
 * `decryptionFailed`. `unsupportedVersion` is kept distinct so callers can
 * dispatch to NIP-44 v2 (`0x02`) or NIP-04 (`0x04`) fallback.
 */

export type NIP44v3ErrorKind =
  | 'invalidKey'
  | 'invalidContext'
  | 'invalidCiphertext'
  | 'unsupportedVersion'
  | 'decryptionFailed'
  | 'encryptionFailed'

export class NIP44v3Error extends Error {
  readonly kind: NIP44v3ErrorKind
  readonly byte?: number
  constructor(kind: NIP44v3ErrorKind, byte?: number) {
    super(kind === 'unsupportedVersion' ? `${kind} (byte=0x${(byte ?? 0).toString(16).padStart(2, '0')})` : kind)
    this.name = 'NIP44v3Error'
    this.kind = kind
    if (byte !== undefined) this.byte = byte
  }
}
