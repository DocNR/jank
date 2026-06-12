import { useEffect, useRef } from 'react'

export default function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    // qr-code-styling (plus its qrcode-generator dependency) is only needed on
    // the rare QR surfaces (login / share / pairing). Load it lazily so it
    // stays out of the initial bundle. Preserves the original next-tick timing.
    void import('qr-code-styling').then(({ default: QRCodeStyling }) => {
      if (cancelled) return
      const pixelRatio = window.devicePixelRatio || 2

      const qrCode = new QRCodeStyling({
        qrOptions: {
          errorCorrectionLevel: 'H'
        },
        width: size * pixelRatio,
        height: size * pixelRatio,
        data: value,
        dotsOptions: {
          type: 'extra-rounded'
        },
        cornersDotOptions: {
          type: 'extra-rounded'
        },
        cornersSquareOptions: {
          type: 'extra-rounded'
        },
        image: '/jank-mark.svg',
        imageOptions: {
          hideBackgroundDots: true,
          margin: 4,
          imageSize: 0.4
        }
      })

      if (ref.current) {
        ref.current.innerHTML = ''
        qrCode.append(ref.current)
        const canvas = ref.current.querySelector('canvas')
        if (canvas) {
          canvas.style.width = `${size}px`
          canvas.style.height = `${size}px`
          canvas.style.maxWidth = '100%'
          canvas.style.height = 'auto'
        }
      }
    })

    return () => {
      cancelled = true
      if (ref.current) ref.current.innerHTML = ''
    }
  }, [value, size])

  return (
    <div className="overflow-hidden rounded-2xl bg-white p-2">
      {/* Reserve the square synchronously: the canvas is appended async (the
          setTimeout above), so without a sized box this is 0-height until the
          canvas lands — shoving surrounding layout, e.g. the mobile login drawer. */}
      <div ref={ref} style={{ width: size, height: size }} />
    </div>
  )
}
