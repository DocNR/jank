import AgentPairingWizard from '@/components/AgentPairingWizard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { usePairedAgents } from '@/hooks/usePairedAgents'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useColumns } from '@/providers/ColumnsProvider'
import { useNostr } from '@/providers/NostrProvider'
import { forwardRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AgentRow from './AgentRow'

const AgentsSettingsPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { pubkey, account } = useNostr()
  const { workspacesByAccount, setAllowSiblingExposure } = useColumns()

  // Active paired account is the Workspace the wizard targets. Npub-only
  // accounts can't host agents (the MCP server needs the owner's signer to
  // unwrap inbound gifts).
  const workspaceOwner = pubkey && account?.signerType !== 'npub' ? pubkey : null

  const [wizardOpen, setWizardOpen] = useState(false)
  const [disclosureOpen, setDisclosureOpen] = useState(false)

  const agents = usePairedAgents(workspaceOwner)
  const allowSiblings = workspaceOwner
    ? workspacesByAccount[workspaceOwner]?.allowSiblingExposure === true
    : false

  const onToggleSiblings = (checked: boolean) => {
    if (!workspaceOwner) return
    if (checked) {
      setDisclosureOpen(true)
    } else {
      setAllowSiblingExposure(workspaceOwner, false)
    }
  }

  const confirmAllowSiblings = () => {
    if (!workspaceOwner) return
    setAllowSiblingExposure(workspaceOwner, true)
    setDisclosureOpen(false)
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('Agents')}>
      <div className="space-y-4 px-4 pt-3">
        {!workspaceOwner ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {t("This account can't host AI agents (no signing key).")}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">{t('Paired Agents')}</h3>
              <Button onClick={() => setWizardOpen(true)}>{t('Pair an agent')}</Button>
            </div>

            {agents.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground border rounded">
                <div>{t('No agents paired')}</div>
              </div>
            ) : (
              <ul className="border rounded overflow-hidden">
                {agents.map((a) => (
                  <AgentRow key={a.npub} agent={a} workspaceOwner={workspaceOwner} />
                ))}
              </ul>
            )}

            <div className="border rounded p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h4 className="font-medium text-sm">{t('Privacy')}</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('Allow agents to see your other paired accounts')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {allowSiblings
                      ? t(
                          "On: agents see columns that reference your other paired accounts' npubs."
                        )
                      : t('Off (default): agents only see this account.')}
                  </p>
                </div>
                <Switch checked={allowSiblings} onCheckedChange={onToggleSiblings} />
              </div>
            </div>

            <AgentPairingWizard
              workspaceOwner={workspaceOwner}
              open={wizardOpen}
              onClose={() => setWizardOpen(false)}
            />

            <Dialog open={disclosureOpen} onOpenChange={setDisclosureOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('Allow sibling exposure?')}</DialogTitle>
                  <DialogDescription className="sr-only">
                    {t('Review what pairing exposes before allowing it')}
                  </DialogDescription>
                </DialogHeader>
                <div className="text-sm space-y-3">
                  <p>{t('Agents paired to this account will be able to see:')}</p>
                  <ul className="list-disc ps-5 space-y-1">
                    <li>
                      {t(
                        'Columns in this deck that view your other paired jank accounts (their npubs become visible to the agent)'
                      )}
                    </li>
                  </ul>
                  <p className="text-muted-foreground">
                    {t(
                      'This does NOT change what events the agent can publish (still none) or what other accounts the agent can read directly (still just this one).'
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {t('You can turn this off again at any time.')}
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setDisclosureOpen(false)}>
                    {t('Cancel')}
                  </Button>
                  <Button onClick={confirmAllowSiblings}>{t('Allow exposure')}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </SecondaryPageLayout>
  )
})
AgentsSettingsPage.displayName = 'AgentsSettingsPage'
export default AgentsSettingsPage
