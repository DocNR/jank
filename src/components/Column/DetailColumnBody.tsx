// src/components/Column/DetailColumnBody.tsx
import { SECONDARY_ROUTES } from '@/routes/secondary'
import { TColumn } from '@/types/column'
import { TPageRef } from '@/types'
import { routeOpensOwnColumn } from '@/lib/link'
import { SecondaryPageContext, useSecondaryPage } from '@/DeckManager'
import { useColumns } from '@/providers/ColumnsProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import {
  cloneElement,
  createRef,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

type DetailStackItem = {
  url: string
  element: React.ReactElement
  ref: RefObject<TPageRef>
}

/** Build a stack item from a URL by matching against SECONDARY_ROUTES. Returns null if no route matches. */
function buildStackItem(url: string, index: number): DetailStackItem | null {
  const path = url.split('?')[0].split('#')[0]
  for (const { matcher, element } of SECONDARY_ROUTES) {
    const match = matcher(path)
    if (!match || !element) continue
    const ref = createRef<TPageRef>()
    return {
      url,
      element: cloneElement(element, { ...match.params, index, ref } as any),
      ref
    }
  }
  return null
}

/**
 * Body of a 'detail' column. Behavior depends on the user's transientColumnMode pref:
 *
 * - **replace mode**: detail-page clicks (note threads, following lists,
 *   settings, ...) drill within the column. Owns its own route stack; push
 *   appends, pop pops, all stack entries render with display:block|none for
 *   state preservation. At stack-bottom, back closes. Standing / content
 *   routes (Profile, Hashtag, Relay, Search, Notifications, Bookmarks) are
 *   column-shaped, so `replacePush` delegates them to the parent push to
 *   spawn/focus their own deck column instead of drilling inline — see
 *   `routeOpensOwnColumn`.
 *
 * - **append mode**: internal clicks spawn new transient columns (matching
 *   deck-level "Open as new column" semantics). Push defers to the parent
 *   SecondaryPageContext, which routes through DeckManager's deck-home
 *   interception → addTransientColumn → new column. Pop closes this column
 *   (since there's nothing to navigate back to within the column).
 *
 * External replace (column.config.route changes from outside) resets the
 * stack to a fresh single-item stack regardless of mode.
 */
export default function DetailColumnBody({ column }: { column: TColumn }) {
  const { t } = useTranslation()
  const { removeColumn } = useColumns()
  const { transientColumnMode } = useUserPreferences()
  const parentSecondaryPage = useSecondaryPage()
  const initialRoute = column.config?.route as string | undefined

  const [stack, setStack] = useState<DetailStackItem[]>(() => {
    if (!initialRoute) return []
    const item = buildStackItem(initialRoute, 0)
    return item ? [item] : []
  })

  // External replace: column's source route changed. Reset the stack to a
  // fresh single-item stack of the new route.
  //
  // Defensive: if buildStackItem returns null (no SECONDARY_ROUTE matches the
  // URL — e.g. a malformed cold-boot deep-link that fell through
  // addTransientColumn's route dispatch to 'detail') AND the stack is already
  // empty, do nothing. Without this guard the effect would `setStack([])`
  // every render (each `[]` literal is a new reference; the effect re-fires
  // on stack identity change → infinite update depth).
  useEffect(() => {
    if (!initialRoute) return
    if (stack[0]?.url === initialRoute) return
    const item = buildStackItem(initialRoute, 0)
    if (!item && stack.length === 0) return
    setStack(item ? [item] : [])
  }, [initialRoute, stack])

  // Close column when stack empties (replace-mode pop-past-bottom).
  useEffect(() => {
    if (initialRoute && stack.length === 0) {
      removeColumn(column.id)
    }
  }, [stack.length, initialRoute, column.id, removeColumn])

  // Replace-mode push. Standing / content routes (Profile, Hashtag, Relay,
  // Search, Notifications, Bookmarks, self-Profile) are column-shaped, not
  // detail-page-shaped: hand them to the parent push so they spawn (or focus,
  // via standing-type dedup) their own deck column. This also sidesteps a
  // silent-no-op trap — the inline SECONDARY_ROUTES table only knows the
  // LEGACY url forms (`/users/:id`, `/relays/:url`), so the canonical forms
  // the app emits today (`/p/<npub>`, `/t/<tag>`, `/r/<encoded>`) match
  // nothing there and `buildStackItem` would return null, dropping the click.
  // Everything else (note threads, following lists, settings, ...) drills
  // inline within this column's own stack.
  const replacePush = useCallback(
    (url: string) => {
      if (routeOpensOwnColumn(url)) {
        parentSecondaryPage.push(url)
        return
      }
      setStack((prev) => {
        const item = buildStackItem(url, prev.length)
        return item ? [...prev, item] : prev
      })
    },
    [parentSecondaryPage]
  )

  // Replace-mode pop: pop the stack; if it would empty, the close-on-empty
  // useEffect above handles removeColumn.
  const replacePop = useCallback(() => {
    setStack((prev) => prev.slice(0, -1))
  }, [])

  // Append-mode pop: close the column directly (no internal stack to navigate).
  const appendPop = useCallback(() => {
    removeColumn(column.id)
  }, [column.id, removeColumn])

  const currentIndex = stack.length - 1

  const value = useMemo(() => {
    if (transientColumnMode === 'append') {
      // Append mode: push goes to parent (spawns new transient via DeckManager
      // interception); pop closes this column.
      return {
        push: parentSecondaryPage.push,
        pop: appendPop,
        currentIndex
      }
    }
    // Replace mode: internal stack navigation.
    return {
      push: replacePush,
      pop: replacePop,
      currentIndex
    }
  }, [
    transientColumnMode,
    parentSecondaryPage.push,
    appendPop,
    replacePush,
    replacePop,
    currentIndex
  ])

  if (stack.length === 0) {
    if (initialRoute) {
      console.warn('[DetailColumnBody] No SECONDARY_ROUTES match for', initialRoute)
    }
    return (
      <div className="text-muted-foreground p-4 text-sm">{t('Cannot display this content')}</div>
    )
  }

  return (
    <SecondaryPageContext.Provider value={value}>
      {stack.map((item, idx) => (
        <div
          key={item.url}
          className="h-full"
          style={{ display: idx === stack.length - 1 ? 'block' : 'none' }}
        >
          {item.element}
        </div>
      ))}
    </SecondaryPageContext.Provider>
  )
}
