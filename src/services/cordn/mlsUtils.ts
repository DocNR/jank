import { defaultCapabilities, getCiphersuiteImpl, type Capabilities } from 'ts-mls'

/** MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 — needs no peer deps beyond @hpke/core. */
export const CIPHERSUITE_ID = 1 as const

/** The CiphersuiteName string that ts-mls accepts for ciphersuite id 1. */
const CIPHERSUITE_NAME = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519' as const

/**
 * Cordn group metadata MLS extension type (cordn_group_metadata, per cordn
 * spec/01.md § 2). Cordn groups carry this extension on the GroupContext, so
 * all paired KeyPackages MUST advertise support to be addable to a group.
 */
export const CORDN_GROUP_METADATA_EXTENSION_TYPE = 0xc04d as const

/**
 * MLS application_data_dictionary extension type (RFC 9420 § 5.3.1). Cordn
 * uses it for some app-data fields; KeyPackages MUST advertise support so the
 * extension can ride along when the GroupContext changes.
 */
export const APP_DATA_DICTIONARY_EXTENSION_TYPE = 0x0006 as const

let _cs: Awaited<ReturnType<typeof getCiphersuiteImpl>> | null = null
export async function getCiphersuite() {
  if (_cs) return _cs
  _cs = await getCiphersuiteImpl(CIPHERSUITE_NAME)
  return _cs
}

/**
 * Build an MLS Capabilities object that advertises the two extensions cordn
 * groups use by default. Mirrors cordn-web's `createCordnMetadataCapabilities`
 * (src/lib/services/chatMlsUtils.ts line ~183). Without these extensions
 * declared on a member's KeyPackage, an MLS Add on a cordn group will fail
 * capabilities negotiation.
 */
export function createCordnCapabilities(): Capabilities {
  const capabilities = defaultCapabilities()
  if (!capabilities.extensions.includes(CORDN_GROUP_METADATA_EXTENSION_TYPE)) {
    capabilities.extensions = [...capabilities.extensions, CORDN_GROUP_METADATA_EXTENSION_TYPE]
  }
  if (!capabilities.extensions.includes(APP_DATA_DICTIONARY_EXTENSION_TYPE)) {
    capabilities.extensions = [...capabilities.extensions, APP_DATA_DICTIONARY_EXTENSION_TYPE]
  }
  return capabilities
}

/** Base64-encode Uint8Array MLS state for IndexedDB storage. */
export function encodeMlsState(state: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < state.length; i++) bin += String.fromCharCode(state[i])
  return btoa(bin)
}

export function decodeMlsState(enc: string): Uint8Array {
  const bin = atob(enc)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
