import followListService from '@/services/fetchers/follow-list.service'
import relatrTrust from '@/services/relatr-trust.service'
import { createContext, useCallback, useContext, useEffect } from 'react'
import { useNostr } from './NostrProvider'

type TUserTrustContext = {
  isUserTrusted: (pubkey: string) => boolean
  isSpammer: (pubkey: string) => Promise<boolean>
}

const UserTrustContext = createContext<TUserTrustContext | undefined>(undefined)

export const useUserTrust = () => {
  const context = useContext(UserTrustContext)
  if (!context) {
    throw new Error('useUserTrust must be used within a UserTrustProvider')
  }
  return context
}

const wotSet = new Set<string>()

export function UserTrustProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: currentPubkey } = useNostr()

  useEffect(() => {
    if (!currentPubkey) return

    const initWoT = async () => {
      const followings = await followListService.fetchFollowings(currentPubkey, false)
      followings.forEach((pubkey) => wotSet.add(pubkey))

      const batchSize = 20
      for (let i = 0; i < followings.length; i += batchSize) {
        const batch = followings.slice(i, i + batchSize)
        await Promise.allSettled(
          batch.map(async (pubkey) => {
            const _followings = await followListService.fetchFollowings(pubkey, false)
            _followings.forEach((following) => {
              wotSet.add(following)
            })
          })
        )
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
    initWoT()
  }, [currentPubkey])

  const isUserTrusted = useCallback(
    (pubkey: string) => {
      if (!currentPubkey || pubkey === currentPubkey) return true
      return wotSet.has(pubkey)
    },
    [currentPubkey]
  )

  const isSpammer = useCallback(
    async (pubkey: string) => {
      if (isUserTrusted(pubkey)) return false
      const rank = await relatrTrust.getRank(pubkey)
      if (rank === null) return false
      return rank < 60
    },
    [isUserTrusted]
  )

  return (
    <UserTrustContext.Provider value={{ isUserTrusted, isSpammer }}>
      {children}
    </UserTrustContext.Provider>
  )
}
