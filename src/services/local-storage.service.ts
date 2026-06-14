import {
  ALLOWED_FILTER_KINDS,
  BIG_RELAY_URLS,
  DEFAULT_FAVICON_URL_TEMPLATE,
  DEFAULT_NIP_96_SERVICE,
  ExtendedKind,
  MEDIA_AUTO_LOAD_POLICY,
  NOTIFICATION_LIST_STYLE,
  NSFW_DISPLAY_POLICY,
  PROFILE_PICTURE_AUTO_LOAD_POLICY,
  SEARCHABLE_RELAY_URLS,
  StorageKey,
  TPrimaryColor
} from '@/constants'
import { isSameAccount } from '@/lib/account'
// platform helpers no longer needed here — Electron path was stripped from the fork
import { randomString } from '@/lib/random'
import { isTorBrowser, randomId } from '@/lib/utils'
import {
  TAccount,
  TAccountPointer,
  TEmoji,
  TFeedInfo,
  TMediaAutoLoadPolicy,
  TMediaUploadServiceConfig,
  TNotificationStyle,
  TNsfwDisplayPolicy,
  TProfilePictureAutoLoadPolicy,
  TRelaySet,
  TThemePreset,
  TThemeSetting,
  TTranslationServiceConfig
} from '@/types'
import { kinds } from 'nostr-tools'
import {
  TColumn,
  TColumnConfig,
  TDeck,
  TDeckV1,
  TWorkspacesByAccount,
  TAccountWorkspace
} from '@/types/column'
import { migrateWorkspacesByAccount } from '@/services/migrate-decks-by-account'
import type { TDeckSyncMeta } from '@/types/deck-sync'

/**
 * Hydration-time migration + validation for stored column entries. Runs once
 * when the localStorage `columns` key is read at startup; idempotent, so
 * already-migrated entries pass through unchanged.
 *
 *  - legacy `type: 'mentions'` → `'notifications'` (column type was renamed)
 *  - legacy single `accountId` field → split `viewContext` + `signingIdentity`
 *    (both default to the old `accountId`, which they always equalled pre-split)
 *  - deep-validation: entries missing a usable id / type / pubkey are dropped
 *    rather than poisoning the deck (previously only `Array.isArray` was checked)
 */
export function migrateColumns(raw: unknown): TColumn[] {
  if (!Array.isArray(raw)) return []
  const out: TColumn[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const c = entry as Record<string, unknown>
    if (typeof c.id !== 'string' || !c.id) continue

    const type = c.type === 'mentions' ? 'notifications' : c.type
    if (
      type !== 'home' &&
      type !== 'notifications' &&
      type !== 'detail' &&
      type !== 'relay' &&
      type !== 'bookmarks' &&
      type !== 'hashtag' &&
      type !== 'profile' &&
      type !== 'search' &&
      type !== 'dvm-discover' &&
      type !== 'dvm-feed' &&
      type !== 'relatr-discovery' &&
      type !== 'articles' &&
      type !== 'favorites' &&
      type !== 'messages' &&
      type !== 'mute-list'
    ) {
      // 'dms' falls through here too — DM feature removed, drop the column.
      continue
    }

    // `accountId` is the legacy single field; `viewContext` / `signingIdentity`
    // are the post-split fields. An entry carrying none of the three has no
    // usable pubkey — drop it.
    const legacyAccountId =
      typeof c.accountId === 'string' && c.accountId ? c.accountId : undefined
    const viewContext =
      typeof c.viewContext === 'string' && c.viewContext ? c.viewContext : legacyAccountId
    if (!viewContext) continue

    let signingIdentity: string | null
    if (c.signingIdentity === null) {
      signingIdentity = null
    } else if (typeof c.signingIdentity === 'string' && c.signingIdentity) {
      signingIdentity = c.signingIdentity
    } else {
      // Pre-split entry: signer defaults to the old accountId (which equalled
      // viewContext for every pre-split column).
      signingIdentity = legacyAccountId ?? viewContext
    }

    // Migrate the legacy per-column notification list-style override
    // (`config.notificationListStyle`) to the generic `config.listStyle`
    // field now shared by every list-style column type. Idempotent: a
    // config that already uses `listStyle` passes through unchanged.
    let config: TColumnConfig | undefined
    if (c.config && typeof c.config === 'object') {
      const rawConfig = { ...(c.config as Record<string, unknown>) }
      if ('notificationListStyle' in rawConfig) {
        if (rawConfig.listStyle === undefined) {
          rawConfig.listStyle = rawConfig.notificationListStyle
        }
        delete rawConfig.notificationListStyle
      }
      config = rawConfig as TColumnConfig
    }

    out.push({
      id: c.id,
      viewContext,
      signingIdentity,
      type,
      transient: c.transient === true ? true : undefined,
      width: typeof c.width === 'number' ? c.width : undefined,
      config,
      parentColumnId: typeof c.parentColumnId === 'string' ? c.parentColumnId : undefined
    })
  }
  return out
}

/**
 * Hydration-time migration for the localStorage `decks` / `activeDeckId`
 * keys (v1 shape, kept for backwards compat + the migrate-decks.spec.ts
 * regression). v2's `migrateWorkspacesByAccount` consumes v1's `TDeckV1[]`
 * output and splits it into per-account workspaces.
 *
 * Paths:
 *  - DECKS present + ACTIVE_DECK_ID valid: idempotent no-op.
 *  - DECKS present + ACTIVE_DECK_ID stale/missing: reset to decks[0].id,
 *    flag migrated=true so caller persists the fix.
 *  - DECKS absent: build one default deck from legacy `columns`. Owner =
 *    first paired pubkey when one exists, else null.
 *  - Malformed DECKS: per-deck deep-validation; drop entries missing
 *    required fields, fall back to fresh-install path if everything drops.
 *
 * `ColumnsProvider` is responsible for setting `ownerPubkey` on first
 * pairing when migration ran with no accounts paired.
 */
export function migrateDecks(
  rawDecks: unknown,
  rawActiveDeckId: unknown,
  columns: TColumn[],
  accountPubkeys: string[]
): { decks: TDeckV1[]; activeDeckId: string; migrated: boolean } {
  const now = Date.now()
  const firstPubkey = accountPubkeys[0] ?? null

  const buildDefaultDeck = (): TDeckV1 => ({
    id: randomId(),
    name: 'My Deck',
    ownerPubkey: firstPubkey,
    columns,
    createdAt: now,
    updatedAt: now
  })

  // Path: DECKS absent or non-array → build fresh.
  if (!Array.isArray(rawDecks)) {
    const deck = buildDefaultDeck()
    return { decks: [deck], activeDeckId: deck.id, migrated: true }
  }

  // Path: DECKS present — validate each entry.
  const validDecks: TDeckV1[] = []
  for (const entry of rawDecks) {
    if (!entry || typeof entry !== 'object') continue
    const d = entry as Record<string, unknown>
    if (typeof d.id !== 'string' || !d.id) continue
    if (!Array.isArray(d.columns)) continue
    validDecks.push({
      id: d.id,
      name: typeof d.name === 'string' ? d.name : 'My Deck',
      ownerPubkey: typeof d.ownerPubkey === 'string' ? d.ownerPubkey : null,
      columns: d.columns as TColumn[],
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : now,
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : now
    })
  }

  if (validDecks.length === 0) {
    const deck = buildDefaultDeck()
    return { decks: [deck], activeDeckId: deck.id, migrated: true }
  }

  // Path: validate ACTIVE_DECK_ID points to a real deck.
  const activeId = typeof rawActiveDeckId === 'string' ? rawActiveDeckId : null
  const activeExists = activeId !== null && validDecks.some((d) => d.id === activeId)
  if (activeExists) {
    return { decks: validDecks, activeDeckId: activeId!, migrated: false }
  }
  return { decks: validDecks, activeDeckId: validDecks[0].id, migrated: true }
}

class LocalStorageService {
  static instance: LocalStorageService

  private relaySets: TRelaySet[] = []
  private themeSetting: TThemeSetting = 'dark'
  private themePreset: TThemePreset = 'terminal'
  private accounts: TAccount[] = []
  private currentAccount: TAccount | null = null
  private lastReadNotificationTimeMap: Record<string, number> = {}
  private readNotificationsMap: Record<string, string[]> = {}
  private defaultZapSats: number = 21
  private defaultZapComment: string = 'Zap!'
  private quickZap: boolean = false
  private accountFeedInfoMap: Record<string, TFeedInfo | undefined> = {}
  private mediaUploadService: string = DEFAULT_NIP_96_SERVICE
  private autoplay: boolean = true
  private videoLoop: boolean = false
  private translationServiceConfigMap: Record<string, TTranslationServiceConfig> = {}
  private mediaUploadServiceConfigMap: Record<string, TMediaUploadServiceConfig> = {}
  private dismissedTooManyRelaysAlert: boolean = false
  private showKinds: number[] = []
  private showKindsMap: Record<string, number[]> = {}
  private hideContentMentioningMutedUsers: boolean = false
  private notificationListStyle: TNotificationStyle = NOTIFICATION_LIST_STYLE.DETAILED
  private density: 'compact' | 'comfortable' = 'compact'
  private deckLeadingGutter: boolean = false
  private mediaAutoLoadPolicy: TMediaAutoLoadPolicy = MEDIA_AUTO_LOAD_POLICY.ALWAYS
  private profilePictureAutoLoadPolicy: TProfilePictureAutoLoadPolicy =
    PROFILE_PICTURE_AUTO_LOAD_POLICY.ALWAYS
  private shownCreateWalletGuideToastPubkeys: Set<string> = new Set()
  private primaryColor: TPrimaryColor = 'DEFAULT'
  private faviconUrlTemplate: string = DEFAULT_FAVICON_URL_TEMPLATE
  private filterOutOnionRelays: boolean = !isTorBrowser()
  private allowInsecureConnection: boolean = false
  private quickReaction: boolean = false
  private quickReactionEmoji: string | TEmoji = '+'
  private nsfwDisplayPolicy: TNsfwDisplayPolicy = NSFW_DISPLAY_POLICY.HIDE_CONTENT
  private defaultRelayUrls: string[] = BIG_RELAY_URLS
  private searchRelayUrls: string[] = SEARCHABLE_RELAY_URLS
  private searchHistory: string[] = []
  private mutedWords: string[] = []
  private hideIndirectNotifications: boolean = false
  // Per-pubkey maps for fields that historically lived inline on TAccount.
  // Always the source of truth at runtime regardless of mode.
  private nsecByPubkey: Record<string, string> = {}
  private ncryptsecByPubkey: Record<string, string> = {}
  private bunkerClientSecretByPubkey: Record<string, string> = {}
  private secretsHydrated = false
  private disableNotificationSync: boolean = false
  private columns: TColumn[] = []
  private transientColumnMode: 'replace' | 'append' = 'replace'
  // Legacy v1 deck state — read at init() for migration into v2 workspaces.
  // v2's `workspacesByAccount` is the source of truth post-migration. These
  // legacy fields persist for the v1.1 cleanup pattern (rollback safety net
  // for one release).
  private decks: TDeckV1[] = []
  private activeDeckId: string = ''
  // Decks v2: per-account-workspaces state. `workspacesByAccount` keys on paired
  // pubkey; `activeAccountPubkey` is the Option A mutable login pubkey.
  private workspacesByAccount: TWorkspacesByAccount = {}
  private activeAccountPubkey: string | null = null
  // Decks v2 NIP-78 sync: per-pubkey created_at of the remote event our local
  // workspace currently corresponds to. Drives the staleness guard.
  private deckSyncMeta: TDeckSyncMeta = {}

  constructor() {
    if (!LocalStorageService.instance) {
      this.init()
      LocalStorageService.instance = this
    }
    return LocalStorageService.instance
  }

  init() {
    window.localStorage.removeItem('minTrustScore')
    window.localStorage.removeItem('minTrustScoreMap')

    this.themeSetting =
      (window.localStorage.getItem(StorageKey.THEME_SETTING) as TThemeSetting) ?? 'dark'
    const storedPreset = window.localStorage.getItem(StorageKey.THEME_PRESET) as TThemePreset | null
    this.themePreset = storedPreset === 'modern' ? 'modern' : 'terminal'
    const accountsStr = window.localStorage.getItem(StorageKey.ACCOUNTS)
    this.accounts = accountsStr ? JSON.parse(accountsStr) : []
    const currentAccountStr = window.localStorage.getItem(StorageKey.CURRENT_ACCOUNT)
    this.currentAccount = currentAccountStr ? JSON.parse(currentAccountStr) : null

    // Peel any inline secrets out of accounts into per-pubkey maps so the
    // accessor surface is uniform. In Web mode these maps are still backed
    // by inline storage (re-attached on persistence). In Electron mode
    // hydrate() will discard these and reload from safeStorage.
    this.peelInlineSecrets()

    const lastReadNotificationTimeMapStr =
      window.localStorage.getItem(StorageKey.LAST_READ_NOTIFICATION_TIME_MAP) ?? '{}'
    this.lastReadNotificationTimeMap = JSON.parse(lastReadNotificationTimeMapStr)

    const readNotificationsMapStr =
      window.localStorage.getItem(StorageKey.READ_NOTIFICATIONS_MAP) ?? '{}'
    this.readNotificationsMap = JSON.parse(readNotificationsMapStr)

    const relaySetsStr = window.localStorage.getItem(StorageKey.RELAY_SETS)
    if (!relaySetsStr) {
      let relaySets: TRelaySet[] = []
      const legacyRelayGroupsStr = window.localStorage.getItem('relayGroups')
      if (legacyRelayGroupsStr) {
        const legacyRelayGroups = JSON.parse(legacyRelayGroupsStr)
        relaySets = legacyRelayGroups.map((group: any) => {
          return {
            id: randomString(),
            name: group.groupName,
            relayUrls: group.relayUrls
          }
        })
      }
      if (!relaySets.length) {
        relaySets = []
      }
      window.localStorage.setItem(StorageKey.RELAY_SETS, JSON.stringify(relaySets))
      this.relaySets = relaySets
    } else {
      this.relaySets = JSON.parse(relaySetsStr)
    }

    const defaultZapSatsStr = window.localStorage.getItem(StorageKey.DEFAULT_ZAP_SATS)
    if (defaultZapSatsStr) {
      const num = parseInt(defaultZapSatsStr)
      if (!isNaN(num)) {
        this.defaultZapSats = num
      }
    }
    this.defaultZapComment = window.localStorage.getItem(StorageKey.DEFAULT_ZAP_COMMENT) ?? 'Zap!'
    this.quickZap = window.localStorage.getItem(StorageKey.QUICK_ZAP) === 'true'

    const accountFeedInfoMapStr =
      window.localStorage.getItem(StorageKey.ACCOUNT_FEED_INFO_MAP) ?? '{}'
    this.accountFeedInfoMap = JSON.parse(accountFeedInfoMapStr)

    // deprecated
    this.mediaUploadService =
      window.localStorage.getItem(StorageKey.MEDIA_UPLOAD_SERVICE) ?? DEFAULT_NIP_96_SERVICE

    this.autoplay = window.localStorage.getItem(StorageKey.AUTOPLAY) !== 'false'
    this.videoLoop = window.localStorage.getItem(StorageKey.VIDEO_LOOP) === 'true'

    const translationServiceConfigMapStr = window.localStorage.getItem(
      StorageKey.TRANSLATION_SERVICE_CONFIG_MAP
    )
    if (translationServiceConfigMapStr) {
      this.translationServiceConfigMap = JSON.parse(translationServiceConfigMapStr)
    }

    const mediaUploadServiceConfigMapStr = window.localStorage.getItem(
      StorageKey.MEDIA_UPLOAD_SERVICE_CONFIG_MAP
    )
    if (mediaUploadServiceConfigMapStr) {
      this.mediaUploadServiceConfigMap = JSON.parse(mediaUploadServiceConfigMapStr)
    }

    // Migrate old boolean setting to new policy
    const nsfwDisplayPolicyStr = window.localStorage.getItem(StorageKey.NSFW_DISPLAY_POLICY)
    if (
      nsfwDisplayPolicyStr &&
      Object.values(NSFW_DISPLAY_POLICY).includes(nsfwDisplayPolicyStr as TNsfwDisplayPolicy)
    ) {
      this.nsfwDisplayPolicy = nsfwDisplayPolicyStr as TNsfwDisplayPolicy
    } else {
      // Migration: convert old boolean to new policy
      const defaultShowNsfwStr = window.localStorage.getItem(StorageKey.DEFAULT_SHOW_NSFW)
      this.nsfwDisplayPolicy =
        defaultShowNsfwStr === 'true' ? NSFW_DISPLAY_POLICY.SHOW : NSFW_DISPLAY_POLICY.HIDE_CONTENT
      window.localStorage.setItem(StorageKey.NSFW_DISPLAY_POLICY, this.nsfwDisplayPolicy)
    }

    this.dismissedTooManyRelaysAlert =
      window.localStorage.getItem(StorageKey.DISMISSED_TOO_MANY_RELAYS_ALERT) === 'true'

    const showKindsStr = window.localStorage.getItem(StorageKey.SHOW_KINDS)
    if (!showKindsStr) {
      this.showKinds = ALLOWED_FILTER_KINDS
    } else {
      const showKindsVersionStr = window.localStorage.getItem(StorageKey.SHOW_KINDS_VERSION)
      const showKindsVersion = showKindsVersionStr ? parseInt(showKindsVersionStr) : 0
      const showKindSet = new Set(JSON.parse(showKindsStr) as number[])
      if (showKindsVersion < 1) {
        showKindSet.add(ExtendedKind.VIDEO)
        showKindSet.add(ExtendedKind.SHORT_VIDEO)
      }
      if (showKindsVersion < 2 && showKindSet.has(ExtendedKind.VIDEO)) {
        showKindSet.add(ExtendedKind.ADDRESSABLE_NORMAL_VIDEO)
        showKindSet.add(ExtendedKind.ADDRESSABLE_SHORT_VIDEO)
      }
      if (showKindsVersion < 3 && showKindSet.has(24236)) {
        showKindSet.delete(24236) // remove typo kind
        showKindSet.add(ExtendedKind.ADDRESSABLE_SHORT_VIDEO)
      }
      if (showKindsVersion < 4 && showKindSet.has(kinds.Repost)) {
        showKindSet.add(kinds.GenericRepost)
      }
      this.showKinds = Array.from(showKindSet)
    }
    window.localStorage.setItem(StorageKey.SHOW_KINDS, JSON.stringify(this.showKinds))
    window.localStorage.setItem(StorageKey.SHOW_KINDS_VERSION, '4')

    const showKindsMapStr = window.localStorage.getItem(StorageKey.SHOW_KINDS_MAP)
    if (showKindsMapStr) {
      try {
        const map = JSON.parse(showKindsMapStr)
        if (typeof map === 'object' && map !== null) {
          this.showKindsMap = map
        }
      } catch {
        // ignore
      }
    }

    this.hideContentMentioningMutedUsers =
      window.localStorage.getItem(StorageKey.HIDE_CONTENT_MENTIONING_MUTED_USERS) === 'true'

    this.notificationListStyle =
      window.localStorage.getItem(StorageKey.NOTIFICATION_LIST_STYLE) ===
      NOTIFICATION_LIST_STYLE.COMPACT
        ? NOTIFICATION_LIST_STYLE.COMPACT
        : NOTIFICATION_LIST_STYLE.DETAILED

    this.density =
      window.localStorage.getItem(StorageKey.DENSITY) === 'comfortable' ? 'comfortable' : 'compact'

    this.deckLeadingGutter = window.localStorage.getItem(StorageKey.DECK_LEADING_GUTTER) === 'true'

    const mediaAutoLoadPolicy = window.localStorage.getItem(StorageKey.MEDIA_AUTO_LOAD_POLICY)
    if (
      mediaAutoLoadPolicy &&
      Object.values(MEDIA_AUTO_LOAD_POLICY).includes(mediaAutoLoadPolicy as TMediaAutoLoadPolicy)
    ) {
      this.mediaAutoLoadPolicy = mediaAutoLoadPolicy as TMediaAutoLoadPolicy
    }

    const profilePictureAutoLoadPolicy = window.localStorage.getItem(
      StorageKey.PROFILE_PICTURE_AUTO_LOAD_POLICY
    )
    if (profilePictureAutoLoadPolicy) {
      // Migrate wifi-only to never
      const policy =
        profilePictureAutoLoadPolicy === 'wifi-only'
          ? PROFILE_PICTURE_AUTO_LOAD_POLICY.NEVER
          : profilePictureAutoLoadPolicy
      if (
        Object.values(PROFILE_PICTURE_AUTO_LOAD_POLICY).includes(
          policy as TProfilePictureAutoLoadPolicy
        )
      ) {
        this.profilePictureAutoLoadPolicy = policy as TProfilePictureAutoLoadPolicy
        if (profilePictureAutoLoadPolicy === 'wifi-only') {
          window.localStorage.setItem(StorageKey.PROFILE_PICTURE_AUTO_LOAD_POLICY, policy)
        }
      }
    }

    const shownCreateWalletGuideToastPubkeysStr = window.localStorage.getItem(
      StorageKey.SHOWN_CREATE_WALLET_GUIDE_TOAST_PUBKEYS
    )
    this.shownCreateWalletGuideToastPubkeys = shownCreateWalletGuideToastPubkeysStr
      ? new Set(JSON.parse(shownCreateWalletGuideToastPubkeysStr))
      : new Set()

    this.primaryColor =
      (window.localStorage.getItem(StorageKey.PRIMARY_COLOR) as TPrimaryColor) ?? 'DEFAULT'

    this.faviconUrlTemplate =
      window.localStorage.getItem(StorageKey.FAVICON_URL_TEMPLATE) ?? DEFAULT_FAVICON_URL_TEMPLATE

    const filterOutOnionRelaysStr = window.localStorage.getItem(StorageKey.FILTER_OUT_ONION_RELAYS)
    if (filterOutOnionRelaysStr) {
      this.filterOutOnionRelays = filterOutOnionRelaysStr !== 'false'
    }

    this.allowInsecureConnection =
      window.localStorage.getItem(StorageKey.ALLOW_INSECURE_CONNECTION) === 'true'

    this.quickReaction = window.localStorage.getItem(StorageKey.QUICK_REACTION) === 'true'
    const quickReactionEmojiStr =
      window.localStorage.getItem(StorageKey.QUICK_REACTION_EMOJI) ?? '+'
    if (quickReactionEmojiStr.startsWith('{')) {
      this.quickReactionEmoji = JSON.parse(quickReactionEmojiStr) as TEmoji
    } else {
      this.quickReactionEmoji = quickReactionEmojiStr
    }

    // One-time cleanup: DM feature removed. Drop orphan localStorage entries
    // from prior installs. Safe to leave indefinitely (re-runs on each load
    // are no-ops once keys are absent).
    for (const key of [
      'encryptionKeyPrivkeyMap',
      'clientKeyPrivkeyMap',
      'lastReadDmTimeMap',
      'dmLastSyncedAtMap',
      'dmBackwardCursorMap',
      'processedSyncRequestIds',
      'dmDeletedConversationsMap'
    ]) {
      window.localStorage.removeItem(key)
    }

    const defaultRelayUrlsStr = window.localStorage.getItem(StorageKey.DEFAULT_RELAY_URLS)
    if (defaultRelayUrlsStr) {
      try {
        const urls = JSON.parse(defaultRelayUrlsStr)
        if (
          Array.isArray(urls) &&
          urls.length > 0 &&
          urls.every((url) => typeof url === 'string')
        ) {
          this.defaultRelayUrls = urls
        }
      } catch {
        // Invalid JSON, use default
      }
    }

    const searchRelayUrlsStr = window.localStorage.getItem(StorageKey.SEARCH_RELAY_URLS)
    if (searchRelayUrlsStr) {
      try {
        const urls = JSON.parse(searchRelayUrlsStr)
        if (
          Array.isArray(urls) &&
          urls.length > 0 &&
          urls.every((url) => typeof url === 'string')
        ) {
          this.searchRelayUrls = urls
        }
      } catch {
        // Invalid JSON, use default
      }
    }

    const searchHistoryStr = window.localStorage.getItem(StorageKey.SEARCH_HISTORY)
    if (searchHistoryStr) {
      try {
        const history = JSON.parse(searchHistoryStr)
        if (Array.isArray(history)) {
          this.searchHistory = history
        }
      } catch {
        // ignore
      }
    }

    const mutedWordsStr = window.localStorage.getItem(StorageKey.MUTED_WORDS)
    if (mutedWordsStr) {
      try {
        const words = JSON.parse(mutedWordsStr)
        if (Array.isArray(words) && words.every((word) => typeof word === 'string')) {
          this.mutedWords = words
        }
      } catch {
        // Invalid JSON, use default
      }
    }

    const columnsStr = window.localStorage.getItem(StorageKey.COLUMNS)
    if (columnsStr) {
      try {
        // migrateColumns handles non-arrays (→ []), the legacy `accountId` →
        // `viewContext` + `signingIdentity` split, the 'mentions' type rename,
        // and per-entry deep-validation.
        this.columns = migrateColumns(JSON.parse(columnsStr))
      } catch {
        // Invalid JSON, fall back to empty list
      }
    }

    // Decks v1: wrap columns in a TDeck. Runs after migrateColumns so the
    // initial deck's `columns` field is the already-validated TColumn[].
    const decksStr = window.localStorage.getItem(StorageKey.DECKS)
    const activeDeckIdStr = window.localStorage.getItem(StorageKey.ACTIVE_DECK_ID)
    let rawDecks: unknown = null
    if (decksStr) {
      try {
        rawDecks = JSON.parse(decksStr)
      } catch {
        // Invalid JSON, fall through to migration path
      }
    }
    const accountPubkeys = this.accounts.map((a) => a.pubkey)
    const migration = migrateDecks(rawDecks, activeDeckIdStr, this.columns, accountPubkeys)
    this.decks = migration.decks
    this.activeDeckId = migration.activeDeckId
    if (migration.migrated) {
      window.localStorage.setItem(StorageKey.DECKS, JSON.stringify(this.decks))
      window.localStorage.setItem(StorageKey.ACTIVE_DECK_ID, this.activeDeckId)
    }

    // Decks v2: split flat decks into per-account-workspaces. If v2 state is
    // already present (workspacesByAccount key), use it directly. Otherwise
    // migrate from the v1 `decks` we just hydrated above.
    const workspacesByAccountStr = window.localStorage.getItem(StorageKey.WORKSPACES_BY_ACCOUNT)
    let rawWorkspacesByAccount: TWorkspacesByAccount | null = null
    if (workspacesByAccountStr) {
      try {
        const parsed = JSON.parse(workspacesByAccountStr)
        if (parsed && typeof parsed === 'object') {
          rawWorkspacesByAccount = parsed as TWorkspacesByAccount
        }
      } catch {
        // Invalid JSON; fall through to migration from v1.
      }
    }

    // Read the v2 active-account pubkey (Option A — mutable login pubkey).
    // Read before the migration so the migration helper has it.
    const rawActiveAccountPubkey =
      window.localStorage.getItem(StorageKey.ACTIVE_ACCOUNT_PUBKEY) ?? this.accounts[0]?.pubkey ?? null

    if (rawWorkspacesByAccount) {
      // v2 state already present — use it directly.
      this.workspacesByAccount = rawWorkspacesByAccount
    } else {
      // No v2 state — migrate from v1.
      const v2Migration = migrateWorkspacesByAccount(
        this.decks,
        accountPubkeys,
        rawActiveAccountPubkey
      )
      this.workspacesByAccount = v2Migration.workspacesByAccount
      if (v2Migration.migrated) {
        window.localStorage.setItem(
          StorageKey.WORKSPACES_BY_ACCOUNT,
          JSON.stringify(this.workspacesByAccount)
        )
      }
    }
    // Note: legacy StorageKey.DECKS + StorageKey.ACTIVE_DECK_ID deliberately
    // retained as rollback safety net for one release. Remove in a v2.1 follow-up.

    // Persist the resolved active-account pubkey (Option A — mutable login
    // pubkey). The fallback to accounts[0] is kept for backwards-compat with
    // installs that have accounts but no explicit active-pubkey key.
    this.activeAccountPubkey = rawActiveAccountPubkey

    const rawDeckSyncMeta = window.localStorage.getItem(StorageKey.DECK_SYNC_META)
    this.deckSyncMeta = rawDeckSyncMeta ? JSON.parse(rawDeckSyncMeta) : {}

    const transientModeStr = window.localStorage.getItem(StorageKey.TRANSIENT_COLUMN_MODE)
    if (transientModeStr === 'replace' || transientModeStr === 'append') {
      this.transientColumnMode = transientModeStr
    }

    this.hideIndirectNotifications =
      window.localStorage.getItem(StorageKey.HIDE_INDIRECT_NOTIFICATIONS) === 'true'

    this.disableNotificationSync =
      window.localStorage.getItem(StorageKey.DISABLE_NOTIFICATION_SYNC) === 'true'

    // Clean up deprecated data
    window.localStorage.removeItem(StorageKey.PINNED_PUBKEYS)
    window.localStorage.removeItem(StorageKey.ACCOUNT_PROFILE_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_FOLLOW_LIST_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_RELAY_LIST_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_MUTE_LIST_EVENT_MAP)
    window.localStorage.removeItem(StorageKey.ACCOUNT_MUTE_DECRYPTED_TAGS_MAP)
    window.localStorage.removeItem(StorageKey.ACTIVE_RELAY_SET_ID)
    window.localStorage.removeItem(StorageKey.FEED_TYPE)
    window.localStorage.removeItem(StorageKey.ENABLE_LIVE_FEED)
    // Decks v1.1 cleanup: legacy COLUMNS key has been read above and wrapped
    // into a TDeck. The v1 rollback safety net is no longer needed.
    window.localStorage.removeItem(StorageKey.COLUMNS)
  }

  getRelaySets() {
    return this.relaySets
  }

  setRelaySets(relaySets: TRelaySet[]) {
    this.relaySets = relaySets
    window.localStorage.setItem(StorageKey.RELAY_SETS, JSON.stringify(this.relaySets))
  }

  getThemeSetting() {
    return this.themeSetting
  }

  setThemeSetting(themeSetting: TThemeSetting) {
    window.localStorage.setItem(StorageKey.THEME_SETTING, themeSetting)
    this.themeSetting = themeSetting
  }

  getThemePreset() {
    return this.themePreset
  }

  setThemePreset(preset: TThemePreset) {
    window.localStorage.setItem(StorageKey.THEME_PRESET, preset)
    this.themePreset = preset
  }

  // getNoteListMode() {
  //   return this.noteListMode
  // }

  // setNoteListMode(mode: string) {
  //   window.localStorage.setItem(StorageKey.NOTE_LIST_MODE, mode)
  //   this.noteListMode = mode
  // }

  async hydrate(): Promise<void> {
    if (this.secretsHydrated) return
    this.secretsHydrated = true
    // Web-only fork: secrets live inline in localStorage; no IPC hydration.
  }

  /**
   * Pulls inline nsec/ncryptsec/bunkerClientSecretKey out of the accounts
   * array (and currentAccount) and into per-pubkey maps. Idempotent.
   */
  private peelInlineSecrets() {
    for (const act of this.accounts) {
      if (act.nsec) this.nsecByPubkey[act.pubkey] = act.nsec
      if (act.ncryptsec) this.ncryptsecByPubkey[act.pubkey] = act.ncryptsec
      if (act.bunkerClientSecretKey) {
        this.bunkerClientSecretByPubkey[act.pubkey] = act.bunkerClientSecretKey
      }
    }
    if (this.currentAccount) {
      const act = this.currentAccount
      if (act.nsec) this.nsecByPubkey[act.pubkey] = act.nsec
      if (act.ncryptsec) this.ncryptsecByPubkey[act.pubkey] = act.ncryptsec
      if (act.bunkerClientSecretKey) {
        this.bunkerClientSecretByPubkey[act.pubkey] = act.bunkerClientSecretKey
      }
    }
  }

  /**
   * Returns a copy of the account with the per-pubkey secret fields re-attached.
   * Consumers receive accounts with secrets visible (back-compat); internal
   * state stores secrets in maps only.
   */
  private hydrateAccount(account: TAccount): TAccount {
    return {
      ...account,
      nsec: this.nsecByPubkey[account.pubkey] ?? account.nsec,
      ncryptsec: this.ncryptsecByPubkey[account.pubkey] ?? account.ncryptsec,
      bunkerClientSecretKey:
        this.bunkerClientSecretByPubkey[account.pubkey] ?? account.bunkerClientSecretKey
    }
  }

  private serializeAccount(account: TAccount): TAccount {
    return this.hydrateAccount(account)
  }

  private serializeAccounts(): TAccount[] {
    return this.accounts.map((a) => this.serializeAccount(a))
  }

  private persistAccountsToLocalStorage() {
    window.localStorage.setItem(StorageKey.ACCOUNTS, JSON.stringify(this.serializeAccounts()))
  }

  private persistCurrentAccountToLocalStorage() {
    if (this.currentAccount) {
      window.localStorage.setItem(
        StorageKey.CURRENT_ACCOUNT,
        JSON.stringify(this.serializeAccount(this.currentAccount))
      )
    } else {
      window.localStorage.removeItem(StorageKey.CURRENT_ACCOUNT)
    }
  }

  getAccounts() {
    return this.accounts.map((a) => this.hydrateAccount(a))
  }

  findAccount(account: TAccountPointer) {
    const found = this.accounts.find((act) => isSameAccount(act, account))
    return found ? this.hydrateAccount(found) : undefined
  }

  getCurrentAccount() {
    return this.currentAccount ? this.hydrateAccount(this.currentAccount) : null
  }

  getAccountNsec(pubkey: string) {
    return this.nsecByPubkey[pubkey]
  }

  getAccountNcryptsec(pubkey: string) {
    return this.ncryptsecByPubkey[pubkey]
  }

  getBunkerClientSecretKey(pubkey: string) {
    return this.bunkerClientSecretByPubkey[pubkey]
  }

  addAccount(account: TAccount) {
    if (account.nsec) this.nsecByPubkey[account.pubkey] = account.nsec
    if (account.ncryptsec) this.ncryptsecByPubkey[account.pubkey] = account.ncryptsec
    if (account.bunkerClientSecretKey) {
      this.bunkerClientSecretByPubkey[account.pubkey] = account.bunkerClientSecretKey
    }

    // Internal accounts array stores stripped copies; we re-attach on read.
    const stripped: TAccount = { ...account }
    delete stripped.nsec
    delete stripped.ncryptsec
    delete stripped.bunkerClientSecretKey

    const index = this.accounts.findIndex((act) => isSameAccount(act, account))
    if (index !== -1) {
      this.accounts[index] = stripped
    } else {
      this.accounts.push(stripped)
    }
    this.persistAccountsToLocalStorage()
    return this.getAccounts()
  }

  removeAccount(account: TAccount) {
    this.accounts = this.accounts.filter((act) => !isSameAccount(act, account))
    if (isSameAccount(this.currentAccount, account)) {
      this.currentAccount = null
      this.persistCurrentAccountToLocalStorage()
    }
    delete this.nsecByPubkey[account.pubkey]
    delete this.ncryptsecByPubkey[account.pubkey]
    delete this.bunkerClientSecretByPubkey[account.pubkey]
    this.persistAccountsToLocalStorage()
    return this.getAccounts()
  }

  /**
   * Sign-out-only bulk teardown. Clears every paired account, its cached
   * secrets, and the current/active account pointers — but deliberately
   * PRESERVES `workspacesByAccount` workspaces so a later re-pair re-hydrates
   * each account's decks (matches single-account logout, which also leaves
   * workspaces dormant rather than deleting them).
   */
  removeAllAccounts() {
    this.accounts = []
    this.currentAccount = null
    this.persistCurrentAccountToLocalStorage()
    this.nsecByPubkey = {}
    this.ncryptsecByPubkey = {}
    this.bunkerClientSecretByPubkey = {}
    this.persistAccountsToLocalStorage()
    this.setActiveAccountPubkey(null)
  }

  switchAccount(account: TAccount | null) {
    if (!account) {
      return
    }
    const act = this.accounts.find((a) => isSameAccount(a, account))
    if (!act) {
      return
    }
    this.currentAccount = act
    this.persistCurrentAccountToLocalStorage()
  }

  getDefaultZapSats() {
    return this.defaultZapSats
  }

  setDefaultZapSats(sats: number) {
    this.defaultZapSats = sats
    window.localStorage.setItem(StorageKey.DEFAULT_ZAP_SATS, sats.toString())
  }

  getDefaultZapComment() {
    return this.defaultZapComment
  }

  setDefaultZapComment(comment: string) {
    this.defaultZapComment = comment
    window.localStorage.setItem(StorageKey.DEFAULT_ZAP_COMMENT, comment)
  }

  getQuickZap() {
    return this.quickZap
  }

  setQuickZap(quickZap: boolean) {
    this.quickZap = quickZap
    window.localStorage.setItem(StorageKey.QUICK_ZAP, quickZap.toString())
  }

  getLastReadNotificationTime(pubkey: string) {
    return this.lastReadNotificationTimeMap[pubkey] ?? 0
  }

  setLastReadNotificationTime(pubkey: string, time: number) {
    this.lastReadNotificationTimeMap[pubkey] = time
    window.localStorage.setItem(
      StorageKey.LAST_READ_NOTIFICATION_TIME_MAP,
      JSON.stringify(this.lastReadNotificationTimeMap)
    )
  }

  getReadNotifications(pubkey: string): string[] {
    return this.readNotificationsMap[pubkey] ?? []
  }

  setReadNotifications(pubkey: string, ids: string[]) {
    this.readNotificationsMap[pubkey] = ids
    window.localStorage.setItem(
      StorageKey.READ_NOTIFICATIONS_MAP,
      JSON.stringify(this.readNotificationsMap)
    )
  }

  getFeedInfo(pubkey: string) {
    return this.accountFeedInfoMap[pubkey]
  }

  setFeedInfo(info: TFeedInfo, pubkey?: string | null) {
    this.accountFeedInfoMap[pubkey ?? 'default'] = info
    window.localStorage.setItem(
      StorageKey.ACCOUNT_FEED_INFO_MAP,
      JSON.stringify(this.accountFeedInfoMap)
    )
  }

  getAutoplay() {
    return this.autoplay
  }

  setAutoplay(autoplay: boolean) {
    this.autoplay = autoplay
    window.localStorage.setItem(StorageKey.AUTOPLAY, autoplay.toString())
  }

  getVideoLoop() {
    return this.videoLoop
  }

  setVideoLoop(videoLoop: boolean) {
    this.videoLoop = videoLoop
    window.localStorage.setItem(StorageKey.VIDEO_LOOP, videoLoop.toString())
  }

  getTranslationServiceConfig(pubkey?: string | null) {
    return this.translationServiceConfigMap[pubkey ?? '_'] ?? { service: 'jumble' }
  }

  setTranslationServiceConfig(config: TTranslationServiceConfig, pubkey?: string | null) {
    this.translationServiceConfigMap[pubkey ?? '_'] = config
    window.localStorage.setItem(
      StorageKey.TRANSLATION_SERVICE_CONFIG_MAP,
      JSON.stringify(this.translationServiceConfigMap)
    )
  }

  getMediaUploadServiceConfig(pubkey?: string | null): TMediaUploadServiceConfig {
    const defaultConfig = { type: 'nip96', service: this.mediaUploadService } as const
    if (!pubkey) {
      return defaultConfig
    }
    return this.mediaUploadServiceConfigMap[pubkey] ?? defaultConfig
  }

  setMediaUploadServiceConfig(
    pubkey: string,
    config: TMediaUploadServiceConfig
  ): TMediaUploadServiceConfig {
    this.mediaUploadServiceConfigMap[pubkey] = config
    window.localStorage.setItem(
      StorageKey.MEDIA_UPLOAD_SERVICE_CONFIG_MAP,
      JSON.stringify(this.mediaUploadServiceConfigMap)
    )
    return config
  }

  getDismissedTooManyRelaysAlert() {
    return this.dismissedTooManyRelaysAlert
  }

  setDismissedTooManyRelaysAlert(dismissed: boolean) {
    this.dismissedTooManyRelaysAlert = dismissed
    window.localStorage.setItem(StorageKey.DISMISSED_TOO_MANY_RELAYS_ALERT, dismissed.toString())
  }

  getShowKinds() {
    return this.showKinds
  }

  setShowKinds(kinds: number[]) {
    this.showKinds = kinds
    window.localStorage.setItem(StorageKey.SHOW_KINDS, JSON.stringify(kinds))
  }

  getShowKindsMap() {
    return this.showKindsMap
  }

  getShowKindsForFeed(feedId: string): number[] {
    return this.showKindsMap[feedId] ?? this.showKinds
  }

  setShowKindsForFeed(feedId: string, kinds: number[]) {
    this.showKindsMap = { ...this.showKindsMap, [feedId]: kinds }
    window.localStorage.setItem(StorageKey.SHOW_KINDS_MAP, JSON.stringify(this.showKindsMap))
  }

  clearShowKindsForFeed(feedId: string) {
    const { [feedId]: _, ...rest } = this.showKindsMap
    this.showKindsMap = rest
    window.localStorage.setItem(StorageKey.SHOW_KINDS_MAP, JSON.stringify(this.showKindsMap))
  }

  getHideContentMentioningMutedUsers() {
    return this.hideContentMentioningMutedUsers
  }

  setHideContentMentioningMutedUsers(hide: boolean) {
    this.hideContentMentioningMutedUsers = hide
    window.localStorage.setItem(StorageKey.HIDE_CONTENT_MENTIONING_MUTED_USERS, hide.toString())
  }

  getNotificationListStyle() {
    return this.notificationListStyle
  }

  setNotificationListStyle(style: TNotificationStyle) {
    this.notificationListStyle = style
    window.localStorage.setItem(StorageKey.NOTIFICATION_LIST_STYLE, style)
  }

  getDensity() {
    return this.density
  }

  setDensity(density: 'compact' | 'comfortable') {
    this.density = density
    window.localStorage.setItem(StorageKey.DENSITY, density)
  }

  getDeckLeadingGutter() {
    return this.deckLeadingGutter
  }

  setDeckLeadingGutter(enabled: boolean) {
    this.deckLeadingGutter = enabled
    window.localStorage.setItem(StorageKey.DECK_LEADING_GUTTER, String(enabled))
  }

  getMediaAutoLoadPolicy() {
    return this.mediaAutoLoadPolicy
  }

  setMediaAutoLoadPolicy(policy: TMediaAutoLoadPolicy) {
    this.mediaAutoLoadPolicy = policy
    window.localStorage.setItem(StorageKey.MEDIA_AUTO_LOAD_POLICY, policy)
  }

  getProfilePictureAutoLoadPolicy() {
    return this.profilePictureAutoLoadPolicy
  }

  setProfilePictureAutoLoadPolicy(policy: TProfilePictureAutoLoadPolicy) {
    this.profilePictureAutoLoadPolicy = policy
    window.localStorage.setItem(StorageKey.PROFILE_PICTURE_AUTO_LOAD_POLICY, policy)
  }

  hasShownCreateWalletGuideToast(pubkey: string) {
    return this.shownCreateWalletGuideToastPubkeys.has(pubkey)
  }

  markCreateWalletGuideToastAsShown(pubkey: string) {
    if (this.shownCreateWalletGuideToastPubkeys.has(pubkey)) {
      return
    }
    this.shownCreateWalletGuideToastPubkeys.add(pubkey)
    window.localStorage.setItem(
      StorageKey.SHOWN_CREATE_WALLET_GUIDE_TOAST_PUBKEYS,
      JSON.stringify(Array.from(this.shownCreateWalletGuideToastPubkeys))
    )
  }

  getPrimaryColor() {
    return this.primaryColor
  }

  setPrimaryColor(color: TPrimaryColor) {
    this.primaryColor = color
    window.localStorage.setItem(StorageKey.PRIMARY_COLOR, color)
  }

  getFaviconUrlTemplate() {
    return this.faviconUrlTemplate
  }

  setFaviconUrlTemplate(template: string) {
    this.faviconUrlTemplate = template
    window.localStorage.setItem(StorageKey.FAVICON_URL_TEMPLATE, template)
  }

  getFilterOutOnionRelays() {
    return this.filterOutOnionRelays
  }

  setFilterOutOnionRelays(filterOut: boolean) {
    this.filterOutOnionRelays = filterOut
    window.localStorage.setItem(StorageKey.FILTER_OUT_ONION_RELAYS, filterOut.toString())
  }

  getAllowInsecureConnection() {
    return this.allowInsecureConnection
  }

  setAllowInsecureConnection(allow: boolean) {
    this.allowInsecureConnection = allow
    window.localStorage.setItem(StorageKey.ALLOW_INSECURE_CONNECTION, allow.toString())
  }

  getQuickReaction() {
    return this.quickReaction
  }

  setQuickReaction(quickReaction: boolean) {
    this.quickReaction = quickReaction
    window.localStorage.setItem(StorageKey.QUICK_REACTION, quickReaction.toString())
  }

  getQuickReactionEmoji() {
    return this.quickReactionEmoji
  }

  setQuickReactionEmoji(emoji: string | TEmoji) {
    this.quickReactionEmoji = emoji
    window.localStorage.setItem(
      StorageKey.QUICK_REACTION_EMOJI,
      typeof emoji === 'string' ? emoji : JSON.stringify(emoji)
    )
  }

  getNsfwDisplayPolicy() {
    return this.nsfwDisplayPolicy
  }

  setNsfwDisplayPolicy(policy: TNsfwDisplayPolicy) {
    this.nsfwDisplayPolicy = policy
    window.localStorage.setItem(StorageKey.NSFW_DISPLAY_POLICY, policy)
  }

  getDefaultRelayUrls() {
    return this.defaultRelayUrls
  }

  setDefaultRelayUrls(urls: string[]) {
    this.defaultRelayUrls = urls
    window.localStorage.setItem(StorageKey.DEFAULT_RELAY_URLS, JSON.stringify(urls))
  }

  getSearchRelayUrls() {
    return this.searchRelayUrls
  }

  setSearchRelayUrls(urls: string[]) {
    this.searchRelayUrls = urls
    window.localStorage.setItem(StorageKey.SEARCH_RELAY_URLS, JSON.stringify(urls))
  }

  getSearchHistory() {
    return this.searchHistory
  }

  addSearchHistory(text: string) {
    if (!text) return
    this.searchHistory = [text, ...this.searchHistory.filter((h) => h !== text)].slice(0, 20)
    window.localStorage.setItem(StorageKey.SEARCH_HISTORY, JSON.stringify(this.searchHistory))
  }

  removeSearchHistory(index: number) {
    this.searchHistory = this.searchHistory.filter((_, i) => i !== index)
    window.localStorage.setItem(StorageKey.SEARCH_HISTORY, JSON.stringify(this.searchHistory))
  }

  clearSearchHistory() {
    this.searchHistory = []
    window.localStorage.removeItem(StorageKey.SEARCH_HISTORY)
  }

  getMutedWords() {
    return this.mutedWords
  }

  setMutedWords(words: string[]) {
    this.mutedWords = words
    window.localStorage.setItem(StorageKey.MUTED_WORDS, JSON.stringify(this.mutedWords))
  }

  // Backwards-compat shim — auto-routes through the active workspace's active
  // deck. Retain one release; remove in v2.1 after a deprecation audit.
  getColumns(): TColumn[] {
    return this.getActiveDeck()?.columns ?? []
  }

  setColumns(columns: TColumn[]): void {
    this.setActiveDeckColumns(columns)
  }

  // ──────────────────────────────────────────────────────────────────
  // Decks v2 — per-account-workspace + active-deck accessors.
  // ──────────────────────────────────────────────────────────────────

  getWorkspacesByAccount(): TWorkspacesByAccount {
    return this.workspacesByAccount
  }

  setWorkspacesByAccount(map: TWorkspacesByAccount): void {
    this.workspacesByAccount = map
    window.localStorage.setItem(
      StorageKey.WORKSPACES_BY_ACCOUNT,
      JSON.stringify(this.workspacesByAccount)
    )
  }

  getActiveWorkspace(pubkey?: string): TAccountWorkspace | null {
    const key = pubkey ?? this.activeAccountPubkey
    if (!key) return null
    return this.workspacesByAccount[key] ?? null
  }

  getDecksForAccount(pubkey: string): TDeck[] {
    return this.workspacesByAccount[pubkey]?.decks ?? []
  }

  getActiveDeckId(pubkey?: string): string | null {
    return this.getActiveWorkspace(pubkey)?.activeDeckId ?? null
  }

  setActiveDeckIdForAccount(pubkey: string, deckId: string): void {
    const workspace = this.workspacesByAccount[pubkey]
    if (!workspace) return
    if (!workspace.decks.some((d) => d.id === deckId)) return
    this.workspacesByAccount = {
      ...this.workspacesByAccount,
      [pubkey]: { ...workspace, activeDeckId: deckId }
    }
    window.localStorage.setItem(
      StorageKey.WORKSPACES_BY_ACCOUNT,
      JSON.stringify(this.workspacesByAccount)
    )
  }

  getActiveAccountPubkey(): string | null {
    return this.activeAccountPubkey
  }

  setActiveAccountPubkey(pubkey: string | null): void {
    this.activeAccountPubkey = pubkey
    if (pubkey === null) {
      window.localStorage.removeItem(StorageKey.ACTIVE_ACCOUNT_PUBKEY)
    } else {
      window.localStorage.setItem(StorageKey.ACTIVE_ACCOUNT_PUBKEY, pubkey)
    }
  }

  ensureWorkspaceForAccount(pubkey: string, initialDecks: TDeck[]): void {
    if (this.workspacesByAccount[pubkey]) return
    if (initialDecks.length === 0) return // skip empty seed
    this.workspacesByAccount = {
      ...this.workspacesByAccount,
      [pubkey]: { activeDeckId: initialDecks[0].id, decks: initialDecks }
    }
    window.localStorage.setItem(
      StorageKey.WORKSPACES_BY_ACCOUNT,
      JSON.stringify(this.workspacesByAccount)
    )
  }

  removeWorkspaceForAccount(pubkey: string): void {
    if (!this.workspacesByAccount[pubkey]) return
    const next = { ...this.workspacesByAccount }
    delete next[pubkey]
    this.workspacesByAccount = next
    window.localStorage.setItem(
      StorageKey.WORKSPACES_BY_ACCOUNT,
      JSON.stringify(this.workspacesByAccount)
    )
  }

  /**
   * Returns the active workspace's active deck, or null when no active account
   * is set or its workspace has no active deck. The v1 single-deck
   * `getActiveDeck()` is retired; the v1 `decks` localStorage key is still
   * read at init() but runtime code paths only touch v2 workspaces.
   */
  getActiveDeck(): TDeck | null {
    const workspace = this.getActiveWorkspace()
    if (!workspace) return null
    return workspace.decks.find((d) => d.id === workspace.activeDeckId) ?? null
  }

  /**
   * Auto-route: persist `columns` into the active workspace's active deck.
   * Bumps `updatedAt`. Used by the backwards-compat `setColumns` shim and by
   * direct v2 callers.
   */
  setActiveDeckColumns(columns: TColumn[]): void {
    const pubkey = this.activeAccountPubkey
    if (!pubkey) return
    const workspace = this.workspacesByAccount[pubkey]
    if (!workspace) return
    const idx = workspace.decks.findIndex((d) => d.id === workspace.activeDeckId)
    if (idx < 0) return
    const nextDecks = workspace.decks.map((d, i) =>
      i === idx ? { ...d, columns, updatedAt: Date.now() } : d
    )
    this.workspacesByAccount = {
      ...this.workspacesByAccount,
      [pubkey]: { ...workspace, decks: nextDecks }
    }
    window.localStorage.setItem(
      StorageKey.WORKSPACES_BY_ACCOUNT,
      JSON.stringify(this.workspacesByAccount)
    )
  }

  getDeckSyncAppliedCreatedAt(pubkey: string): number | null {
    return this.deckSyncMeta[pubkey]?.lastAppliedCreatedAt ?? null
  }

  setDeckSyncAppliedCreatedAt(pubkey: string, createdAt: number): void {
    this.deckSyncMeta = {
      ...this.deckSyncMeta,
      [pubkey]: { lastAppliedCreatedAt: createdAt }
    }
    window.localStorage.setItem(StorageKey.DECK_SYNC_META, JSON.stringify(this.deckSyncMeta))
  }

  /** Dirty check for an arbitrary deck by id (public companion to isActiveDeckDirty). */
  isDeckDirtyById(pubkey: string, deckId: string): boolean {
    const deck = this.workspacesByAccount[pubkey]?.decks.find((d) => d.id === deckId)
    if (!deck) return false
    const live = deck.columns.filter((c) => !c.transient)
    const saved = deck.savedColumns.filter((c) => !c.transient)
    return JSON.stringify(live) !== JSON.stringify(saved)
  }

  // ──────────────────────────────────────────────────────────────────
  // Decks v2 — deck mutations + dirty-state predicates.
  // All mutations auto-persist; pure functions never assume an active workspace
  // (mutateActiveWorkspace no-ops gracefully when none exists).
  // ──────────────────────────────────────────────────────────────────

  /**
   * Internal helper. Applies `workspaceMutator` to the active workspace,
   * persists, and is a no-op when no active account / workspace is set. DRY
   * for all per-active-workspace mutations below.
   */
  private mutateActiveWorkspace(
    workspaceMutator: (workspace: TAccountWorkspace) => TAccountWorkspace
  ): void {
    const pubkey = this.activeAccountPubkey
    if (!pubkey) return
    const workspace = this.workspacesByAccount[pubkey]
    if (!workspace) return
    this.workspacesByAccount = {
      ...this.workspacesByAccount,
      [pubkey]: workspaceMutator(workspace)
    }
    window.localStorage.setItem(
      StorageKey.WORKSPACES_BY_ACCOUNT,
      JSON.stringify(this.workspacesByAccount)
    )
  }

  /** Copy `columns` → `savedColumns` for the active workspace's active deck. Bumps `lastSavedAt`. */
  saveActiveDeck(): void {
    this.mutateActiveWorkspace((workspace) => ({
      ...workspace,
      decks: workspace.decks.map((d) =>
        d.id === workspace.activeDeckId
          ? { ...d, savedColumns: [...d.columns], lastSavedAt: Date.now() }
          : d
      )
    }))
  }

  /** Revert `columns` to `savedColumns` for the active workspace's active deck. Bumps `updatedAt`. */
  discardActiveDeckChanges(): void {
    this.mutateActiveWorkspace((workspace) => ({
      ...workspace,
      decks: workspace.decks.map((d) =>
        d.id === workspace.activeDeckId
          ? { ...d, columns: [...d.savedColumns], updatedAt: Date.now() }
          : d
      )
    }))
  }

  /**
   * Save-as: clone the active deck's live columns into a new deck in the same
   * workspace. Both `columns` and `savedColumns` are a snapshot of current
   * live `columns` (the new deck starts clean). Switches active to the new
   * deck.
   */
  saveActiveDeckAs(input: { name: string }): void {
    this.mutateActiveWorkspace((workspace) => {
      const source = workspace.decks.find((d) => d.id === workspace.activeDeckId)
      if (!source) return workspace
      const now = Date.now()
      const newDeck: TDeck = {
        id: randomId(),
        name: input.name || 'Untitled deck',
        columns: [...source.columns],
        savedColumns: [...source.columns],
        createdAt: now,
        updatedAt: now,
        lastSavedAt: now
      }
      return {
        decks: [...workspace.decks, newDeck],
        activeDeckId: newDeck.id // switches active to new
      }
    })
  }

  /** Append an empty deck to the active workspace. Switches active to the new deck. */
  addEmptyDeck(input: { name?: string } = {}): void {
    this.mutateActiveWorkspace((workspace) => {
      const now = Date.now()
      const newDeck: TDeck = {
        id: randomId(),
        name: input.name || 'Untitled deck',
        columns: [],
        savedColumns: [],
        createdAt: now,
        updatedAt: now,
        lastSavedAt: now
      }
      return {
        decks: [...workspace.decks, newDeck],
        activeDeckId: newDeck.id
      }
    })
  }

  /** Rename a deck within the active workspace. Bumps `updatedAt`; doesn't touch `lastSavedAt`. */
  renameDeck(deckId: string, name: string): void {
    this.mutateActiveWorkspace((workspace) => ({
      ...workspace,
      decks: workspace.decks.map((d) =>
        d.id === deckId ? { ...d, name, updatedAt: Date.now() } : d
      )
    }))
  }

  /**
   * Duplicate a deck within the active workspace. New deck inherits the
   * source's `savedColumns` (not live `columns` — the duplicate starts at the
   * source's last saved state). Doesn't switch active.
   */
  duplicateDeck(deckId: string): void {
    this.mutateActiveWorkspace((workspace) => {
      const source = workspace.decks.find((d) => d.id === deckId)
      if (!source) return workspace
      const now = Date.now()
      const copy: TDeck = {
        id: randomId(),
        name: `${source.name} (copy)`,
        columns: [...source.savedColumns],
        savedColumns: [...source.savedColumns],
        createdAt: now,
        updatedAt: now,
        lastSavedAt: now
      }
      return { ...workspace, decks: [...workspace.decks, copy] }
    })
  }

  /**
   * Delete a deck from the active workspace. Last-deck guard: if the workspace
   * would be left empty, auto-creates an "Untitled deck" and switches active
   * to it. If the deleted deck was active, picks the next surviving deck
   * (clamped to the deleted index).
   */
  deleteDeck(deckId: string): void {
    this.mutateActiveWorkspace((workspace) => {
      const idx = workspace.decks.findIndex((d) => d.id === deckId)
      if (idx < 0) return workspace
      const nextDecks = workspace.decks.filter((d) => d.id !== deckId)
      // Last-deck guard.
      if (nextDecks.length === 0) {
        const now = Date.now()
        const untitled: TDeck = {
          id: randomId(),
          name: 'Untitled deck',
          columns: [],
          savedColumns: [],
          createdAt: now,
          updatedAt: now,
          lastSavedAt: now
        }
        return { decks: [untitled], activeDeckId: untitled.id }
      }
      let nextActiveId = workspace.activeDeckId
      if (workspace.activeDeckId === deckId) {
        nextActiveId = nextDecks[Math.min(idx, nextDecks.length - 1)].id
      }
      return { decks: nextDecks, activeDeckId: nextActiveId }
    })
  }

  /**
   * Dirty check: are the deck's live `columns` different from its
   * `savedColumns`? Transient columns are session-only chrome — they don't
   * contribute to dirty state.
   */
  private isDeckDirty(deck: TDeck): boolean {
    const live = deck.columns.filter((c) => !c.transient)
    const saved = deck.savedColumns.filter((c) => !c.transient)
    return JSON.stringify(live) !== JSON.stringify(saved)
  }

  /** True iff the active workspace's active deck has unsaved changes. */
  isActiveDeckDirty(): boolean {
    const deck = this.getActiveDeck()
    return deck ? this.isDeckDirty(deck) : false
  }

  /**
   * True iff ANY workspace's active deck has unsaved changes. Used by the
   * cross-workspace beforeunload guard so a dirty deck in an inactive account
   * still warns on tab-close.
   */
  isAnyWorkspaceDirty(): boolean {
    for (const workspace of Object.values(this.workspacesByAccount)) {
      const active = workspace.decks.find((d) => d.id === workspace.activeDeckId)
      if (active && this.isDeckDirty(active)) return true
    }
    return false
  }

  // ──────────────────────────────────────────────────────────────────
  // Legacy v1 deck accessors. RETIRED — kept as type-shimmed no-ops to
  // give v1 caller-sites a soft-landing during the v2 transition.
  // Remove in v2.1 alongside the legacy `decks` + `activeDeckId` keys.
  // ──────────────────────────────────────────────────────────────────

  /** @deprecated v1 only — read by `migrateDecks` test + init() shim. */
  getDecks(): TDeckV1[] {
    return this.decks
  }

  /** @deprecated v1 only — kept as a no-op for v1 callers. */
  setDecks(decks: TDeckV1[]): void {
    this.decks = decks
    window.localStorage.setItem(StorageKey.DECKS, JSON.stringify(this.decks))
  }

  /** @deprecated v1 only — use `setActiveDeckIdForAccount` under v2. */
  setActiveDeckId(id: string): void {
    if (!this.decks.some((d) => d.id === id)) return
    this.activeDeckId = id
    window.localStorage.setItem(StorageKey.ACTIVE_DECK_ID, id)
  }

  /**
   * @deprecated v1 only — owner is implicit via workspace in v2. No-op when
   * the active deck routes through v2's active workspace (the v2 TDeck has no
   * `ownerPubkey` field).
   */
  setActiveDeckOwnerPubkey(_pubkey: string): void {
    // No-op in v2. Callers should be retired during account-lifecycle audit.
  }

  getTransientColumnMode(): 'replace' | 'append' {
    return this.transientColumnMode
  }

  setTransientColumnMode(mode: 'replace' | 'append'): void {
    this.transientColumnMode = mode
    window.localStorage.setItem(StorageKey.TRANSIENT_COLUMN_MODE, mode)
  }

  getHideIndirectNotifications() {
    return this.hideIndirectNotifications
  }

  setHideIndirectNotifications(onlyShow: boolean) {
    this.hideIndirectNotifications = onlyShow
    window.localStorage.setItem(StorageKey.HIDE_INDIRECT_NOTIFICATIONS, onlyShow.toString())
  }

  getDisableNotificationSync() {
    return this.disableNotificationSync
  }

  setDisableNotificationSync(disable: boolean) {
    this.disableNotificationSync = disable
    window.localStorage.setItem(StorageKey.DISABLE_NOTIFICATION_SYNC, disable.toString())
  }
}

const instance = new LocalStorageService()
export default instance
