import { kinds } from 'nostr-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { withSignerApproval } from '../signer-approval'

// signer-approval imports sonner (for the waiting toast) and @/i18n (for copy).
// Mock both so the module is testable in the node env and we can assert whether
// the toast was scheduled.
vi.mock('sonner', () => ({ toast: { loading: vi.fn(), dismiss: vi.fn() } }))
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }))

describe('withSignerApproval', () => {
  afterEach(() => {
    vi.mocked(toast.loading).mockClear()
    vi.mocked(toast.dismiss).mockClear()
  })

  it('passes NIP-42 relay AUTH (kind 22242) straight through with no toast', async () => {
    const result = await withSignerApproval(Promise.resolve('signed'), kinds.ClientAuth)
    expect(result).toBe('signed')
    expect(toast.loading).not.toHaveBeenCalled()
  })

  it('passes NIP-98 HTTP AUTH (kind 27235) straight through with no toast', async () => {
    const result = await withSignerApproval(Promise.resolve('signed'), kinds.HTTPAuth)
    expect(result).toBe('signed')
    expect(toast.loading).not.toHaveBeenCalled()
  })

  it('does not apply the approval timeout to background AUTH signs', async () => {
    // A never-resolving AUTH sign must not be rejected by the timeout: it is
    // returned verbatim. Race it against a short sentinel — the sentinel wins,
    // proving withSignerApproval did not reject it at the (tiny) timeout.
    const never = new Promise<string>(() => {})
    const sentinel = new Promise<string>((resolve) => setTimeout(() => resolve('sentinel'), 30))
    const winner = await Promise.race([withSignerApproval(never, kinds.ClientAuth, 5), sentinel])
    expect(winner).toBe('sentinel')
  })

  it('still enforces the timeout for a normal user-initiated sign (kind 1)', async () => {
    const never = new Promise<string>(() => {})
    await expect(withSignerApproval(never, 1, 20)).rejects.toThrow('Signer did not respond in time')
  })

  it('resolves a normal sign and shows then dismisses nothing for an instant resolve', async () => {
    const result = await withSignerApproval(Promise.resolve('ok'), 1)
    expect(result).toBe('ok')
    // Instant resolve beats the 1s show delay, so the loading toast never fires.
    expect(toast.loading).not.toHaveBeenCalled()
  })
})
