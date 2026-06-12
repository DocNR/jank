// src/components/Column/ProfileColumnBody.tsx
import Profile from '@/components/Profile'
import { useAccountScope } from '@/providers/AccountScope'
import { ScopedUserListsProvider } from '@/providers/ScopedUserListsProvider'

/**
 * Body of a Profile column — the full <Profile> component (banner, bio, stats,
 * follow/zap/edit, tabbed feed) for the column's viewContext.
 *
 * Identity model: viewContext = the profile SUBJECT, signingIdentity = the
 * viewer/signer. But <Profile>'s chrome (Follow button, mute state, the
 * favorite-user toggle) is viewer-relative — it reads useFollowList / useMuteList /
 * useFavorites. The column's <AccountScope> scopes those to viewContext (the
 * subject), which would be wrong here. Re-wrap the subtree in
 * ScopedUserListsProvider re-scoped to the SIGNER so that chrome reads the
 * signer's lists. When there is no signer (view-only column) fall back to
 * viewContext — harmless, since that chrome is disabled without a signer.
 */
export default function ProfileColumnBody() {
  const { viewContext, signingIdentity } = useAccountScope()
  return (
    <ScopedUserListsProvider
      viewContext={signingIdentity ?? viewContext}
      signingIdentity={signingIdentity}
    >
      <Profile id={viewContext} />
    </ScopedUserListsProvider>
  )
}
