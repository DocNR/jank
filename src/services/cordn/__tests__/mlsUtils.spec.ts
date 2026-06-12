import { describe, it, expect } from 'vitest'
import {
  getCiphersuite,
  encodeMlsState,
  decodeMlsState,
  CIPHERSUITE_ID,
  CORDN_GROUP_METADATA_EXTENSION_TYPE,
  APP_DATA_DICTIONARY_EXTENSION_TYPE,
  createCordnCapabilities
} from '../mlsUtils'

describe('MLS utilities', () => {
  it('uses MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 (id 1)', async () => {
    expect(CIPHERSUITE_ID).toBe(1)
    const cs = await getCiphersuite()
    expect(cs).toBeTruthy()
  })

  it('encodes + decodes MLS state via base64', () => {
    const state = new Uint8Array([1, 2, 3, 4, 5])
    const enc = encodeMlsState(state)
    expect(typeof enc).toBe('string')
    const dec = decodeMlsState(enc)
    expect(Array.from(dec)).toEqual([1, 2, 3, 4, 5])
  })

  describe('createCordnCapabilities', () => {
    it('advertises the cordn_group_metadata + app_data_dictionary extensions', () => {
      const caps = createCordnCapabilities()
      expect(caps.extensions).toContain(CORDN_GROUP_METADATA_EXTENSION_TYPE)
      expect(caps.extensions).toContain(APP_DATA_DICTIONARY_EXTENSION_TYPE)
    })

    it('does not duplicate extensions when called twice', () => {
      // The helper is idempotent on extension membership; calling it again
      // and asking ts-mls for a fresh capabilities object should never produce
      // a doubled entry, because the underlying defaultCapabilities() returns
      // a deterministic shape and the helper guards each add with .includes.
      const caps1 = createCordnCapabilities()
      const caps2 = createCordnCapabilities()
      const count1 = caps1.extensions.filter(
        (e) => e === CORDN_GROUP_METADATA_EXTENSION_TYPE
      ).length
      const count2 = caps2.extensions.filter(
        (e) => e === CORDN_GROUP_METADATA_EXTENSION_TYPE
      ).length
      expect(count1).toBe(1)
      expect(count2).toBe(1)
      const appDataCount1 = caps1.extensions.filter(
        (e) => e === APP_DATA_DICTIONARY_EXTENSION_TYPE
      ).length
      const appDataCount2 = caps2.extensions.filter(
        (e) => e === APP_DATA_DICTIONARY_EXTENSION_TYPE
      ).length
      expect(appDataCount1).toBe(1)
      expect(appDataCount2).toBe(1)
    })

    it('pins the extension type magic numbers', () => {
      // These are part of the cordn wire compatibility surface; if they ever
      // need to change we want a failing test to remind us to bump it
      // intentionally rather than by accident.
      expect(CORDN_GROUP_METADATA_EXTENSION_TYPE).toBe(0xc04d)
      expect(APP_DATA_DICTIONARY_EXTENSION_TYPE).toBe(0x0006)
    })
  })
})
