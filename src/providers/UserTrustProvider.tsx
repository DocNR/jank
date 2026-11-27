import { TRUST_SCORE_FILTER_ID } from '@/constants'
import { meetsTrustScore } from '@/lib/trust-score'
import followListService from '@/services/fetchers/follow-list.service'
import relatrTrust from '@/services/relatr-trust.service'
import storage from '@/services/local-storage.service'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useNostr } from './NostrProvider'

type TUserTrustContext = {
  isUserTrusted: (pubkey: string) => boolean
  isSpammer: (pubkey: string) => Promise<boolean>
  /** Global default trust-score filter threshold (0 = off). */
  minTrustScore: number
  /** Per-context overrides for non-column views (thread replies), keyed by
   *  TRUST_SCORE_FILTER_ID. Column feed thresholds live in column.config. */
  minTrustScoreMap: Record<string, number>
  getMinTrustScore: (id: string) => number
  updateMinTrustScore: (id: string, score: number) => void
  meetsMinTrustScore: (pubkey: string, minScore: number) => Promise<boolean>
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
  const [minTrustScore, setMinTrustScore] = useState(() => storage.getMinTrustScore())
  const [minTrustScoreMap, setMinTrustScoreMap] = useState<Record<string, number>>(() =>
    storage.getMinTrustScoreMap()
  )

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

  const getMinTrustScore = useCallback(
    (id: string) => {
      return id === TRUST_SCORE_FILTER_ID.DEFAULT
        ? minTrustScore
        : (minTrustScoreMap[id] ?? minTrustScore)
    },
    [minTrustScore, minTrustScoreMap]
  )

  const updateMinTrustScore = (id: string, score: number) => {
    if (score < 0 || score > 100) return

    if (id === TRUST_SCORE_FILTER_ID.DEFAULT) {
      setMinTrustScore(score)
      storage.setMinTrustScore(score)
    } else {
      const newMap = { ...minTrustScoreMap, [id]: score }
      setMinTrustScoreMap(newMap)
      storage.setMinTrustScoreMap(newMap)
    }
  }

  const meetsMinTrustScore = useCallback(
    async (pubkey: string, minScore: number) => {
      return meetsTrustScore(pubkey, currentPubkey, minScore, wotSet, (key) =>
        relatrTrust.getRank(key)
      )
    },
    [currentPubkey]
  )

  return (
    <UserTrustContext.Provider
      value={{
        isUserTrusted,
        isSpammer,
        minTrustScore,
        minTrustScoreMap,
        getMinTrustScore,
        updateMinTrustScore,
        meetsMinTrustScore
      }}
    >
      {children}
    </UserTrustContext.Provider>
  )
}
