import { describe, expect, it } from 'vitest'
import { EmbeddedLNInvoiceParser, EmbeddedNofferParser, parseContent } from '../content-parser'

const NOFFER =
  'noffer1qszqqqqqvspszqqzg3jnzwfexscrzdnrxgexywp5x4nrzwrzvscrqve5v4jnzv3jxucr2wphv3jnxce5v33rsvtzx5envvnpvs6r2cfjxdsnxv3exp3rsde5xvurxcsprfmhxue69uhhxarjvee8jtnndphkx6ewdejhgam0wf4sqgrka4zlqr820wk9nkxsklfqfpy02vva0wtvzs8lkm7t424s5y75fck942h6'

describe('EmbeddedNofferParser', () => {
  it('splits a noffer out of surrounding text', () => {
    const nodes = parseContent(`pay me here: ${NOFFER} thanks!`, [EmbeddedNofferParser])
    expect(nodes).toEqual([
      { type: 'text', data: 'pay me here: ' },
      { type: 'noffer', data: NOFFER },
      { type: 'text', data: ' thanks!' }
    ])
  })

  it('captures a nostr:-prefixed noffer including the prefix', () => {
    const nodes = parseContent(`nostr:${NOFFER}`, [EmbeddedNofferParser])
    expect(nodes).toEqual([{ type: 'noffer', data: `nostr:${NOFFER}` }])
  })

  it('coexists with the invoice parser', () => {
    const invoice =
      'lnbc1u1p5z4xwzpp5xn0czdtmjpkpmws8aslyfm203enj5xj0y0z0jpwgwcrnfrwwtqtsdqqcqzzsxqyz5vqsp5usz0fpl'
    const nodes = parseContent(`${invoice}\n${NOFFER}`, [
      EmbeddedLNInvoiceParser,
      EmbeddedNofferParser
    ])
    expect(nodes.map((n) => n.type)).toEqual(['invoice', 'text', 'noffer'])
  })

  it('does not match a bare short noffer-like token', () => {
    const nodes = parseContent('noffer1tooshort is not an offer', [EmbeddedNofferParser])
    expect(nodes).toEqual([{ type: 'text', data: 'noffer1tooshort is not an offer' }])
  })
})
