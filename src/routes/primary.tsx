import { IS_COMMUNITY_MODE } from '@/constants'
import DeckHomePage from '@/pages/primary/DeckHomePage'
import FollowingPage from '@/pages/primary/FollowingPage'
import { TPageRef } from '@/types'
import { ComponentType, createRef, ForwardRefExoticComponent, RefAttributes } from 'react'

// Phase 2: the primary-route table shrinks to one entry. Every off-home
// destination retired in PR-B — Notifications / DMs / Profile / Bookmarks /
// Search / Relay / Me / Spike all became transient deck columns via
// addTransientColumn's route-dispatch. FollowingPage stays gated on
// IS_COMMUNITY_MODE for forks that enable a community feed.
type TRouteConfig = {
  key: string
  component:
    | ComponentType<RefAttributes<TPageRef>>
    | ForwardRefExoticComponent<RefAttributes<TPageRef>>
}

const PRIMARY_ROUTE_CONFIGS: readonly TRouteConfig[] = [
  { key: 'home', component: DeckHomePage },
  ...(IS_COMMUNITY_MODE ? [{ key: 'following', component: FollowingPage }] : [])
]

export const PRIMARY_PAGE_REF_MAP = PRIMARY_ROUTE_CONFIGS.reduce(
  (acc, { key }) => {
    acc[key] = createRef<TPageRef>()
    return acc
  },
  {} as Record<string, React.RefObject<TPageRef>>
)

export const PRIMARY_PAGE_MAP = PRIMARY_ROUTE_CONFIGS.reduce(
  (acc, { key, component: Component }) => {
    acc[key] = <Component ref={PRIMARY_PAGE_REF_MAP[key]} />
    return acc
  },
  {} as Record<string, JSX.Element>
)

export type TPrimaryPageName = string
