import { cn } from '@/lib/utils'
import NewColumnButton from './NewColumnButton'
import OverviewButton from './OverviewButton'
import PostButton from './PostButton'

// Overview (all columns) · New column · Compose. The middle is reserved for the
// WS3 swipe page-dot indicator. Search/Messages/Notifications are deck columns
// now, so they don't get bottom-bar icons.
export default function BottomNavigationBar() {
  return (
    <div
      className={cn('bg-background fixed bottom-0 z-40 w-full border-t')}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}
    >
      <div className="flex w-full items-center justify-around [&_svg]:size-4 [&_svg]:shrink-0">
        <OverviewButton />
        <NewColumnButton />
        <PostButton />
      </div>
    </div>
  )
}
