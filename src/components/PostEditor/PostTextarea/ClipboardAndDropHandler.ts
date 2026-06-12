import { Extension } from '@tiptap/core'
import { EditorView } from '@tiptap/pm/view'
import { Plugin } from 'prosemirror-state'
import { uploadFiles, UploadPipelineOptions } from './upload-pipeline'

const DRAGOVER_CLASS_LIST = [
  'outline-2',
  'outline-offset-4',
  'outline-dashed',
  'outline-border',
  'rounded-md'
]

export type ClipboardAndDropHandlerOptions = UploadPipelineOptions

export const ClipboardAndDropHandler = Extension.create<ClipboardAndDropHandlerOptions>({
  name: 'clipboardAndDropHandler',

  addOptions() {
    return {
      onUploadStart: undefined,
      onUploadEnd: undefined,
      onUploadProgress: undefined,
      accountId: undefined
    }
  },

  addProseMirrorPlugins() {
    const options = this.options

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            dragenter(view, event) {
              event.preventDefault()
              view.dom.classList.add(...DRAGOVER_CLASS_LIST)
              return true
            },
            dragover(view, event) {
              event.preventDefault()
              view.dom.classList.add(...DRAGOVER_CLASS_LIST)
              return true
            },
            dragleave(view) {
              view.dom.classList.remove(...DRAGOVER_CLASS_LIST)
              return true
            }
          },
          handleDrop(view: EditorView, event: DragEvent) {
            event.preventDefault()
            event.stopPropagation()
            view.dom.classList.remove(...DRAGOVER_CLASS_LIST)

            const items = Array.from(event.dataTransfer?.files ?? [])
            const mediaFiles = items.filter(
              (item) =>
                item.type.includes('image') ||
                item.type.includes('video') ||
                item.type.includes('audio')
            )
            if (!mediaFiles.length) return false

            uploadFiles(view, mediaFiles, options)
            return true
          },
          handlePaste(view, event) {
            const items = Array.from(event.clipboardData?.items ?? [])
            let handled = false

            for (const item of items) {
              if (
                item.kind === 'file' &&
                (item.type.includes('image') ||
                  item.type.includes('video') ||
                  item.type.includes('audio'))
              ) {
                const file = item.getAsFile()
                if (file) {
                  uploadFiles(view, [file], options)
                  handled = true
                }
              } else if (item.kind === 'string' && item.type === 'text/plain') {
                item.getAsString((text) => {
                  const { schema } = view.state
                  const parts = text.split('\n')
                  const nodes = []
                  for (let i = 0; i < parts.length; i++) {
                    if (i > 0) nodes.push(schema.nodes.hardBreak.create())
                    if (parts[i]) nodes.push(schema.text(parts[i]))
                  }
                  if (nodes.length > 0) {
                    const tr = view.state.tr.replaceSelectionWith(nodes[0])
                    for (let i = 1; i < nodes.length; i++) {
                      tr.insert(tr.selection.from, nodes[i])
                    }
                    view.dispatch(tr)
                  }
                })
                handled = true
              }

              // Only handle the first file/string item
              if (handled) break
            }
            return handled
          }
        }
      })
    ]
  }
})
