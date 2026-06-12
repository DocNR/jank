import { describe, it, expect } from 'vitest'
import { bubbleAlignment, isChatInputDisabled, isViewOnlyAccount } from '../chat-view-helpers'

const OWNER = 'a'.repeat(64)
const AGENT = 'b'.repeat(64)

describe('bubbleAlignment', () => {
  it('aligns the owner (user) messages to the end (right)', () => {
    expect(bubbleAlignment(OWNER, OWNER)).toBe('end')
  })

  it('aligns agent messages to the start (left)', () => {
    expect(bubbleAlignment(AGENT, OWNER)).toBe('start')
  })
})

describe('isChatInputDisabled', () => {
  it('is disabled when the column is view-only', () => {
    expect(isChatInputDisabled({ viewOnly: true, hasSigner: true })).toBe(true)
  })

  it('is disabled when there is no signer', () => {
    expect(isChatInputDisabled({ viewOnly: false, hasSigner: false })).toBe(true)
  })

  it('is enabled when there is a signer and not view-only', () => {
    expect(isChatInputDisabled({ viewOnly: false, hasSigner: true })).toBe(false)
  })
})

describe('isViewOnlyAccount', () => {
  it('treats an npub (watch-only) account as view-only', () => {
    expect(isViewOnlyAccount('npub')).toBe(true)
  })

  it('treats signing account types as not view-only', () => {
    expect(isViewOnlyAccount('nsec')).toBe(false)
    expect(isViewOnlyAccount('nip-07')).toBe(false)
    expect(isViewOnlyAccount('bunker')).toBe(false)
    expect(isViewOnlyAccount('browser-nsec')).toBe(false)
  })

  it('treats an absent signer type as view-only (no usable signer)', () => {
    expect(isViewOnlyAccount(undefined)).toBe(true)
  })
})
