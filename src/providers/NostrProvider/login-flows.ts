import storage from '@/services/local-storage.service'
import client from '@/services/client.service'
import { ISigner, TAccount, TAccountPointer } from '@/types'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils'
import { nip04, nip44 } from 'nostr-tools'
import * as nip19 from 'nostr-tools/nip19'
import * as nip49 from 'nostr-tools/nip49'
import { toBunkerURL } from 'nostr-tools/nip46'
import { toast } from 'sonner'
import { BunkerSigner } from './bunker.signer'
import { Nip07Signer } from './nip-07.signer'
import { NpubSigner } from './npub.signer'
import { NsecSigner } from './nsec.signer'

// Pure orchestrators. Each builds a signer for the corresponding signer type
// and hands off to the caller-provided `login(signer, account)` callback,
// which is responsible for installing the account into AccountsProvider /
// NostrProvider state. ncryptsec-style flows take requestPassword for the
// interactive unlock dialog.

type LoginFn = (signer: ISigner, account: TAccount) => string
type RequestPasswordFn = () => Promise<string>
type SetupNewUserFn = (signer: ISigner) => Promise<void>
type Translate = (key: string) => string

export async function nsecLogin(opts: {
  nsecOrHex: string
  password?: string
  needSetup?: boolean
  login: LoginFn
  setupNewUser: SetupNewUserFn
}): Promise<string> {
  const { nsecOrHex, password, needSetup, login, setupNewUser } = opts
  const nsecSigner = new NsecSigner()
  let privkey: Uint8Array
  if (nsecOrHex.startsWith('nsec')) {
    const { type, data } = nip19.decode(nsecOrHex)
    if (type !== 'nsec') {
      throw new Error('invalid nsec or hex')
    }
    privkey = data
  } else if (/^[0-9a-fA-F]{64}$/.test(nsecOrHex)) {
    privkey = hexToBytes(nsecOrHex)
  } else {
    throw new Error('invalid nsec or hex')
  }
  const pubkey = nsecSigner.login(privkey)
  if (password) {
    const ncryptsec = nip49.encrypt(privkey, password)
    login(nsecSigner, { pubkey, signerType: 'ncryptsec', ncryptsec })
  } else {
    login(nsecSigner, { pubkey, signerType: 'nsec', nsec: nip19.nsecEncode(privkey) })
  }
  if (needSetup) {
    setupNewUser(nsecSigner)
  }
  return pubkey
}

export async function ncryptsecLogin(opts: {
  ncryptsec: string
  login: LoginFn
  requestPassword: RequestPasswordFn
}): Promise<string> {
  const { ncryptsec, login, requestPassword } = opts
  const password = await requestPassword()
  const privkey = nip49.decrypt(ncryptsec, password)
  const browserNsecSigner = new NsecSigner()
  const pubkey = browserNsecSigner.login(privkey)
  return login(browserNsecSigner, { pubkey, signerType: 'ncryptsec', ncryptsec })
}

export async function npubLogin(opts: { npub: string; login: LoginFn }): Promise<string> {
  const { npub, login } = opts
  const npubSigner = new NpubSigner()
  const pubkey = npubSigner.login(npub)
  return login(npubSigner, { pubkey, signerType: 'npub', npub })
}

export async function nip07Login(opts: { login: LoginFn; t: Translate }): Promise<string> {
  const { login, t } = opts
  try {
    const nip07Signer = new Nip07Signer()
    await nip07Signer.init()
    const pubkey = await nip07Signer.getPublicKey()
    if (!pubkey) {
      throw new Error('You did not allow to access your pubkey')
    }
    return login(nip07Signer, { pubkey, signerType: 'nip-07' })
  } catch (err) {
    toast.error(t('Login failed') + ': ' + (err as Error).message)
    throw err
  }
}

export async function bunkerLogin(opts: { bunker: string; login: LoginFn }): Promise<string> {
  const { bunker, login } = opts
  const bunkerSigner = new BunkerSigner()
  const pubkey = await bunkerSigner.login(bunker)
  if (!pubkey) {
    throw new Error('Invalid bunker')
  }
  const bunkerUrl = new URL(bunker)
  bunkerUrl.searchParams.delete('secret')
  return login(bunkerSigner, {
    pubkey,
    signerType: 'bunker',
    bunker: bunkerUrl.toString(),
    bunkerClientSecretKey: bunkerSigner.getClientSecretKey()
  })
}

export async function loginWithAccountPointer(opts: {
  act: TAccountPointer
  login: LoginFn
  requestPassword: RequestPasswordFn
}): Promise<string | null> {
  const { act, login, requestPassword } = opts
  let account = storage.findAccount(act)
  if (!account) {
    return null
  }
  if (account.signerType === 'nsec' || account.signerType === 'browser-nsec') {
    if (account.nsec) {
      const browserNsecSigner = new NsecSigner()
      browserNsecSigner.login(account.nsec)
      // Migrate to nsec
      if (account.signerType === 'browser-nsec') {
        storage.removeAccount(account)
        account = { ...account, signerType: 'nsec' }
        storage.addAccount(account)
      }
      return login(browserNsecSigner, account)
    }
  } else if (account.signerType === 'ncryptsec') {
    if (account.ncryptsec) {
      try {
        const password = await requestPassword()
        const privkey = nip49.decrypt(account.ncryptsec, password)
        const browserNsecSigner = new NsecSigner()
        browserNsecSigner.login(privkey)
        return login(browserNsecSigner, account)
      } catch {
        return null
      }
    }
  } else if (account.signerType === 'nip-07') {
    const nip07Signer = new Nip07Signer()
    await nip07Signer.init()
    return login(nip07Signer, account)
  } else if (account.signerType === 'bunker') {
    if (account.bunker && account.bunkerClientSecretKey) {
      const bunkerSigner = new BunkerSigner(account.bunkerClientSecretKey)
      await bunkerSigner.login(account.bunker, false)
      return login(bunkerSigner, account)
    }
  } else if (account.signerType === 'npub' && account.npub) {
    const npubSigner = new NpubSigner()
    const pubkey = npubSigner.login(account.npub)
    if (!pubkey) {
      storage.removeAccount(account)
      return null
    }
    if (pubkey !== account.pubkey) {
      storage.removeAccount(account)
      account = { ...account, pubkey }
      storage.addAccount(account)
    }
    return login(npubSigner, account)
  }
  storage.removeAccount(account)
  return null
}

/** One signer ack accumulated during a multi-account NostrConnect pair flow. */
export type AccumulatedAck = {
  signerPubkey: string
  name?: string
  picture?: string
  /** Resumable ISigner. Skips the connect handshake (the ack already proved it). */
  signer: BunkerSigner
  /** Bunker URL string suitable for persisting as the account's `bunker` field. */
  bunkerString: string
}

export type MultiAccumulatorOpts = {
  clientSecretKey: Uint8Array
  clientPubkey: string
  relays: string[]
  secret: string
  onAccumulate?: (ack: AccumulatedAck) => void
  onTotalKnown?: (total: number) => void
  signal: AbortSignal
  /** Listening window in ms. Defaults to 60_000. */
  windowMs?: number
}

/**
 * Multi-account NostrConnect login. Subscribes to kind:24133 with
 * `#p:client_pubkey` and accumulates one entry per distinct `event.pubkey`.
 * Each ack is decrypted, its `echoed_secret` validated against `opts.secret`,
 * and a resumable `BunkerSigner` is built (skipping the connect handshake
 * since the ack already proves the session).
 *
 * Terminates on any of:
 *   - `accumulated.size === total` (when `total` is announced via the first
 *     ack's JSON `result` field) → resolves with the accumulated array
 *   - window timeout (`windowMs`, default 60_000) → resolves with what's in hand
 *   - `signal.aborted` → rejects with AbortError
 */
export async function nostrConnectionLoginMulti(
  opts: MultiAccumulatorOpts
): Promise<AccumulatedAck[]> {
  const accumulated = new Map<string, AccumulatedAck>()
  let total: number | undefined
  let resolveOuter: ((acks: AccumulatedAck[]) => void) | undefined
  let rejectOuter: ((err: unknown) => void) | undefined
  const refs: { sub?: { close: () => void }; timer?: ReturnType<typeof setTimeout> } = {}

  const onAbort = () => {
    cleanup()
    rejectOuter?.(new DOMException('aborted', 'AbortError'))
  }

  const cleanup = () => {
    refs.sub?.close()
    if (refs.timer) clearTimeout(refs.timer)
    opts.signal.removeEventListener('abort', onAbort)
  }

  const finish = () => {
    cleanup()
    resolveOuter?.(Array.from(accumulated.values()))
  }

  refs.sub = client.subscribe(
    opts.relays,
    {
      kinds: [24133],
      '#p': [opts.clientPubkey]
    },
    {
      onevent: async (evt) => {
        if (accumulated.has(evt.pubkey)) return

        // Decrypt: try NIP-44 first, fall back to NIP-04.
        let plaintext: string
        try {
          const ck = nip44.v2.utils.getConversationKey(opts.clientSecretKey, evt.pubkey)
          plaintext = nip44.v2.decrypt(evt.content, ck)
        } catch {
          try {
            plaintext = nip04.decrypt(opts.clientSecretKey, evt.pubkey, evt.content)
          } catch {
            return
          }
        }

        // Parse NIP-46 response payload: { id, result, error }.
        let payload: { id?: string; result?: string; error?: string }
        try {
          payload = JSON.parse(plaintext)
        } catch {
          return
        }
        if (!payload.result || payload.error) return

        // result is either:
        //   - JSON: { echoed_secret, name?, picture?, total? } (multi-account)
        //   - plain echoed_secret string (single-account / legacy fallback)
        let echoed: string | undefined
        let name: string | undefined
        let picture: string | undefined
        const r = payload.result.trim()
        if (r.startsWith('{')) {
          try {
            const j = JSON.parse(r) as {
              echoed_secret?: unknown
              name?: unknown
              picture?: unknown
              total?: unknown
            }
            echoed = typeof j.echoed_secret === 'string' ? j.echoed_secret : undefined
            name = typeof j.name === 'string' ? j.name : undefined
            picture = typeof j.picture === 'string' ? j.picture : undefined
            if (total === undefined && typeof j.total === 'number' && j.total > 0) {
              total = j.total
              opts.onTotalKnown?.(j.total)
            }
          } catch {
            return
          }
        } else {
          echoed = r
        }

        if (echoed !== opts.secret) return

        // A bare-string `result` (echoed secret, no JSON wrapper) is the exclusive
        // signature of a NON-multi-aware signer — a conformant multi-aware signer
        // always sends JSON carrying `total`. So this ack is the one and only ack.
        // total=1 makes the `accumulated.size >= total` check below finalize now,
        // restoring instant single-account login under the always-multi URI.
        if (r[0] !== '{' && total === undefined) {
          total = 1
          opts.onTotalKnown?.(1)
        }

        // Build the resumable signer (skips connect handshake — `false` second arg).
        const bunkerString = toBunkerURL({
          pubkey: evt.pubkey,
          relays: opts.relays,
          secret: null
        })
        const signer = new BunkerSigner(bytesToHex(opts.clientSecretKey))
        try {
          await signer.login(bunkerString, false)
        } catch {
          // Close the underlying NBunkerSigner if it was constructed before the throw.
          // BunkerSigner.signer is the nostr-tools NBunkerSigner; its .close() tears down
          // the pool subscription opened in setupSubscription().
          await signer.signer?.close().catch(() => {})
          return
        }

        const ack: AccumulatedAck = {
          signerPubkey: evt.pubkey,
          name,
          picture,
          signer,
          bunkerString
        }
        accumulated.set(evt.pubkey, ack)
        opts.onAccumulate?.(ack)

        if (total !== undefined && accumulated.size >= total) {
          finish()
        }
      }
    }
  )

  refs.timer = setTimeout(() => finish(), opts.windowMs ?? 60_000)
  opts.signal.addEventListener('abort', onAbort)

  return new Promise<AccumulatedAck[]>((resolve, reject) => {
    resolveOuter = resolve
    rejectOuter = reject
  })
}
