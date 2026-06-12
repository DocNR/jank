import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import profileFetcher from '@/services/profile-fetcher.service'
import { TProfile } from '@/types'
import { useEffect, useState } from 'react'

// Session-level profile cache. profileFetcher already has IndexedDB +
// DataLoader caching, but its load() returns a Promise that resolves on
// the next microtask even for cache hits. That left every avatar
// remount (virtualizer recycle) flashing through Skeleton for a frame.
// This Map gives useState a synchronous read so remounts render the
// avatar straight away.
const profileCache = new Map<string, TProfile>()

export function useFetchProfile(id?: string) {
  const { profile: currentAccountProfile } = useNostr()
  const [profile, setProfile] = useState<TProfile | null>(() =>
    id ? (profileCache.get(id) ?? null) : null
  )
  const [isFetching, setIsFetching] = useState(() => !(id && profileCache.has(id)))
  const [error, setError] = useState<Error | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)

  useEffect(() => {
    const cached = id ? profileCache.get(id) : undefined
    setProfile(cached ?? null)
    setPubkey(null)
    const fetchProfile = async () => {
      setIsFetching(!cached)
      try {
        if (!id) {
          setIsFetching(false)
          setError(new Error('No id provided'))
          return
        }

        const pubkey = userIdToPubkey(id)
        setPubkey(pubkey)
        const profile = await profileFetcher.fetchProfile(id)
        if (profile) {
          profileCache.set(id, profile)
          setProfile(profile)
        }
      } catch (err) {
        setError(err as Error)
      } finally {
        setIsFetching(false)
      }
    }

    fetchProfile()
  }, [id])

  useEffect(() => {
    if (currentAccountProfile && pubkey === currentAccountProfile.pubkey) {
      setProfile(currentAccountProfile)
    }
  }, [currentAccountProfile, pubkey])

  return { isFetching, error, profile }
}
