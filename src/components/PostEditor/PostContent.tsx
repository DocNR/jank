import Note from '@/components/Note'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  createCommentDraftEvent,
  createHighlightDraftEvent,
  createPollDraftEvent,
  createShortTextNoteDraftEvent,
  deleteDraftEventCache
} from '@/lib/draft-event'
import { getDefaultRelayUrls } from '@/lib/relay'
import { useAccounts } from '@/providers/AccountsProvider'
import { useNostr } from '@/providers/NostrProvider'
import postEditorCache from '@/services/post-editor-cache.service'
import threadService from '@/services/thread.service'
import { TPollCreateData } from '@/types'
import {
  Check,
  ChevronDown,
  CircleHelp,
  ImageUp,
  ListTodo,
  LoaderCircle,
  Settings,
  Smile,
  X
} from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import EmojiPickerDialog from '../EmojiPickerDialog'
import GifPickerDialog from '../GifPickerDialog'
import SignerTypeBadge from '../SignerTypeBadge'
import { SimpleUserAvatar } from '../UserAvatar'
import { SimpleUsername } from '../Username'
import Mentions from './Mentions'
import PollEditor from './PollEditor'
import PostOptions from './PostOptions'
import PostRelaySelector from './PostRelaySelector'
import PostTextarea, { TPostTextareaHandle } from './PostTextarea'
import Uploader from './Uploader'
import { formatError } from '@/lib/error'
import { pubkeyToHsl } from '@/lib/pubkey'
import klipyService from '@/services/klipy.service'

export default function PostContent({
  defaultContent = '',
  parentStuff,
  close,
  openFrom,
  highlightedText,
  accountId
}: {
  defaultContent?: string
  parentStuff?: Event | string
  close: () => void
  openFrom?: string[]
  highlightedText?: string
  accountId?: string
}) {
  const { t } = useTranslation()
  const { pubkey: activePubkey, publishAs, checkLogin } = useNostr()
  // The pubkey to sign as. Defaults to the column's accountId (if compose was
  // triggered from a column) and falls back to the global active account.
  // User can switch via the "Posting as" dropdown inside the modal.
  const [postAsPubkey, setPostAsPubkey] = useState<string | null>(accountId ?? activePubkey ?? null)
  useEffect(() => {
    // Re-sync when the modal is reopened with a different accountId or after
    // the active account changes while modal is closed.
    setPostAsPubkey(accountId ?? activePubkey ?? null)
  }, [accountId, activePubkey])
  const [text, setText] = useState('')
  const textareaRef = useRef<TPostTextareaHandle>(null)
  const [posting, setPosting] = useState(false)
  const [uploadProgresses, setUploadProgresses] = useState<
    { file: File; progress: number; cancel: () => void }[]
  >([])
  const parentEvent = useMemo(
    () => (parentStuff && typeof parentStuff !== 'string' ? parentStuff : undefined),
    [parentStuff]
  )
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [addClientTag, setAddClientTag] = useState(true)
  const [mentions, setMentions] = useState<string[]>([])
  const [isNsfw, setIsNsfw] = useState(false)
  const [isPoll, setIsPoll] = useState(false)
  const [isProtectedEvent, setIsProtectedEvent] = useState(false)
  const [additionalRelayUrls, setAdditionalRelayUrls] = useState<string[]>([])
  const [pollCreateData, setPollCreateData] = useState<TPollCreateData>({
    isMultipleChoice: false,
    options: ['', ''],
    endsAt: undefined,
    relays: []
  })
  const [minPow, setMinPow] = useState(0)
  const userDismissedProtected = useRef(false)
  const handleProtectedSuggestionChange = useCallback((suggested: boolean) => {
    if (suggested && !userDismissedProtected.current) {
      setIsProtectedEvent(true)
    }
  }, [])
  const handleProtectedToggle = useCallback((checked: boolean) => {
    if (!checked) {
      userDismissedProtected.current = true
    }
    setIsProtectedEvent(checked)
  }, [])
  const isFirstRender = useRef(true)
  const canPost = useMemo(() => {
    return (
      !!postAsPubkey &&
      (!!text || !!highlightedText) &&
      !posting &&
      !uploadProgresses.length &&
      (!isPoll || pollCreateData.options.filter((option) => !!option.trim()).length >= 2) &&
      (!isProtectedEvent || additionalRelayUrls.length > 0)
    )
  }, [
    postAsPubkey,
    text,
    highlightedText,
    posting,
    uploadProgresses,
    isPoll,
    pollCreateData,
    isProtectedEvent,
    additionalRelayUrls
  ])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      const cachedSettings = postEditorCache.getPostSettingsCache({
        defaultContent,
        parentStuff
      })
      if (cachedSettings) {
        setIsNsfw(cachedSettings.isNsfw ?? false)
        setIsPoll(cachedSettings.isPoll ?? false)
        setPollCreateData(
          cachedSettings.pollCreateData ?? {
            isMultipleChoice: false,
            options: ['', ''],
            endsAt: undefined,
            relays: []
          }
        )
        setAddClientTag(cachedSettings.addClientTag ?? true)
      }
      return
    }
    postEditorCache.setPostSettingsCache(
      { defaultContent, parentStuff },
      {
        isNsfw,
        isPoll,
        pollCreateData,
        addClientTag
      }
    )
  }, [defaultContent, parentStuff, isNsfw, isPoll, pollCreateData, addClientTag])

  const postingRef = useRef(false)

  const post = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    checkLogin(async () => {
      if (!canPost || !postAsPubkey || postingRef.current) return

      postingRef.current = true
      setPosting(true)
      try {
        const draftEvent = await createDraftEvent({
          parentStuff,
          highlightedText,
          text,
          mentions,
          isPoll,
          pollCreateData,
          pubkey: postAsPubkey,
          addClientTag,
          isProtectedEvent,
          isNsfw
        })

        const _additionalRelayUrls = [...additionalRelayUrls]
        if (parentStuff && typeof parentStuff === 'string') {
          _additionalRelayUrls.push(...getDefaultRelayUrls())
        }

        const newEvent = await publishAs(postAsPubkey, draftEvent, {
          specifiedRelayUrls: isProtectedEvent ? additionalRelayUrls : undefined,
          additionalRelayUrls: isPoll ? pollCreateData.relays : _additionalRelayUrls,
          minPow
        })
        postEditorCache.clearPostCache({ defaultContent, parentStuff })
        deleteDraftEventCache(draftEvent)
        threadService.addRepliesToThread([newEvent])
        toast.success(t('Post successful'), { duration: 2000 })
        close()
      } catch (error) {
        const errors = formatError(error)
        errors.forEach((err) => {
          toast.error(`${t('Failed to post')}: ${err}`, { duration: 10_000 })
        })
        return
      } finally {
        setPosting(false)
        postingRef.current = false
      }
    })
  }

  const handlePollToggle = () => {
    if (parentStuff) return

    setIsPoll((prev) => !prev)
  }

  const handleUploadStart = (file: File, cancel: () => void) => {
    setUploadProgresses((prev) => [...prev, { file, progress: 0, cancel }])
  }

  const handleUploadProgress = (file: File, progress: number) => {
    setUploadProgresses((prev) =>
      prev.map((item) => (item.file === file ? { ...item, progress } : item))
    )
  }

  const handleUploadEnd = (file: File) => {
    setUploadProgresses((prev) => prev.filter((item) => item.file !== file))
  }

  return (
    <div className="space-y-2">
      {parentEvent && (
        <ScrollArea className="bg-muted/40 flex max-h-48 flex-col overflow-y-auto rounded-lg border">
          <div className="pointer-events-none p-2 sm:p-3">
            {highlightedText ? (
              <div className="flex gap-4">
                <div className="bg-primary/60 my-1 w-1 shrink-0 rounded-md" />
                <div className="whitespace-pre-line italic">{highlightedText}</div>
              </div>
            ) : (
              <Note size="small" event={parentEvent} hideParentNotePreview />
            )}
          </div>
        </ScrollArea>
      )}
      <PostTextarea
        ref={textareaRef}
        text={text}
        setText={setText}
        defaultContent={defaultContent}
        parentStuff={parentStuff}
        onSubmit={() => post()}
        className={isPoll ? 'min-h-20' : 'min-h-52'}
        onUploadStart={handleUploadStart}
        onUploadProgress={handleUploadProgress}
        onUploadEnd={handleUploadEnd}
        placeholder={highlightedText ? t('Write your thoughts about this highlight...') : undefined}
        accountId={postAsPubkey ?? undefined}
      />
      {isPoll && (
        <PollEditor
          pollCreateData={pollCreateData}
          setPollCreateData={setPollCreateData}
          setIsPoll={setIsPoll}
        />
      )}
      {uploadProgresses.length > 0 &&
        uploadProgresses.map(({ file, progress, cancel }, index) => (
          <div key={`${file.name}-${index}`} className="mt-2 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-muted-foreground mb-1 truncate text-xs">
                {file.name ?? t('Uploading...')}
              </div>
              <div className="bg-muted h-0.5 w-full overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full transition-[width] duration-200 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                cancel?.()
                handleUploadEnd(file)
              }}
              className="text-muted-foreground hover:text-foreground"
              title={t('Cancel')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      {!isPoll && (
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <PostRelaySelector
              onProtectedSuggestionChange={handleProtectedSuggestionChange}
              setAdditionalRelayUrls={setAdditionalRelayUrls}
              parentEvent={parentEvent}
              openFrom={openFrom}
            />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Switch
              id="protected-event"
              checked={isProtectedEvent}
              onCheckedChange={handleProtectedToggle}
            />
            <Label
              htmlFor="protected-event"
              className="text-muted-foreground cursor-pointer text-xs"
            >
              {t('Protected')}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="flex shrink-0">
                  <CircleHelp className="text-muted-foreground size-3.5!" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="text-sm">{t('Protected event hint')}</PopoverContent>
            </Popover>
          </div>
        </div>
      )}
      {/* Posting-as indicator near the Post button (desktop). The Post button
          lives at the right of the action row below; placing the selector
          immediately above means the user sees "who am I about to post as"
          right before clicking Post. Mobile mirrors this above the mobile
          cancel/post row at the bottom of the modal. */}
      {postAsPubkey && (
        <div className="hidden sm:flex sm:justify-end">
          <PostingAsSelector pubkey={postAsPubkey} onChange={setPostAsPubkey} />
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Uploader
            // Picker-only: the textarea's shared pipeline uploads and drops
            // the url at the caret (same flow as paste/drop), so media lands
            // where the user was typing instead of at the bottom of the post.
            onFilesSelected={(files) => textareaRef.current?.uploadFiles(files)}
            accept="image/*,video/*,audio/*"
          >
            <Button variant="ghost" size="icon">
              <ImageUp />
            </Button>
          </Uploader>
          <EmojiPickerDialog
            onEmojiClick={(emoji) => {
              if (!emoji) return
              textareaRef.current?.insertEmoji(emoji)
            }}
          >
            <Button variant="ghost" size="icon">
              <Smile />
            </Button>
          </EmojiPickerDialog>
          <GifPickerDialog
            onSelect={(gif) => {
              textareaRef.current?.insertUrl(gif.gifUrl)
              klipyService.registerShare(gif.id)
            }}
          >
            <Button variant="ghost" size="icon" title={t('GIF')}>
              <span className="text-xs font-bold">GIF</span>
            </Button>
          </GifPickerDialog>
          {!parentStuff && (
            <Button
              variant="ghost"
              size="icon"
              title={t('Create Poll')}
              className={isPoll ? 'bg-accent' : ''}
              onClick={handlePollToggle}
            >
              <ListTodo />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={showMoreOptions ? 'bg-accent' : ''}
            onClick={() => setShowMoreOptions((pre) => !pre)}
          >
            <Settings />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Mentions
            content={text}
            parentEvent={parentEvent}
            mentions={mentions}
            setMentions={setMentions}
          />
          <div className="flex items-center gap-2 max-sm:hidden">
            <Button
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation()
                close()
              }}
            >
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!canPost} onClick={post}>
              {posting && <LoaderCircle className="animate-spin" />}
              {parentStuff ? (highlightedText ? t('Publish Highlight') : t('Reply')) : t('Post')}
            </Button>
          </div>
        </div>
      </div>
      <PostOptions
        posting={posting}
        show={showMoreOptions}
        addClientTag={addClientTag}
        setAddClientTag={setAddClientTag}
        isNsfw={isNsfw}
        setIsNsfw={setIsNsfw}
        minPow={minPow}
        setMinPow={setMinPow}
      />
      {/* Mobile-only Posting-as indicator — same placement principle as
          the desktop instance above but anchored to the mobile cancel/post
          row. */}
      {postAsPubkey && (
        <div className="flex justify-center sm:hidden">
          <PostingAsSelector pubkey={postAsPubkey} onChange={setPostAsPubkey} />
        </div>
      )}
      <div className="flex items-center justify-around gap-2 sm:hidden">
        <Button
          className="w-full"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation()
            close()
          }}
        >
          {t('Cancel')}
        </Button>
        <Button className="w-full" type="submit" disabled={!canPost} onClick={post}>
          {posting && <LoaderCircle className="animate-spin" />}
          {parentStuff ? t('Reply') : t('Post')}
        </Button>
      </div>
    </div>
  )
}

/**
 * "Posting as <avatar> @<username> ▾" row at the top of the compose modal.
 * Renders as a single chip when only one account is paired (no dropdown);
 * becomes interactive once 2+ accounts are paired. npub-only accounts are
 * disabled in the dropdown — they can't sign.
 */
function PostingAsSelector({
  pubkey,
  onChange
}: {
  pubkey: string
  onChange: (pk: string) => void
}) {
  const { t } = useTranslation()
  const { accounts } = useAccounts()
  const single = accounts.length <= 1

  const chip = (
    <div className="bg-muted/40 flex items-center gap-2 rounded-full px-3 py-1.5">
      <div className="rounded-full" style={{ boxShadow: `0 0 0 2px ${pubkeyToHsl(pubkey)}` }}>
        <SimpleUserAvatar size="small" userId={pubkey} ignorePolicy />
      </div>
      <span className="text-muted-foreground text-meta">{t('Posting as')}</span>
      <SimpleUsername
        userId={pubkey}
        className="text-meta truncate font-semibold"
        withoutSkeleton
      />
      {!single && <ChevronDown className="text-muted-foreground size-3.5" />}
    </div>
  )

  if (single) {
    return chip
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:bg-muted/70 rounded-full transition-colors"
          aria-label={t('Switch account')}
        >
          {chip}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>{t('Switch account')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accounts.map((act) => {
          const disabled = act.signerType === 'npub'
          return (
            <DropdownMenuItem
              key={`${act.pubkey}:${act.signerType}`}
              disabled={disabled}
              onClick={() => {
                if (disabled) return
                if (act.pubkey !== pubkey) onChange(act.pubkey)
              }}
              className={act.pubkey === pubkey ? 'focus:bg-background cursor-default' : ''}
            >
              <div
                className="rounded-full"
                style={{ boxShadow: `0 0 0 2px ${pubkeyToHsl(act.pubkey)}` }}
              >
                <SimpleUserAvatar size="small" userId={act.pubkey} ignorePolicy />
              </div>
              <div className="min-w-0 flex-1">
                <SimpleUsername
                  userId={act.pubkey}
                  className="truncate font-medium"
                  withoutSkeleton
                />
                <SignerTypeBadge signerType={act.signerType} />
              </div>
              {act.pubkey === pubkey && <Check className="text-primary ms-auto size-4" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

async function createDraftEvent({
  parentStuff,
  text,
  mentions,
  isPoll,
  pollCreateData,
  pubkey,
  addClientTag,
  isProtectedEvent,
  isNsfw,
  highlightedText
}: {
  parentStuff: Event | string | undefined
  text: string
  mentions: string[]
  isPoll: boolean
  pollCreateData: TPollCreateData
  pubkey: string
  addClientTag: boolean
  isProtectedEvent: boolean
  isNsfw: boolean
  highlightedText?: string
}) {
  const { parentEvent, externalContent } =
    typeof parentStuff === 'string'
      ? { parentEvent: undefined, externalContent: parentStuff }
      : { parentEvent: parentStuff, externalContent: undefined }

  if (highlightedText && parentEvent) {
    return createHighlightDraftEvent(highlightedText, text, parentEvent, mentions, {
      addClientTag,
      protectedEvent: isProtectedEvent,
      isNsfw
    })
  }

  if (parentStuff && (externalContent || parentEvent?.kind !== kinds.ShortTextNote)) {
    return await createCommentDraftEvent(text, parentStuff, mentions, {
      addClientTag,
      protectedEvent: isProtectedEvent,
      isNsfw
    })
  }

  if (isPoll) {
    return await createPollDraftEvent(pubkey, text, mentions, pollCreateData, {
      addClientTag,
      isNsfw
    })
  }

  return await createShortTextNoteDraftEvent(text, mentions, {
    parentEvent,
    addClientTag,
    protectedEvent: isProtectedEvent,
    isNsfw
  })
}
