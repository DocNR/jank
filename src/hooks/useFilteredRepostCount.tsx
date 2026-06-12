import { useStuffStatsById } from './useStuffStatsById'

export function useFilteredRepostCount(stuffKey: string) {
  const noteStats = useStuffStatsById(stuffKey)
  return noteStats?.reposts?.length ?? 0
}
