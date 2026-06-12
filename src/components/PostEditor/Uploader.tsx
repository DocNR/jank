import { maybeWarnUnsupportedFormat, stripImageMetadata } from '@/lib/strip-image-metadata'
import mediaUpload, { UPLOAD_ABORTED_ERROR_MSG } from '@/services/media-upload.service'
import { useRef } from 'react'
import { toast } from 'sonner'

export default function Uploader({
  children,
  onUploadSuccess,
  onFilesSelected,
  onUploadStart,
  onUploadEnd,
  onProgress,
  className,
  accept = 'image/*',
  accountId
}: {
  children: React.ReactNode
  /** Built-in pipeline mode: upload each picked file here and report results. */
  onUploadSuccess?: ({ url, tags }: { url: string; tags: string[][] }, file: File) => void
  /** Picker-only mode: hand the picked files to the caller and skip the built-in upload. */
  onFilesSelected?: (files: File[]) => void
  onUploadStart?: (file: File, cancel: () => void) => void
  onUploadEnd?: (file: File) => void
  onProgress?: (file: File, progress: number) => void
  className?: string
  accept?: string
  /** Composing account pubkey; threaded to mediaUpload for per-account NIP-98 auth. */
  accountId?: string
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files) return

    if (onFilesSelected) {
      onFilesSelected(Array.from(event.target.files))
      return
    }

    const abortControllerMap = new Map<File, AbortController>()

    for (const file of event.target.files) {
      const abortController = new AbortController()
      abortControllerMap.set(file, abortController)
      onUploadStart?.(file, () => abortController.abort())
    }

    for (const file of event.target.files) {
      try {
        const abortController = abortControllerMap.get(file)
        const stripResult = await stripImageMetadata(file)
        maybeWarnUnsupportedFormat(stripResult)
        const result = await mediaUpload.upload(stripResult.file, {
          onProgress: (p) => onProgress?.(file, p),
          signal: abortController?.signal,
          pubkey: accountId
        })
        onUploadSuccess?.(result, file)
        onUploadEnd?.(file)
      } catch (error) {
        console.error('Error uploading file', error)
        const message = (error as Error).message
        if (message !== UPLOAD_ABORTED_ERROR_MSG) {
          toast.error(`Failed to upload file: ${message}`)
        }
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        onUploadEnd?.(file)
      }
    }
  }

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '' // clear the value so that the same file can be uploaded again
      fileInputRef.current.click()
    }
  }

  return (
    <div className={className}>
      <div onClick={handleUploadClick}>{children}</div>
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
        accept={accept}
        multiple
      />
    </div>
  )
}
