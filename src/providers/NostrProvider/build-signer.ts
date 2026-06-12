import { ISigner, TAccount } from '@/types'
import { BunkerSigner } from './bunker.signer'
import { Nip07Signer } from './nip-07.signer'
import { NsecSigner } from './nsec.signer'
import { NpubSigner } from './npub.signer'

/**
 * Build an ISigner for a stored account without mutating any provider state.
 * Used by AccountScope to register parallel signers in client.signers without
 * involving the legacy "active account" flow in NostrProvider.
 *
 * Returns null when the account requires an interactive password (ncryptsec)
 * or has incomplete fields. Phase 0 supports nsec / browser-nsec / nip-07 /
 * bunker / npub.
 */
export async function buildSignerForAccount(account: TAccount): Promise<ISigner | null> {
  if ((account.signerType === 'nsec' || account.signerType === 'browser-nsec') && account.nsec) {
    const signer = new NsecSigner()
    signer.login(account.nsec)
    return signer
  }
  if (account.signerType === 'nip-07') {
    const signer = new Nip07Signer()
    await signer.init()
    return signer
  }
  if (account.signerType === 'bunker' && account.bunker && account.bunkerClientSecretKey) {
    const signer = new BunkerSigner(account.bunkerClientSecretKey)
    const pubkey = await signer.login(account.bunker, false)
    if (!pubkey) return null
    return signer
  }
  if (account.signerType === 'npub' && account.npub) {
    const signer = new NpubSigner()
    signer.login(account.npub)
    return signer
  }
  // ncryptsec requires interactive password — handled by NostrProvider's main flow
  return null
}
