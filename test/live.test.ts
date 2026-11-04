// Against Elysium mainnet and the public APIs. Read-only: nothing is signed or sent.
// Run with ELYSIUM_LIVE=1 (optionally ELYSIUM_RPC_URL for a keyed RPC).
import { describe, expect, it } from 'vitest'
import { ADDRESSES, NATIVE, createElysiumClient } from '../src/index.js'

const live = !!process.env.ELYSIUM_LIVE
const client = createElysiumClient(process.env.ELYSIUM_RPC_URL ? { rpcUrl: process.env.ELYSIUM_RPC_URL } : {})
const ME = '0x000000000000000000000000000000000000dEaD' as const
// Dry runs are sent "from" the WHYPE contract, which holds HYPE: eth_call needs no signature.
const RICH = ADDRESSES.WHYPE

describe.skipIf(!live)('live: APIs', () => {
  it('market overview and pools', async () => {
    const o = await client.market.overview()
    expect(o.pools).toBeGreaterThan(0)
    const { pools } = await client.market.pools()
    expect(Array.isArray(pools)).toBe(true)
  })

  it('pad snapshot', async () => {
    const s = await client.padApi.snapshot()
    expect(s.hypeUsd).toBeGreaterThan(0)
    for (const l of s.launches) expect(s.details[l.address.toLowerCase()]).toBeDefined()
  })
})

describe.skipIf(!live)('live: chain', () => {
  it('is Elysium', async () => {
    expect(await client.publicClient.getChainId()).toBe(99_901)
  })

  it('quotes HYPE -> the deepest ElysiumPad token and checks it on-chain', async () => {
    const s = await client.padApi.snapshot()
    const token = [...s.launches].sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0]
    if (!token) return
    const q = await client.dex.quote({ tokenIn: NATIVE, tokenOut: token.address, amountIn: 10n ** 15n })
    expect(q).not.toBeNull()
    expect(q!.kind).toBe('aggregator')
    expect(q!.amountOut).toBeGreaterThan(0n)
    const b = client.dex.buildSwap(q!, { recipient: ME })
    expect(b.call.to).toBe(ADDRESSES.dex.aggregator)
    // Dry-run the swap (eth_call) from an address holding HYPE: the built transaction executes.
    await client.publicClient.call({ account: RICH, to: b.call.to, data: b.call.data, value: b.call.value })
  })

  it('reads the launchpad settings', async () => {
    expect(await client.launchpad.launchFee('v3')).toBeTypeOf('bigint')
    const quotes = await client.launchpad.instantQuotes()
    expect(quotes.some((q) => q.token.toLowerCase() === ADDRESSES.WHYPE.toLowerCase())).toBe(true)
    const curve = await client.launchpad.curveQuotes()
    expect(curve.length).toBeGreaterThan(0)
  })

  it('reads and quotes a bonding curve', async () => {
    const s = await client.padApi.snapshot()
    const c = s.launches.find((l) => l.kind === 'curve')
    if (!c) return
    const state = await client.launchpad.curveState(c.address)
    expect(state.curve.toLowerCase()).toBe(c.curve!.curve.toLowerCase())
    const q = await client.launchpad.quoteCurveTrade({ token: c.address, side: 'buy', amountIn: 10n ** 15n, state })
    expect(q.amountOut).toBeGreaterThan(0n)
    if (state.quote.toLowerCase() === ADDRESSES.WHYPE.toLowerCase()) {
      const b = await client.launchpad.buildCurveTrade({ token: c.address, side: 'buy', amountIn: 10n ** 15n, recipient: ME, native: true, state })
      await client.publicClient.call({ account: RICH, to: b.call.to, data: b.call.data, value: b.call.value })
    }
  })
})
