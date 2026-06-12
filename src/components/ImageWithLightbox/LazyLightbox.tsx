import { ComponentProps, lazy, Suspense } from 'react'
import type LightboxComponent from 'yet-another-react-lightbox'

// The component's own props allow a partial `controller` (the library fills in
// defaults); the exported LightboxProps type requires the full settings, so use
// ComponentProps to match what callers actually pass.
type LazyLightboxProps = Omit<ComponentProps<typeof LightboxComponent>, 'plugins'>

/**
 * Lazily loads `yet-another-react-lightbox` (plus its Zoom plugin) only when an
 * image is actually opened full-screen. The thumbnail/grid rendering in
 * ImageWithLightbox and ImageGallery stays synchronous; the heavy lightbox code
 * is fetched on first open.
 *
 * The Zoom plugin is injected here so callers don't have to import it (and thus
 * don't pull it into the initial bundle). Callers pass the same props they used
 * to pass to <Lightbox>, minus `plugins`.
 */
const LightboxWithZoom = lazy(async () => {
  const [{ default: Lightbox }, { default: Zoom }] = await Promise.all([
    import('yet-another-react-lightbox'),
    import('yet-another-react-lightbox/plugins/zoom')
  ])
  function LightboxWithZoom(props: LazyLightboxProps) {
    return <Lightbox plugins={[Zoom]} {...props} />
  }
  return { default: LightboxWithZoom }
})

export default function LazyLightbox(props: LazyLightboxProps) {
  // A plain black backdrop while the chunk loads gives instant feedback on the
  // open click and matches the lightbox's own backdrop, so there's no flash.
  return (
    <Suspense fallback={<div className="fixed inset-0 z-[9999] bg-black/90" />}>
      <LightboxWithZoom {...props} />
    </Suspense>
  )
}
