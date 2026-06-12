import { cn } from '@/lib/utils'
import HomeButton from './HomeButton'
import PostButton from './PostButton'

// WS2 shrunk the bar to Home + Post. Search/Messages/Notifications are deck
// columns now, not primary pages, so the icons no longer have a meaningful
// destination. The middle is reserved for the WS3 swipe page-dot indicator.
// BackgroundAudio moved to the unified shell's floating widget mount.
export default function BottomNavigationBar() {
  return (
    <div
      className={cn('bg-background fixed bottom-0 z-40 w-full border-t')}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}
    >
      <div className="flex w-full items-center justify-around [&_svg]:size-4 [&_svg]:shrink-0">
        <HomeButton />
        <PostButton />
      </div>
    </div>
  )
}
