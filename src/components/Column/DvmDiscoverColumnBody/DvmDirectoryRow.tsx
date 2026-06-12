import UserAvatar from '@/components/UserAvatar'
import { TDvmHandler, getDvmName } from '@/lib/dvm'

/**
 * One row in the DVM directory. Clicking the row spawns / focuses a dvm-feed
 * column pinned to this DVM (handled by parent — see DvmDiscoverColumnBody).
 *
 * The DVM's display info comes from its kind-31990 `content` metadata first
 * (NIP-89 advertises the human-readable name + about + picture there), with
 * UserAvatar's kind-0 fallback for the avatar tile.
 */
export default function DvmDirectoryRow({
  handler,
  onClick
}: {
  handler: TDvmHandler
  onClick: () => void
}) {
  const name = getDvmName(handler)
  const about = handler.metadata.about?.trim()

  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-muted/40 focus-visible:bg-muted/40 flex w-full items-start gap-3 px-3 py-3 text-start outline-hidden transition-colors"
    >
      <UserAvatar userId={handler.pubkey} size="normal" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium leading-tight" dir="auto">
          {name}
        </span>
        {about && (
          <span
            className="text-muted-foreground text-xs leading-snug line-clamp-2"
            dir="auto"
          >
            {about}
          </span>
        )}
      </div>
    </button>
  )
}
