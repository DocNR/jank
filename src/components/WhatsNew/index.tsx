import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { getUnseenReleaseNotes } from '@/lib/release-notes'
import { RELEASE_NOTES } from '@/release-notes'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

// legacy localStorage key — do NOT rename; renaming re-pops the What's-new dialog for every existing user
const STORAGE_KEY = 'spectr:lastSeenReleaseVersion'

function readLastSeen(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeLastSeen(version: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, version)
  } catch {
    // private mode / storage disabled — treat as first run next load
  }
}

export default function WhatsNew(): JSX.Element | null {
  const { t } = useTranslation()
  const current = import.meta.env.APP_VERSION
  const [open, setOpen] = useState(false)
  const [result] = useState(() => getUnseenReleaseNotes(readLastSeen(), current, RELEASE_NOTES))

  useEffect(() => {
    if (result.notes.length > 0) {
      setOpen(true)
    } else {
      writeLastSeen(current)
    }
  }, [result, current])

  const dismiss = () => {
    writeLastSeen(current)
    setOpen(false)
  }

  if (result.notes.length === 0) return null

  return (
    <Dialog open={open} onOpenChange={(v) => !v && dismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("What's new")}</DialogTitle>
          <DialogDescription>{t('Recent updates to jank.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {result.notes.map((note) => (
            <div key={note.version}>
              <div className="text-sm font-semibold text-muted-foreground">
                v{note.version} · {note.date}
              </div>
              <ul className="mt-1 list-disc space-y-1 ps-5 text-sm">
                {note.highlights.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
              {note.link && (
                <a
                  href={note.link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-sm text-primary hover:underline"
                >
                  {t('Learn more')}
                </a>
              )}
            </div>
          ))}
          {result.truncated && (
            <div className="text-sm text-muted-foreground">{t('…and earlier updates')}</div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={dismiss}>{t('Got it')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
