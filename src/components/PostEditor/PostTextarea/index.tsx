import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { parseEditorJsonToText } from '@/lib/tiptap'
import { cn } from '@/lib/utils'
import customEmojiService from '@/services/custom-emoji.service'
import postEditorCache from '@/services/post-editor-cache.service'
import { TEmoji } from '@/types'
import Document from '@tiptap/extension-document'
import { HardBreak } from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import Paragraph from '@tiptap/extension-paragraph'
import Placeholder from '@tiptap/extension-placeholder'
import Text from '@tiptap/extension-text'
import { EditorContent, useEditor } from '@tiptap/react'
import { Event } from 'nostr-tools'
import { Dispatch, forwardRef, SetStateAction, useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardAndDropHandler } from './ClipboardAndDropHandler'
import Emoji from './Emoji'
import emojiSuggestion from './Emoji/suggestion'
import Mention from './Mention'
import mentionSuggestion from './Mention/suggestion'
import Preview from './Preview'
import { insertUrlAtSelection, uploadFiles } from './upload-pipeline'

export type TPostTextareaHandle = {
  /** Insert a url at the caret, whitespace-separated from adjacent text. */
  insertUrl: (url: string) => void
  /** Upload files via the shared pipeline: placeholder at the caret, then the CDN url. */
  uploadFiles: (files: File[]) => void
  insertEmoji: (emoji: string | TEmoji) => void
}

const PostTextarea = forwardRef<
  TPostTextareaHandle,
  {
    text: string
    setText: Dispatch<SetStateAction<string>>
    defaultContent?: string
    parentStuff?: Event | string
    onSubmit?: () => void
    className?: string
    onUploadStart?: (file: File, cancel: () => void) => void
    onUploadProgress?: (file: File, progress: number) => void
    onUploadEnd?: (file: File) => void
    placeholder?: string
    /** Composing account pubkey; threaded to ClipboardAndDropHandler for per-account NIP-98 auth. */
    accountId?: string
  }
>(
  (
    {
      text = '',
      setText,
      defaultContent,
      parentStuff,
      onSubmit,
      className,
      onUploadStart,
      onUploadProgress,
      onUploadEnd,
      placeholder,
      accountId
    },
    ref
  ) => {
    const { t } = useTranslation()
    const [tabValue, setTabValue] = useState('edit')
    const editor = useEditor({
      // Land the cursor in the textarea on open so users can type immediately
      // without clicking. `'end'` (not `true` / `'start'`) is intentional: for
      // replies and any cached draft content, the cursor goes after existing
      // text. If Radix DialogContent/SheetContent steals focus before TipTap
      // can grab it, add `onOpenAutoFocus={(e) => e.preventDefault()}` to
      // both in PostEditor/index.tsx — only if needed, since that disables
      // Radix's focus management entirely.
      autofocus: 'end',
      extensions: [
        Document,
        Paragraph,
        Text,
        History,
        HardBreak,
        Placeholder.configure({
          placeholder:
            placeholder ??
            t('Write something...') + ' (' + t('Paste or drop media files to upload') + ')'
        }),
        Emoji.configure({
          suggestion: emojiSuggestion
        }),
        Mention.configure({
          suggestion: mentionSuggestion
        }),
        ClipboardAndDropHandler.configure({
          onUploadStart: (file, cancel) => {
            onUploadStart?.(file, cancel)
          },
          onUploadEnd: (file) => onUploadEnd?.(file),
          onUploadProgress: (file, p) => onUploadProgress?.(file, p),
          accountId
        })
      ],
      editorProps: {
        attributes: {
          class: cn(
            'border rounded-lg p-3 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring',
            className
          )
        },
        handleKeyDown: (_view, event) => {
          // Handle Ctrl+Enter or Cmd+Enter for submit
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            onSubmit?.()
            return true
          }
          return false
        },
        clipboardTextSerializer(content) {
          return parseEditorJsonToText(content.toJSON())
        }
      },
      content: postEditorCache.getPostContentCache({ defaultContent, parentStuff }),
      onUpdate(props) {
        setText(parseEditorJsonToText(props.editor.getJSON()))
        postEditorCache.setPostContentCache({ defaultContent, parentStuff }, props.editor.getJSON())
      },
      onCreate(props) {
        setText(parseEditorJsonToText(props.editor.getJSON()))
      }
    })

    useImperativeHandle(ref, () => ({
      insertUrl: (url: string) => {
        if (editor) {
          // focus() restores the selection the dialog/button click stole
          editor.commands.focus()
          insertUrlAtSelection(editor.view, url)
        }
      },
      uploadFiles: (files: File[]) => {
        if (editor) {
          editor.commands.focus()
          uploadFiles(editor.view, files, {
            onUploadStart,
            onUploadEnd,
            onUploadProgress,
            accountId
          })
        }
      },
      insertEmoji: (emoji: string | TEmoji) => {
        if (editor) {
          if (typeof emoji === 'string') {
            editor.chain().insertContent(emoji).run()
          } else {
            const emojiNode = editor.schema.nodes.emoji.create({
              name: customEmojiService.getEmojiId(emoji)
            })
            editor.chain().insertContent(emojiNode).run()
          }
        }
      }
    }))

    if (!editor) {
      return null
    }

    return (
      <Tabs
        defaultValue="edit"
        value={tabValue}
        onValueChange={(v) => setTabValue(v)}
        className="space-y-2"
      >
        <TabsList>
          <TabsTrigger value="edit">{t('Edit')}</TabsTrigger>
          <TabsTrigger value="preview">{t('Preview')}</TabsTrigger>
        </TabsList>
        <TabsContent value="edit">
          <EditorContent className="tiptap" editor={editor} />
        </TabsContent>
        <TabsContent
          value="preview"
          onClick={() => {
            setTabValue('edit')
            editor.commands.focus()
          }}
        >
          <Preview content={text} className={className} />
        </TabsContent>
      </Tabs>
    )
  }
)
PostTextarea.displayName = 'PostTextarea'
export default PostTextarea
