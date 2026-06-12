import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useColumns } from '@/providers/ColumnsProvider'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildPairedAgent } from './pairing-helpers'
import Step1AddAgent from './Step1AddAgent'
import Step2Configure from './Step2Configure'

type Props = {
  workspaceOwner: string
  open: boolean
  onClose: () => void
}

export default function AgentPairingWizard({ workspaceOwner, open, onClose }: Props) {
  const { t } = useTranslation()
  const { addPairedAgent } = useColumns()
  const [step, setStep] = useState<1 | 2>(1)
  const [agentNpub, setAgentNpub] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [agentChatNpub, setAgentChatNpub] = useState('')

  const handleClose = () => {
    setStep(1)
    setAgentNpub('')
    setDisplayName('')
    setAgentChatNpub('')
    onClose()
  }

  const persistPairing = () => {
    const result = buildPairedAgent({
      agentNpub,
      displayName,
      agentChatNpub
    })
    // Both npubs were validated in Step 1; a non-ok result here would mean the
    // state was tampered with. Bail rather than persist a malformed agent.
    if (!result.ok) return
    addPairedAgent(workspaceOwner, result.agent)
    handleClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('Pair an AI Agent')}</DialogTitle>
          <DialogDescription>
            {t(
              'Your agent never gets your signing key — your signer still gates every event you publish. jank must stay open in a browser tab for your agent to work.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="text-xs text-muted-foreground border-b pb-2">
          {t('Step {{n}} of 2', { n: step })}
        </div>

        {step === 1 ? (
          <Step1AddAgent
            workspaceOwner={workspaceOwner}
            initialNpub={agentNpub}
            initialName={displayName}
            initialChatNpub={agentChatNpub}
            onNext={(npub, name, chatNpub) => {
              setAgentNpub(npub)
              setDisplayName(name)
              setAgentChatNpub(chatNpub)
              setStep(2)
            }}
            onCancel={handleClose}
          />
        ) : (
          <Step2Configure
            workspaceOwner={workspaceOwner}
            onBack={() => setStep(1)}
            onDone={persistPairing}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
