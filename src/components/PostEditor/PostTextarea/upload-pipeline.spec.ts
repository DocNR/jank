import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import { HardBreak } from '@tiptap/extension-hard-break'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/media-upload.service', () => ({
  default: { upload: vi.fn() },
  UPLOAD_ABORTED_ERROR_MSG: 'Upload aborted'
}))
vi.mock('@/lib/strip-image-metadata', () => ({
  stripImageMetadata: vi.fn(async (file: File) => ({ file, format: 'png', stripped: true })),
  maybeWarnUnsupportedFormat: vi.fn()
}))
vi.mock('sonner', () => ({
  toast: { error: vi.fn() }
}))

import mediaUpload, { UPLOAD_ABORTED_ERROR_MSG } from '@/services/media-upload.service'
import { toast } from 'sonner'
import {
  failUploadPlaceholder,
  insertUploadPlaceholder,
  insertUrlAtSelection,
  removeUploadPlaceholder,
  resolveUploadPlaceholder,
  uploadFiles
} from './upload-pipeline'

const URL = 'https://cdn.example.com/abc.png'

let editor: Editor

function createEditor() {
  return new Editor({
    element: document.createElement('div'),
    extensions: [Document, Paragraph, Text, HardBreak]
  })
}

/** Serialize the doc with hardBreaks and paragraph boundaries as \n. */
function docText() {
  const doc = editor.state.doc
  return doc.textBetween(0, doc.content.size, '\n', '\n')
}

/** Place the caret after the given text occurrence (search in doc text coords). */
function setCursorAfter(text: string) {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (node.isText && node.text) {
      const idx = node.text.indexOf(text)
      if (idx >= 0) {
        found = pos + idx + text.length
        return false
      }
    }
    return true
  })
  if (found < 0) throw new Error(`text not found: ${text}`)
  editor.commands.setTextSelection(found)
}

beforeEach(() => {
  editor = createEditor()
  vi.clearAllMocks()
})

afterEach(() => {
  editor.destroy()
})

describe('insertUploadPlaceholder', () => {
  it('inserts at the cursor with a leading break when fused to preceding text', () => {
    editor.commands.setContent('helloworld')
    setCursorAfter('hello')
    insertUploadPlaceholder(editor.view, 'img.png')
    expect(docText()).toBe('hello\n[Uploading "img.png"...]\nworld')
  })

  it('inserts without a leading break at the start of an empty doc', () => {
    insertUploadPlaceholder(editor.view, 'img.png')
    expect(docText()).toBe('[Uploading "img.png"...]\n')
  })

  it('inserts without a leading break after trailing whitespace', () => {
    // setContent parses HTML and collapses trailing spaces; insert directly
    editor.view.dispatch(editor.state.tr.insertText('hello '))
    insertUploadPlaceholder(editor.view, 'img.png')
    expect(docText()).toBe('hello [Uploading "img.png"...]\n')
  })

  it('inserts without a leading break right after a hard break', () => {
    editor.commands.setContent('hello<br>world')
    setCursorAfter('hello')
    // move past the hardBreak
    editor.commands.setTextSelection(editor.state.selection.from + 1)
    insertUploadPlaceholder(editor.view, 'img.png')
    expect(docText()).toBe('hello\n[Uploading "img.png"...]\nworld')
  })

  it('stacks placeholders in order for sequential calls', () => {
    editor.commands.setContent('hello')
    setCursorAfter('hello')
    insertUploadPlaceholder(editor.view, 'a.png')
    insertUploadPlaceholder(editor.view, 'b.png')
    expect(docText()).toBe('hello\n[Uploading "a.png"...]\n[Uploading "b.png"...]\n')
  })
})

describe('resolveUploadPlaceholder', () => {
  it('replaces the placeholder in place with the url', () => {
    editor.commands.setContent('helloworld')
    setCursorAfter('hello')
    const placeholder = insertUploadPlaceholder(editor.view, 'img.png')
    resolveUploadPlaceholder(editor.view, placeholder, URL)
    expect(docText()).toBe(`hello\n${URL}\nworld`)
  })

  it('appends the url at the end when the placeholder was deleted by the user', () => {
    editor.commands.setContent('hello')
    const placeholder = '[Uploading "gone.png"...]'
    resolveUploadPlaceholder(editor.view, placeholder, URL)
    expect(docText()).toBe(`hello\n${URL}`)
  })
})

describe('failUploadPlaceholder', () => {
  it('swaps the placeholder for an error marker', () => {
    editor.commands.setContent('hello')
    setCursorAfter('hello')
    const placeholder = insertUploadPlaceholder(editor.view, 'img.png')
    failUploadPlaceholder(editor.view, placeholder, 'img.png')
    expect(docText()).toBe('hello\n[Error uploading "img.png"]\n')
  })
})

describe('removeUploadPlaceholder', () => {
  it('removes the placeholder and its trailing break', () => {
    editor.commands.setContent('helloworld')
    setCursorAfter('hello')
    const placeholder = insertUploadPlaceholder(editor.view, 'img.png')
    removeUploadPlaceholder(editor.view, placeholder)
    expect(docText()).toBe('hello\nworld')
  })

  it('is a no-op when the placeholder is gone', () => {
    editor.commands.setContent('hello')
    removeUploadPlaceholder(editor.view, '[Uploading "gone.png"...]')
    expect(docText()).toBe('hello')
  })
})

describe('insertUrlAtSelection', () => {
  it('inserts the url at the cursor with separation on both sides', () => {
    editor.commands.setContent('helloworld')
    setCursorAfter('hello')
    insertUrlAtSelection(editor.view, URL)
    expect(docText()).toBe(`hello\n${URL}\nworld`)
  })

  it('does not add a leading break after whitespace', () => {
    // setContent parses HTML and collapses trailing spaces; insert directly
    editor.view.dispatch(editor.state.tr.insertText('hello '))
    insertUrlAtSelection(editor.view, URL)
    expect(docText()).toBe(`hello ${URL}\n`)
  })
})

describe('uploadFiles', () => {
  function makeFile(name: string) {
    return new File(['x'], name, { type: 'image/png' })
  }

  it('inserts a placeholder at the cursor and resolves it with the uploaded url', async () => {
    vi.mocked(mediaUpload.upload).mockResolvedValue({ url: URL, tags: [] })
    editor.commands.setContent('helloworld')
    setCursorAfter('hello')

    const onUploadStart = vi.fn()
    const onUploadEnd = vi.fn()
    const file = makeFile('img.png')
    await uploadFiles(editor.view, [file], { onUploadStart, onUploadEnd })

    expect(docText()).toBe(`hello\n${URL}\nworld`)
    expect(onUploadStart).toHaveBeenCalledWith(file, expect.any(Function))
    expect(onUploadEnd).toHaveBeenCalledWith(file)
  })

  it('threads the composing account pubkey to the upload', async () => {
    vi.mocked(mediaUpload.upload).mockResolvedValue({ url: URL, tags: [] })
    await uploadFiles(editor.view, [makeFile('img.png')], { accountId: 'pubkey1' })
    expect(mediaUpload.upload).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pubkey: 'pubkey1' })
    )
  })

  it('removes the placeholder silently when the upload is aborted', async () => {
    vi.mocked(mediaUpload.upload).mockRejectedValue(new Error(UPLOAD_ABORTED_ERROR_MSG))
    editor.commands.setContent('hello')
    setCursorAfter('hello')

    await uploadFiles(editor.view, [makeFile('img.png')], {})

    expect(docText()).toBe('hello\n')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('marks the placeholder as failed and toasts on upload error', async () => {
    vi.mocked(mediaUpload.upload).mockRejectedValue(new Error('server exploded'))
    editor.commands.setContent('hello')
    setCursorAfter('hello')

    await uploadFiles(editor.view, [makeFile('img.png')], {})

    expect(docText()).toBe('hello\n[Error uploading "img.png"]\n')
    expect(toast.error).toHaveBeenCalled()
  })
})
