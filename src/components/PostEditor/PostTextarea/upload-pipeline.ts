import { maybeWarnUnsupportedFormat, stripImageMetadata } from '@/lib/strip-image-metadata'
import mediaUpload, { UPLOAD_ABORTED_ERROR_MSG } from '@/services/media-upload.service'
import { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import { EditorView } from '@tiptap/pm/view'
import { toast } from 'sonner'

export interface UploadPipelineOptions {
  onUploadStart?: (file: File, cancel: () => void) => void
  onUploadEnd?: (file: File) => void
  onUploadProgress?: (file: File, progress: number) => void
  /** Composing account pubkey; threaded to mediaUpload for per-account NIP-98 auth. */
  accountId?: string
}

/**
 * Shared upload pipeline for every composer media entry point (paste, drop,
 * toolbar picker): insert an [Uploading ...] placeholder at the caret, upload,
 * then swap the placeholder for the CDN url so media lands where the user was
 * typing instead of at the bottom of the post.
 */
export async function uploadFiles(
  view: EditorView,
  files: File[],
  options: UploadPipelineOptions
): Promise<void> {
  const tasks = files.map((file) => {
    const abortController = new AbortController()
    options.onUploadStart?.(file, () => abortController.abort())
    const placeholder = insertUploadPlaceholder(view, file.name)

    return stripImageMetadata(file)
      .then((stripResult) => {
        maybeWarnUnsupportedFormat(stripResult)
        return mediaUpload.upload(stripResult.file, {
          onProgress: (p) => options.onUploadProgress?.(file, p),
          signal: abortController.signal,
          pubkey: options.accountId
        })
      })
      .then((result) => {
        options.onUploadEnd?.(file)
        resolveUploadPlaceholder(view, placeholder, result.url)
      })
      .catch((error) => {
        console.error('Error uploading file', error)
        options.onUploadEnd?.(file)
        if ((error as Error).message === UPLOAD_ABORTED_ERROR_MSG) {
          removeUploadPlaceholder(view, placeholder)
        } else {
          failUploadPlaceholder(view, placeholder, file.name)
          toast.error(`Failed to upload file: ${(error as Error).message}`)
        }
      })
  })
  await Promise.all(tasks)
}

/** Insert an upload placeholder at the caret; returns the placeholder token. */
export function insertUploadPlaceholder(view: EditorView, name: string): string {
  const placeholder = `[Uploading "${name}"...]`
  insertSeparatedText(view, placeholder)
  return placeholder
}

/** Insert a url at the caret (e.g. a picked GIF), separated from adjacent text. */
export function insertUrlAtSelection(view: EditorView, url: string): void {
  insertSeparatedText(view, url)
}

/** Swap the placeholder for the uploaded url, or append at the end if the user deleted it. */
export function resolveUploadPlaceholder(
  view: EditorView,
  placeholder: string,
  url: string
): void {
  const { schema } = view.state
  const range = findPlaceholder(view.state.doc, placeholder)
  if (range) {
    view.dispatch(view.state.tr.replaceWith(range.from, range.to, schema.text(url)))
    return
  }

  const endPos = view.state.doc.content.size
  const paragraphNode = schema.nodes.paragraph.create(null, schema.text(url))
  const tr = view.state.tr.insert(endPos, paragraphNode)
  tr.setSelection(TextSelection.near(tr.doc.resolve(endPos + 1 + url.length)))
  view.dispatch(tr)
}

/** Swap the placeholder for an error marker. */
export function failUploadPlaceholder(view: EditorView, placeholder: string, name: string): void {
  const range = findPlaceholder(view.state.doc, placeholder)
  if (!range) return
  const errorNode = view.state.schema.text(`[Error uploading "${name}"]`)
  view.dispatch(view.state.tr.replaceWith(range.from, range.to, errorNode))
}

/** Remove the placeholder (and its trailing break) without a trace, e.g. on cancel. */
export function removeUploadPlaceholder(view: EditorView, placeholder: string): void {
  const range = findPlaceholder(view.state.doc, placeholder)
  if (!range) return
  const after = view.state.doc.nodeAt(range.to)
  const end = after?.type.name === 'hardBreak' ? range.to + 1 : range.to
  view.dispatch(view.state.tr.delete(range.from, end))
}

/**
 * Insert text at the caret followed by a hard break, prepending another hard
 * break when the caret sits flush against preceding content. Bare urls fused
 * to adjacent text (`wordhttps://...`) aren't recognized by content parsers,
 * so both sides must end up whitespace-separated.
 */
function insertSeparatedText(view: EditorView, text: string): void {
  const { schema } = view.state
  const tr = view.state.tr.deleteSelection()
  let pos = tr.selection.from
  if (needsLeadingBreak(tr.doc.resolve(pos))) {
    tr.insert(pos, schema.nodes.hardBreak.create())
    pos += 1
  }
  tr.insert(pos, schema.text(text))
  pos += text.length
  tr.insert(pos, schema.nodes.hardBreak.create())
  pos += 1
  tr.setSelection(TextSelection.create(tr.doc, pos))
  view.dispatch(tr)
}

function needsLeadingBreak($pos: ResolvedPos): boolean {
  if ($pos.parentOffset === 0) return false
  const nodeBefore = $pos.nodeBefore
  if (!nodeBefore) return false
  if (nodeBefore.type.name === 'hardBreak') return false
  if (nodeBefore.isText) return !/\s$/.test(nodeBefore.text ?? '')
  // atomic inline node (mention, custom emoji): still needs separation
  return true
}

function findPlaceholder(
  doc: ProseMirrorNode,
  placeholder: string
): { from: number; to: number } | null {
  let range: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (range) return false
    if (node.isText && node.text) {
      const idx = node.text.indexOf(placeholder)
      if (idx >= 0) {
        range = { from: pos + idx, to: pos + idx + placeholder.length }
        return false
      }
    }
    return true
  })
  return range
}
