import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import UserAvatar from '@/components/UserAvatar'
import { useAgentLastCalled } from '@/hooks/useAgentLastCalled'
import { useColumns } from '@/providers/ColumnsProvider'
import type { TPairedAgent } from '@/types/column'
import { LogOut, MoreVertical, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  agent: TPairedAgent
  workspaceOwner: string
}

function relativeTime(unixSeconds: number): string {
  const deltaS = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds)
  if (deltaS < 60) return `${deltaS}s ago`
  const m = Math.floor(deltaS / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function AgentRow({ agent, workspaceOwner }: Props) {
  const { t } = useTranslation()
  const { addPairedAgent, removePairedAgent } = useColumns()
  const lastCalled = useAgentLastCalled(workspaceOwner, agent.pubkey)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(agent.name ?? '')

  const commitRename = () => {
    addPairedAgent(workspaceOwner, {
      ...agent,
      name: draftName.trim() || undefined
    })
    setEditing(false)
  }

  const unpair = () => {
    const label = agent.name ?? agent.npub.slice(0, 12)
    if (!confirm(t('Unpair {{name}}? Any in-flight calls will fail.', { name: label }))) {
      return
    }
    removePairedAgent(workspaceOwner, agent.npub)
  }

  const displayName = agent.name ?? `agent-${agent.npub.slice(5, 13)}`

  return (
    <li className="flex items-center gap-3 p-3 hover:bg-muted/40 border-b last:border-b-0">
      <UserAvatar userId={agent.pubkey} size="medium" />
      <div className="flex-1 min-w-0">
        {editing ? (
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value.slice(0, 40))}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraftName(agent.name ?? '')
                setEditing(false)
              }
            }}
            autoFocus
            className="h-6 text-sm"
          />
        ) : (
          <div className="truncate font-medium text-sm">{displayName}</div>
        )}
        <div className="truncate text-muted-foreground text-xs font-mono">{agent.npub}</div>
        <div className="flex items-center gap-2 text-xs mt-1">
          <Badge variant="secondary">{t('Read-only')}</Badge>
          <span className="text-muted-foreground">
            {lastCalled
              ? t('Last called {{time}}', { time: relativeTime(lastCalled) })
              : t('Never called')}
          </span>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7">
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => setEditing(true)}>
            <Pencil className="size-3.5 me-2" />
            {t('Rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={unpair} className="text-destructive">
            <LogOut className="size-3.5 me-2" />
            {t('Unpair')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
