import { useSecondaryPage } from '@/DeckManager'
import { toRelay } from '@/lib/link'

export function EmbeddedWebsocketUrl({ url }: { url: string }) {
  const { push } = useSecondaryPage()
  return (
    <span
      className="text-primary hover:bg-primary/20 cursor-pointer px-1"
      onClick={(e) => {
        e.stopPropagation()
        push(toRelay(url))
      }}
    >
      [ {url} ]
      <span className="bg-primary h-1 w-2" />
    </span>
  )
}
