import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DEFAULT_NOSTRCONNECT_RELAY } from '@/constants'
import { cn } from '@/lib/utils'
import { formatPubkey } from '@/lib/pubkey'
import { useAccounts, ACTIVE_OWNER } from '@/providers/AccountsProvider'
import type { AccumulatedAck } from '@/providers/NostrProvider'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { bytesToHex } from '@noble/hashes/utils'
import { Check, Copy, Loader, ScanQrCode } from 'lucide-react'
import { generateSecretKey, getPublicKey } from 'nostr-tools'
import { createNostrConnectURI, NostrConnectParams } from 'nostr-tools/nip46'
import type QrScannerType from 'qr-scanner'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QrCode from '../QrCode'
import MultiAccountConfirmModal, {
  type MultiAccountConflict
} from './MultiAccountConfirmModals'

export default function NostrConnectLogin({
  back,
  onLoginSuccess
}: {
  back: () => void
  onLoginSuccess: () => void
}) {
  const { t } = useTranslation()
  const { bunkerLogin, nostrConnectionLoginMulti, switchAccount } = useNostr()
  const { accounts, addAccount, removeAccount } = useAccounts()
  // Optional — Welcome → bunker login mounts AccountManager above
  const [pending, setPending] = useState(false)
  const [bunkerInput, setBunkerInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [nostrConnectionErrMsg, setNostrConnectionErrMsg] = useState<string | null>(null)
  const qrContainerRef = useRef<HTMLDivElement>(null)
  const [qrCodeSize, setQrCodeSize] = useState(100)
  const [isScanning, setIsScanning] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const qrScannerRef = useRef<QrScannerType | null>(null)
  const qrScannerCheckTimerRef = useRef<NodeJS.Timeout | null>(null)

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBunkerInput(e.target.value)
    if (errMsg) setErrMsg(null)
  }

  const handleLogin = (bunker: string = bunkerInput) => {
    const _bunker = bunker.trim()
    if (_bunker.trim() === '') return

    setPending(true)
    bunkerLogin(_bunker)
      .then(() => onLoginSuccess())
      .catch((err) => setErrMsg(err.message || 'Login failed'))
      .finally(() => setPending(false))
  }

  const [loginDetails] = useState(() => buildLoginDetails())
  const [accumulated, setAccumulated] = useState<AccumulatedAck[]>([])
  // True once a JSON ack announces total > 1 — i.e. this is genuinely a
  // multi-account batch. Gates the "Connected:" list so a single-account
  // (bare-string ack) login closes the dialog without flashing the list.
  const [isMultiConfirmed, setIsMultiConfirmed] = useState(false)
  const [countdown, setCountdown] = useState(60)
  const [finalizeSummary, setFinalizeSummary] = useState<string[]>([])
  const [conflictQueue, setConflictQueue] = useState<MultiAccountConflict[]>([])
  const [pendingAcks, setPendingAcks] = useState<AccumulatedAck[]>([])
  const multiAbortRef = useRef<AbortController | null>(null)
  const appliedPubkeysRef = useRef<Set<string>>(new Set())
  const summaryAddedRef = useRef<boolean>(false)

  function buildLoginDetails() {
    const newPrivKey = generateSecretKey()
    const secret = Math.random().toString(36).substring(7)
    const newMeta: NostrConnectParams = {
      clientPubkey: getPublicKey(newPrivKey),
      relays: DEFAULT_NOSTRCONNECT_RELAY,
      secret,
      // App identity shown by the signer (Clave/Amber/etc.) on the approval
      // screen. `name` was the bare host, and `image` was never set — so the
      // signer showed a hostname and no icon. Advertise the app title + icon.
      name: 'JANK',
      url: document.location.origin,
      image: `${document.location.origin}/apple-touch-icon.png`
    }
    // Always emit `accounts=multi`. `createNostrConnectURI` has no first-party
    // param for it, so append manually: the URL parser doesn't know the custom
    // scheme, so swap to https://, edit, swap back. Non-multi-aware signers
    // ignore the unknown param and do a normal single-account connect; jank's
    // accumulator smart-finalizes on their bare-string ack (see login-flows.ts).
    const u = new URL(createNostrConnectURI(newMeta).replace('nostrconnect://', 'https://'))
    u.searchParams.set('accounts', 'multi')
    const newConnectionString = u.toString().replace('https://', 'nostrconnect://')
    return {
      privKey: newPrivKey,
      clientPubkey: newMeta.clientPubkey,
      secret,
      connectionString: newConnectionString
    }
  }

  useLayoutEffect(() => {
    const calculateQrSize = () => {
      if (qrContainerRef.current) {
        const containerWidth = qrContainerRef.current.offsetWidth
        const desiredSizeBasedOnWidth = Math.min(containerWidth - 8, containerWidth * 0.9)
        // Cap at 260px (down from 360) so the whole modal fits on a typical
        // desktop viewport without scrolling: QR (260) + connection string
        // (~44) + OR + bunker row (~80) + Back (~40) + gaps fits inside a
        // ~560px modal height.
        const newSize = Math.max(100, Math.min(desiredSizeBasedOnWidth, 260))
        setQrCodeSize(newSize)
      }
    }

    calculateQrSize()

    const resizeObserver = new ResizeObserver(calculateQrSize)
    if (qrContainerRef.current) {
      resizeObserver.observe(qrContainerRef.current)
    }

    return () => {
      if (qrContainerRef.current) {
        resizeObserver.unobserve(qrContainerRef.current)
      }
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!loginDetails.privKey || !loginDetails.clientPubkey || !loginDetails.secret) return
    setNostrConnectionErrMsg(null)
    setAccumulated([])
    setCountdown(60)
    setFinalizeSummary([])
    setIsMultiConfirmed(false)

    const controller = new AbortController()
    multiAbortRef.current = controller

    const tickStart = Date.now()
    const ticker = setInterval(() => {
      const elapsed = Math.floor((Date.now() - tickStart) / 1000)
      const remaining = Math.max(0, 60 - elapsed)
      setCountdown(remaining)
      if (remaining === 0) clearInterval(ticker)
    }, 1000)

    nostrConnectionLoginMulti({
      clientSecretKey: loginDetails.privKey,
      clientPubkey: loginDetails.clientPubkey,
      relays: DEFAULT_NOSTRCONNECT_RELAY,
      secret: loginDetails.secret,
      signal: controller.signal,
      onAccumulate: (ack) => {
        setAccumulated((prev) => [...prev, ack])
      },
      onTotalKnown: (total) => {
        // Only a genuine multi-account batch (total > 1) reveals the
        // "Connected:" list. A bare-string ack or a total:1 JSON ack leaves
        // this false, so the dialog closes on finalize with no list flash.
        if (total > 1) setIsMultiConfirmed(true)
      }
    })
      .then((acks) => {
        clearInterval(ticker)
        finalizeMulti(acks)
      })
      .catch((err) => {
        clearInterval(ticker)
        if (err instanceof DOMException && err.name === 'AbortError') return
        setNostrConnectionErrMsg(err?.message ?? 'Multi-account pair failed')
      })

    return () => {
      clearInterval(ticker)
      controller.abort()
    }
  }, [loginDetails])

  function finalizeMulti(acks: AccumulatedAck[]) {
    appliedPubkeysRef.current = new Set()
    summaryAddedRef.current = false
    const summary: string[] = []
    const toApply: AccumulatedAck[] = []
    const conflicts: MultiAccountConflict[] = []

    for (const ack of acks) {
      const existing = accounts.find((a) => a.pubkey === ack.signerPubkey)
      if (!existing) {
        toApply.push(ack)
        continue
      }
      if (existing.signerType === 'bunker') {
        summary.push(
          `${ack.name ?? formatPubkey(ack.signerPubkey)} is already paired; no new column added.`
        )
        continue
      }
      conflicts.push({
        signerPubkey: ack.signerPubkey,
        name: ack.name,
        existingSignerType: existing.signerType
      })
    }

    setFinalizeSummary(summary)
    if (summary.length > 0) summaryAddedRef.current = true

    if (conflicts.length > 0) {
      setPendingAcks(acks)
      setConflictQueue(conflicts)
      // Don't apply yet. Wait for modal resolutions.
      return
    }

    applyAcks(toApply)
    // Close modal in two cases:
    //   (a) success with no dup messages to show → original behavior
    //   (b) all-dups: nothing applied AND no conflicts to resolve, so the dup
    //       summary lines have already been rendered in Phase-B and the user
    //       has nothing else to do here. Letting the modal hang is a UX dead-end.
    if (summary.length === 0 || toApply.length === 0) onLoginSuccess()
  }

  function applyAcks(acks: AccumulatedAck[]) {
    for (const ack of acks) {
      client.setSigner(ack.signerPubkey, ack.signer, ACTIVE_OWNER)
      addAccount({
        pubkey: ack.signerPubkey,
        signerType: 'bunker',
        bunker: ack.bunkerString,
        bunkerClientSecretKey: bytesToHex(loginDetails.privKey)
      })
      // Column seeding is centralized in ColumnsProvider's accounts-delta
      // effect: each newly-added pubkey gets Home + Notifications columns.
      // This works for both welcome-screen pairing (ColumnsProvider not yet
      // in scope here) and in-deck pairing — the effect fires whenever
      // `accounts` grows, regardless of when ColumnsProvider mounted.
      appliedPubkeysRef.current.add(ack.signerPubkey)
    }
    if (acks.length > 0) {
      void switchAccount({ pubkey: acks[0].signerPubkey, signerType: 'bunker' })
    }
  }

  function resolveConflict(decision: 'replace' | 'keep') {
    const [current, ...rest] = conflictQueue
    if (!current) return

    if (decision === 'replace') {
      removeAccount({ pubkey: current.signerPubkey, signerType: current.existingSignerType })
      const ack = pendingAcks.find((a) => a.signerPubkey === current.signerPubkey)
      if (ack) applyAcks([ack])
    } else {
      setFinalizeSummary((prev) => [
        ...prev,
        `${current.name ?? formatPubkey(current.signerPubkey)}: kept existing signer.`
      ])
      summaryAddedRef.current = true
    }

    setConflictQueue(rest)

    if (rest.length === 0) {
      // All conflicts resolved. Apply any acks that were NOT in conflict
      // (those that map to brand-new pubkeys in `pendingAcks`).
      const stillNew = pendingAcks.filter(
        (ack) =>
          !accounts.some((a) => a.pubkey === ack.signerPubkey) &&
          !appliedPubkeysRef.current.has(ack.signerPubkey)
      )
      applyAcks(stillNew)
      setPendingAcks([])
      // Use ref rather than the stale closure-captured `finalizeSummary.length`:
      // any `setFinalizeSummary` calls in this same execution are not yet reflected
      // in the render-time snapshot, so the ref is the only reliable synchronous signal.
      if (!summaryAddedRef.current) onLoginSuccess()
    }
  }

  const copyConnectionString = async () => {
    if (!loginDetails.connectionString) return

    navigator.clipboard.writeText(loginDetails.connectionString)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const startQrScan = async () => {
    try {
      setIsScanning(true)
      setErrMsg(null)

      // Wait for next render cycle to ensure video element is in DOM
      await new Promise((resolve) => setTimeout(resolve, 100))

      if (!videoRef.current) {
        throw new Error('Video element not found')
      }

      // Load the qr-scanner library lazily — it's only needed when the user
      // actually starts a camera scan, so it stays out of the initial bundle.
      const { default: QrScanner } = await import('qr-scanner')

      const hasCamera = await QrScanner.hasCamera()
      if (!hasCamera) {
        throw new Error('No camera found')
      }

      const qrScanner = new QrScanner(
        videoRef.current,
        (result) => {
          setBunkerInput(result.data)
          stopQrScan()
          handleLogin(result.data)
        },
        {
          highlightScanRegion: true,
          highlightCodeOutline: true,
          preferredCamera: 'environment'
        }
      )

      qrScannerRef.current = qrScanner
      await qrScanner.start()

      // Check video feed after a delay
      qrScannerCheckTimerRef.current = setTimeout(() => {
        if (
          videoRef.current &&
          (videoRef.current.videoWidth === 0 || videoRef.current.videoHeight === 0)
        ) {
          setErrMsg('Camera feed not available')
        }
      }, 1000)
    } catch (error) {
      setErrMsg(
        `Failed to start camera: ${error instanceof Error ? error.message : 'Unknown error'}. Please check permissions.`
      )
      setIsScanning(false)
      if (qrScannerCheckTimerRef.current) {
        clearTimeout(qrScannerCheckTimerRef.current)
        qrScannerCheckTimerRef.current = null
      }
    }
  }

  const stopQrScan = () => {
    if (qrScannerRef.current) {
      qrScannerRef.current.stop()
      qrScannerRef.current.destroy()
      qrScannerRef.current = null
    }
    setIsScanning(false)
    if (qrScannerCheckTimerRef.current) {
      clearTimeout(qrScannerCheckTimerRef.current)
      qrScannerCheckTimerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      stopQrScan()
    }
  }, [])

  return (
    <div className="relative flex flex-col gap-3">
      {/* minHeight reserves the QR-state height so swapping to the (shorter)
          "Connected:" list doesn't collapse this container and jump the drawer.
          +16 = QrCode's p-2 padding around its size×size canvas box. */}
      <div
        ref={qrContainerRef}
        className="flex w-full flex-col items-center gap-2"
        style={{ minHeight: qrCodeSize + 16 }}
      >
        {!(accumulated.length > 0 && isMultiConfirmed) && (
          <>
            <a href={loginDetails.connectionString} aria-label="Open with Nostr signer app">
              <QrCode size={qrCodeSize} value={loginDetails.connectionString} />
            </a>
            {nostrConnectionErrMsg && (
              <div className="text-destructive pt-1 text-center text-xs">
                {nostrConnectionErrMsg}
              </div>
            )}
          </>
        )}
        {accumulated.length > 0 && isMultiConfirmed && (
          <div className="flex w-full flex-col gap-3 px-1 py-2">
            <div className="text-foreground text-sm font-semibold">Connected:</div>
            <ul className="flex flex-col gap-2">
              {accumulated.map((ack) => (
                <li key={ack.signerPubkey} className="flex items-center gap-3">
                  {ack.picture ? (
                    <img src={ack.picture} alt="" className="h-7 w-7 rounded-full" />
                  ) : (
                    <div className="bg-muted h-7 w-7 rounded-full" />
                  )}
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">
                      {ack.name ?? formatPubkey(ack.signerPubkey)}
                    </span>
                    <span className="text-muted-foreground truncate font-mono text-xs">
                      {formatPubkey(ack.signerPubkey)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="text-muted-foreground text-xs">
              Listening for more accounts… ({countdown}s)
            </div>
            {finalizeSummary.map((line, i) => (
              <div key={i} className="text-muted-foreground text-xs">
                {line}
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  const snapshot = [...accumulated]
                  multiAbortRef.current?.abort()
                  finalizeMulti(snapshot)
                }}
              >
                Done
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  multiAbortRef.current?.abort()
                  setAccumulated([])
                  back()
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex w-full justify-center">
        <div
          className="bg-muted text-muted-foreground hover:bg-muted/80 flex cursor-pointer items-center gap-2 rounded-full px-3 py-2 text-sm transition-all"
          style={{
            width: qrCodeSize > 0 ? `${Math.max(150, Math.min(qrCodeSize, 320))}px` : 'auto'
          }}
          onClick={copyConnectionString}
          role="button"
          tabIndex={0}
        >
          <div className="min-w-0 grow truncate select-none">{loginDetails.connectionString}</div>
          <div className="shrink-0">{copied ? <Check size={14} /> : <Copy size={14} />}</div>
        </div>
      </div>

      {/* Bunker paste/scan — an alternative to the QR for users whose signer
          hands them a bunker:// string directly. */}
      <div className="flex flex-col gap-3">
        <div className="flex w-full items-center">
          <div className="border-border/40 grow border-t"></div>
          <span className="text-muted-foreground px-3 text-xs">OR</span>
          <div className="border-border/40 grow border-t"></div>
        </div>

        <div className="w-full space-y-1">
          <div className="flex items-start gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="bunker://..."
                value={bunkerInput}
                onChange={handleInputChange}
                className={errMsg ? 'border-destructive pe-10' : 'pe-10'}
              />
              <Button
                size="sm"
                variant="ghost"
                className="absolute! inset-e-1 top-1/2 h-8 w-8 -translate-y-1/2 p-0"
                onClick={startQrScan}
                disabled={pending}
              >
                <ScanQrCode />
              </Button>
            </div>
            <Button onClick={() => handleLogin()} disabled={pending}>
              <Loader className={pending ? 'me-2 animate-spin' : 'hidden'} />
              {t('Login')}
            </Button>
          </div>

          {errMsg && <div className="text-destructive ps-3 pt-1 text-xs">{errMsg}</div>}
        </div>
      </div>
      <Button variant="secondary" onClick={back} className="w-full">
        {t('Back')}
      </Button>

      <div className={cn('flex h-full w-full justify-center', isScanning ? '' : 'hidden')}>
        <video
          ref={videoRef}
          className="bg-background absolute inset-0 h-full w-full"
          autoPlay
          playsInline
          muted
        />
        <Button
          variant="secondary"
          size="sm"
          className="absolute top-2 right-2"
          onClick={stopQrScan}
        >
          Cancel
        </Button>
      </div>
      <MultiAccountConfirmModal
        conflict={conflictQueue[0] ?? null}
        onReplace={() => resolveConflict('replace')}
        onKeepCurrent={() => resolveConflict('keep')}
        /* onExportPrivkey omitted — privkey export is a separate flow outside this slice. */
      />
    </div>
  )
}
