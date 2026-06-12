import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePairedAgents } from '@/hooks/usePairedAgents'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isValidNpub } from './pairing-helpers'

type Props = {
  workspaceOwner: string
  initialNpub: string
  initialName: string
  initialChatNpub: string
  onNext: (npub: string, name: string, chatNpub: string) => void
  onCancel: () => void
}

export default function Step1AddAgent({
  workspaceOwner,
  initialNpub,
  initialName,
  initialChatNpub,
  onNext,
  onCancel
}: Props) {
  const { t } = useTranslation()
  const [npub, setNpub] = useState(initialNpub)
  const [name, setName] = useState(initialName)
  const [chatNpub, setChatNpub] = useState(initialChatNpub)
  const pairedAgents = usePairedAgents(workspaceOwner)

  const npubValid = isValidNpub(npub)

  // Chat npub is optional. Only flag an error when the user has typed
  // something that isn't a valid npub; a blank field is fine (no chat surface).
  const chatNpubValid = chatNpub.trim() === '' || isValidNpub(chatNpub.trim())

  const duplicate = npubValid && pairedAgents.some((a) => a.npub === npub)
  const duplicateName = duplicate
    ? pairedAgents.find((a) => a.npub === npub)?.name
    : undefined

  const canProceed = npubValid && !duplicate && chatNpubValid

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="agent-npub">
          {t('Agent npub')} <span className="text-red-500">*</span>
        </Label>
        <Input
          id="agent-npub"
          autoFocus
          value={npub}
          onChange={(e) => setNpub(e.target.value.trim())}
          placeholder="npub1..."
          className="font-mono text-xs"
        />
        {npub && !npubValid && (
          <p className="text-red-500 text-xs mt-1">{t('Invalid npub')}</p>
        )}
        {duplicate && (
          <p className="text-red-500 text-xs mt-1">
            {t('Already paired as {{name}}', {
              name: duplicateName ?? t('this agent')
            })}
          </p>
        )}
        <p className="text-muted-foreground text-xs mt-1">
          {t(
            "Get your agent's npub from your runtime's startup output (e.g. Claude Agent SDK + ContextVM Proxy CLI prints \"agent npub: npub1...\"; other MCP-over-Nostr runtimes use similar formats)"
          )}
        </p>
      </div>

      <div>
        <Label htmlFor="agent-name">{t('Display name (optional)')}</Label>
        <Input
          id="agent-name"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder={t('e.g. Claude on my laptop')}
          maxLength={40}
        />
      </div>

      <div>
        <Label htmlFor="agent-chat-npub">{t('Agent chat npub (optional)')}</Label>
        <Input
          id="agent-chat-npub"
          value={chatNpub}
          onChange={(e) => setChatNpub(e.target.value.trim())}
          placeholder="npub1..."
          className="font-mono text-xs"
        />
        {chatNpub.trim() !== '' && !chatNpubValid && (
          <p className="text-red-500 text-xs mt-1">{t('Invalid npub')}</p>
        )}
        <p className="text-muted-foreground text-xs mt-1">
          {t(
            "The npub you'll send direct messages to (only if your agent has a separate chat identity). Leave blank if your agent doesn't support in-app chat."
          )}
        </p>
      </div>

      <div className="text-xs text-muted-foreground border-s-2 border-muted ps-3 py-1">
        {t('Scope: Read-only')}
        <span className="block mt-1">
          {t('Full scope (mutations + drafts) coming in a future update.')}
        </span>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button onClick={() => onNext(npub, name, chatNpub.trim())} disabled={!canProceed}>
          {t('Next')}
        </Button>
      </div>
    </div>
  )
}
