import PostEditor from '@/components/PostEditor/LazyPostEditor'
import { Button } from '@/components/ui/button'
import { useNostr } from '@/providers/NostrProvider'
import { PencilLine } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Desktop-only top-bar Compose CTA. Mobile uses the BottomBar Post button.
 *
 * Opens PostEditor with no accountId prop — the modal's existing account-
 * picker handles "which account?" when the active account is the default.
 * Per-column compose (column-header pencil) is unchanged and remains the
 * column-scoped-signer path.
 */
export default function ComposeButton() {
  const { t } = useTranslation()
  const { checkLogin } = useNostr()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="default"
        size="sm"
        className="gap-2"
        onClick={() => checkLogin(() => setOpen(true))}
      >
        <PencilLine className="size-4" />
        <span>{t('Compose')}</span>
      </Button>
      <PostEditor open={open} setOpen={setOpen} />
    </>
  )
}
