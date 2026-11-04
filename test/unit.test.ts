import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, type Address, type Log, type PublicClient } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  ADDRESSES,
  Dex,
  ElysiumApiError,
  LaunchError,
  Launchpad,
  MarketApi,
  NATIVE,
  PadApi,
  ZERO,
  abis,
  encodeV3Path,
  minusSlippage,
  plusSlippage,
  toTaxConfig,
  type SwapQuote,
} from '../src/index.js'

const ME: Address = '0x1111111111111111111111111111111111111111'
const TOKEN: Address = '0x2222222222222222222222222222222222222222'
const POOL: Address = '0x3333333333333333333333333333333333333333'
// Builders never touch the chain when everything they need is passed in.
const noChain = {} as PublicClient

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch
}

describe('slippage', () => {
  it('rounds the minimum down and the maximum up', () => {
    expect(minusSlippage(10_000n, 50)).toBe(9_950n)
    expect(minusSlippage(999n, 100)).toBe(989n) // 989.01 -> 989
    expect(plusSlippage(999n, 100)).toBe(1_009n) // 1008.99 -> 1009
  })
  it('refuses nonsense', () => {
    expect(() => minusSlippage(1n, -1)).toThrow(RangeError)
    expect(() => minusSlippage(1n, 10_000)).toThrow(RangeError)
  })
})

describe('encodeV3Path', () => {
  it('packs token, fee, token', () => {
    const p = encodeV3Path([ADDRESSES.WHYPE, TOKEN], [10_000])
    expect(p).toBe(`0x${ADDRESSES.WHYPE.slice(2).toLowerCase()}002710${TOKEN.slice(2)}`)
  })
  it('reverses for exact output and checks lengths', () => {
    expect(encodeV3Path([ADDRESSES.WHYPE, TOKEN], [500], true).startsWith(`0x${TOKEN.slice(2)}`)).toBe(true)
    expect(() => encodeV3Path([ADDRESSES.WHYPE, TOKEN], [])).toThrow()
  })
})

describe('toTaxConfig', () => {
  it('accepts no tax with no shares', () => {
    const c = toTaxConfig({ buyBps: 0, sellBps: 0 })
    expect(c).toEqual({ buyBps: 0, sellBps: 0, burnShare: 0, liquidityShare: 0, wallets: [ZERO, ZERO, ZERO], walletShares: [0, 0, 0] })
  })
  it('pads wallets to three', () => {
    const c = toTaxConfig({ buyBps: 300, sellBps: 500, burnShareBps: 5_000, wallets: [{ address: ME, shareBps: 5_000 }] })
    expect(c.wallets).toEqual([ME, ZERO, ZERO])
    expect(c.walletShares).toEqual([5_000, 0, 0])
  })
  it('enforces the token rules', () => {
    expect(() => toTaxConfig({ buyBps: 1_001, sellBps: 0, burnShareBps: 10_000 })).toThrow(LaunchError)
    expect(() => toTaxConfig({ buyBps: 100, sellBps: 100, burnShareBps: 9_000 })).toThrow(/add up to 10000/)
    expect(() => toTaxConfig({ buyBps: 100, sellBps: 0, wallets: [{ address: ZERO, shareBps: 10_000 }] })).toThrow(/zero address/)
    expect(() => toTaxConfig({ buyBps: 100, sellBps: 0, wallets: [ME, ME, ME, ME].map((a) => ({ address: a, shareBps: 2_500 })) })).toThrow(/at most 3/)
    expect(() => toTaxConfig({ buyBps: 1.5, sellBps: 0 })).toThrow(/whole number/)
  })
})

describe('Dex.buildSwap', () => {
  const dex = new Dex(noChain, new MarketApi({ fetch: fakeFetch(500, {}) }), ADDRESSES)
  const legs = [{ kind: 1, pool: POOL, tokenIn: ADDRESSES.WHYPE, tokenOut: TOKEN, fee: 10_000, tickSpacing: 200, hooks: ZERO, hookData: '0x' as const }]
  const agg = (tokenIn: Address, tokenOut: Address): SwapQuote => ({
    kind: 'aggregator', tokenIn, tokenOut, amountIn: 10n ** 18n, amountOut: 1_000_000n, apiAmountOut: 1_000_000n,
    feeOnOutput: false, priceImpact: 0, lpFee: 0, paths: [{ shareBps: 10_000, legs }], route: [],
  })

  it('pays HYPE as value and sends native as address(0)', () => {
    const b = dex.buildSwap(agg(NATIVE, TOKEN), { recipient: ME, slippageBps: 100, deadline: 123n })
    expect(b.call.to).toBe(ADDRESSES.dex.aggregator)
    expect(b.call.value).toBe(10n ** 18n)
    expect(b.approval).toBeNull()
    expect(b.minAmountOut).toBe(990_000n)
    const { functionName, args } = decodeFunctionData({ abi: abis.aggregatorAbi, data: b.call.data })
    expect(functionName).toBe('swap')
    const s = (args as unknown as [{ tokenIn: Address; minAmountOut: bigint; recipient: Address; deadline: bigint }])[0]
    expect(s.tokenIn).toBe(ZERO)
    expect(s.minAmountOut).toBe(990_000n)
    expect(s.recipient).toBe(ME)
    expect(s.deadline).toBe(123n)
  })

  it('needs an approval when selling a token', () => {
    const b = dex.buildSwap(agg(TOKEN, NATIVE), { recipient: ME })
    expect(b.call.value).toBe(0n)
    expect(b.approval).toEqual({ token: TOKEN, spender: ADDRESSES.dex.aggregator, amount: 10n ** 18n })
  })

  it('wraps and unwraps 1:1', async () => {
    const wrap = await dex.quote({ tokenIn: NATIVE, tokenOut: ADDRESSES.WHYPE, amountIn: 5n })
    expect(wrap?.kind).toBe('wrap')
    const b = dex.buildSwap(wrap!, { recipient: ME })
    expect(b.call).toMatchObject({ to: ADDRESSES.WHYPE, value: 5n })
    const unwrap = dex.buildSwap((await dex.quote({ tokenIn: ADDRESSES.WHYPE, tokenOut: NATIVE, amountIn: 5n }))!, { recipient: ME })
    expect(decodeFunctionData({ abi: abis.wethAbi, data: unwrap.call.data }).functionName).toBe('withdraw')
  })

  it('takes the fee from the output only when paid out in a base asset', () => {
    expect(dex.feeOnOutput(TOKEN, NATIVE)).toBe(true)
    expect(dex.feeOnOutput(TOKEN, ADDRESSES.USDC)).toBe(true)
    expect(dex.feeOnOutput(NATIVE, TOKEN)).toBe(false)
    expect(dex.feeOnOutput(ADDRESSES.USDC, NATIVE)).toBe(false)
  })

  it('builds direct v2 and v3 swaps with HYPE on either end', () => {
    const v2 = dex.buildV2Swap({ path: [NATIVE, TOKEN], amountIn: 7n, amountOutMin: 1n, recipient: ME })
    expect(decodeFunctionData({ abi: abis.v2RouterAbi, data: v2.call.data }).functionName).toBe('swapExactETHForTokens')
    expect(v2.call.value).toBe(7n)
    const v3 = dex.buildV3Swap({ tokens: [TOKEN, NATIVE], fees: [10_000], amountIn: 7n, amountOutMin: 1n, recipient: ME })
    expect(decodeFunctionData({ abi: abis.v3RouterAbi, data: v3.call.data }).functionName).toBe('multicall')
    expect(v3.approval).toEqual({ token: TOKEN, spender: ADDRESSES.dex.v3Router, amount: 7n })
  })
})

describe('Dex.quote with the API', () => {
  it('returns null when the API has no route', async () => {
    const dex = new Dex(noChain, new MarketApi({ fetch: fakeFetch(404, { error: 'route not found' }) }), ADDRESSES)
    expect(await dex.quote({ tokenIn: NATIVE, tokenOut: TOKEN, amountIn: 1n })).toBeNull()
  })
  it('rejects a route for a different trade', async () => {
    const body = { amountIn: '2', amountOut: '1', feeOnOutput: false, routerFeeBps: 10, priceImpact: 0, lpFee: 0, paths: [] }
    const dex = new Dex(noChain, new MarketApi({ fetch: fakeFetch(200, body) }), ADDRESSES)
    await expect(dex.quote({ tokenIn: NATIVE, tokenOut: TOKEN, amountIn: 1n })).rejects.toThrow(/different trade/)
  })
})

describe('Launchpad builders', () => {
  const pad = new Launchpad(noChain, new PadApi({ fetch: fakeFetch(500, {}) }), ADDRESSES)

  it('instant launch: fee plus HYPE dev buy as value', async () => {
    const b = await pad.buildLaunch({ name: ' Cat ', symbol: 'cat', meta: { image: 'ipfs://x' }, devBuy: 3n, launchFee: 10n })
    expect(b.call).toMatchObject({ to: ADDRESSES.pad.launcher, value: 13n })
    const { args } = decodeFunctionData({ abi: abis.padLauncherAbi, data: b.call.data })
    expect(args?.[0]).toBe('Cat')
    expect(args?.[1]).toBe('CAT')
    expect(args?.[3]).toBe(ZERO) // fee wallet: the creator
    expect(args?.[4]).toBe(ADDRESSES.WHYPE)
  })

  it('curve launch: HYPE dev buy goes in value, a USDC one needs an approval', async () => {
    const hype = await pad.buildCurveLaunch({ name: 'A', symbol: 'A', devBuy: 5n, launchFee: 1n })
    expect(hype.call.value).toBe(6n)
    expect(hype.approval).toBeNull()
    const usdc = await pad.buildCurveLaunch({ name: 'A', symbol: 'A', quoteToken: ADDRESSES.USDC, devBuy: 5n, launchFee: 1n })
    expect(usdc.call.value).toBe(1n)
    expect(usdc.approval).toEqual({ token: ADDRESSES.USDC, spender: ADDRESSES.pad.curveLauncher, amount: 5n })
  })

  it('enforces the on-chain length limits', async () => {
    await expect(pad.buildLaunch({ name: 'x'.repeat(33), symbol: 'X', launchFee: 0n })).rejects.toThrow(/name/)
    await expect(pad.buildLaunch({ name: 'X', symbol: 'TOOLONGSYMBOL', launchFee: 0n })).rejects.toThrow(/symbol/)
  })

  it('finds the launched token in receipt logs', () => {
    const topics = encodeEventTopics({ abi: abis.curveLauncherAbi, eventName: 'CurveLaunched', args: { token: TOKEN, creator: ME, quote: ADDRESSES.WHYPE } })
    const data = encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint16' }, { type: 'uint16' }],
      [POOL, POOL, 1n, 2n, 0, 0],
    )
    const log = { topics, data } as unknown as Log
    expect(pad.launchedToken([log])?.toLowerCase()).toBe(TOKEN.toLowerCase())
    expect(pad.launchedToken([])).toBeNull()
  })
})

describe('API errors', () => {
  it('carries the HTTP status and the server message', async () => {
    const api = new PadApi({ fetch: fakeFetch(429, { error: 'rate limit exceeded' }) })
    const err = await api.stats().catch((e) => e)
    expect(err).toBeInstanceOf(ElysiumApiError)
    expect(err.status).toBe(429)
    expect(err.message).toMatch(/rate limit exceeded/)
  })
})
