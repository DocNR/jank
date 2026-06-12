import { useStuffStatsById } from './useStuffStatsById'

export function useFilteredLikeCount(stuffKey: string) {
  const noteStats = useStuffStatsById(stuffKey)
  return noteStats?.likes?.length ?? 0
}
