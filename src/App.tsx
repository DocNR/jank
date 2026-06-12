import 'yet-another-react-lightbox/styles.css'
import './index.css'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import UpdatePrompt from '@/components/UpdatePrompt'
import WhatsNew from '@/components/WhatsNew'
import clientService from '@/services/client.service'
import contextVmServer from '@/services/context-vm-server.service'
import relayListService from '@/services/fetchers/relay-list.service'
import { registerAllTools } from '@/services/mcp-tools'
import type { Filter } from 'nostr-tools'
import { AccountsProvider } from '@/providers/AccountsProvider'
import { ColumnsProvider } from '@/providers/ColumnsProvider'
import { DeckSyncProvider } from '@/providers/DeckSyncProvider'
import { ContentPolicyProvider } from '@/providers/ContentPolicyProvider'
import { DeletedEventProvider } from '@/providers/DeletedEventProvider'
import { EmojiPackProvider } from '@/providers/EmojiPackProvider'
import { FavoriteRelaysProvider } from '@/providers/FavoriteRelaysProvider'
import { FeedProvider } from '@/providers/FeedProvider'
import { KindFilterProvider } from '@/providers/KindFilterProvider'
import { MediaUploadServiceProvider } from '@/providers/MediaUploadServiceProvider'
import { NostrProvider } from '@/providers/NostrProvider'
import { ScreenSizeProvider } from '@/providers/ScreenSizeProvider'
import { ThemeProvider } from '@/providers/ThemeProvider'
import { TranslationServiceProvider } from '@/providers/TranslationServiceProvider'
import { UserListsProvider } from '@/providers/UserListsProvider'
import { UserPreferencesProvider } from '@/providers/UserPreferencesProvider'
import { UserTrustProvider } from '@/providers/UserTrustProvider'
import { ZapProvider } from '@/providers/ZapProvider'
import { DirectionProvider } from '@radix-ui/react-direction'
import { useTranslation } from 'react-i18next'
import { DeckManager } from './DeckManager'

// Track B — jank-as-MCP-server bootstrap. Idempotent at module scope.
// Lifecycle (attach/detach per Workspace) lives in AccountsProvider +
// ColumnsProvider effects so it tracks the React account/Workspace state.
contextVmServer.setDependencies({
  publishFn: (relays, evt) => clientService.publishEvent(relays, evt),
  signerLookup: (pk) => clientService.getSignerFor(pk) ?? null,
  subscribeFn: (relays, filter, callbacks) =>
    clientService.subscribe(relays, filter as Filter, callbacks),
  relayListLookup: async (pk) => {
    const list = await relayListService.fetchRelayList(pk)
    return Array.from(new Set([...(list.read ?? []), ...(list.write ?? [])]))
  }
})
registerAllTools()

function RadixDirectionProvider({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation()
  return <DirectionProvider dir={i18n.dir()}>{children}</DirectionProvider>
}

export default function App(): JSX.Element {
  return (
    <RadixDirectionProvider>
      <TooltipProvider delayDuration={300} skipDelayDuration={150}>
        <ScreenSizeProvider>
          <UserPreferencesProvider>
            <ThemeProvider>
              <ContentPolicyProvider>
                <DeletedEventProvider>
                  <AccountsProvider>
                    <NostrProvider>
                      <ZapProvider>
                        <TranslationServiceProvider>
                          <FavoriteRelaysProvider>
                            <UserListsProvider>
                              <UserTrustProvider>
                                <EmojiPackProvider>
                                  <FeedProvider>
                                    <MediaUploadServiceProvider>
                                      <KindFilterProvider>
                                        <ColumnsProvider>
                                          <DeckSyncProvider>
                                            <DeckManager />
                                          </DeckSyncProvider>
                                        </ColumnsProvider>
                                        <Toaster />
                                        <UpdatePrompt />
                                        <WhatsNew />
                                      </KindFilterProvider>
                                    </MediaUploadServiceProvider>
                                  </FeedProvider>
                                </EmojiPackProvider>
                              </UserTrustProvider>
                            </UserListsProvider>
                          </FavoriteRelaysProvider>
                        </TranslationServiceProvider>
                      </ZapProvider>
                    </NostrProvider>
                  </AccountsProvider>
                </DeletedEventProvider>
              </ContentPolicyProvider>
            </ThemeProvider>
          </UserPreferencesProvider>
        </ScreenSizeProvider>
      </TooltipProvider>
    </RadixDirectionProvider>
  )
}
