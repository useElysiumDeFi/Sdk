import { decodeEventLog, encodeFunctionData, type Address, type Log, type PublicClient } from 'viem'
import { bondingCurveAbi, curveLauncherAbi, padLauncherAbi, padLockerAbi, taxTokenAbi, v2RouterAbi } from './abis.js'
import type { PadApi } from './api/pad.js'
import { PAD, ZERO, type Addresses } from './constants.js'
import { byteLength, deadlineIn, isNative, minusSlippage, sameAddress, type BuiltTx } from './utils.js'

/** Token metadata stored on-chain. Links must be https:// (images may also be ipfs://). */
export type LaunchMeta = { image?: string; description?: string; website?: string; twitter?: string; telegram?: string }

/**
 * A bonding-curve token's tax. Rates are basis points of each trade (at most 1 000 = 10 % each way). The shares say
 * where the tax goes, in basis points of the tax, and must add up to 10 000 whenever there is a tax.
 */
export type TaxSettings = {
  buyBps: number
  sellBps: number
  burnShareBps?: number
  liquidityShareBps?: number
  /** Up to three wallets with their shares. */
  wallets?: { address: Address; shareBps: number }[]
}

/** The contract's TaxConfig struct. */
export type TaxConfig = {
  buyBps: number
  sellBps: number
  burnShare: number
  liquidityShare: number
  wallets: readonly [Address, Address, Address]
  walletShares: readonly [number, number, number]
}

export type CurveState = {
  token: Address
  curve: Address
  pair: Address
  quote: Address
  creator: Address
  launchedAt: number
  graduated: boolean
  /** Tokens still for sale on the curve. */
  remaining: bigint
  curveSupply: bigint
  startCap: bigint
  gradCap: bigint
  tax: TaxConfig
}

export type CurveTradeQuote = {
  side: 'buy' | 'sell'
  /** On the curve, or (after graduation) through the ElysiumSwap v2 pair. */
  venue: 'curve' | 'v2'
  amountIn: bigint
  /** For buys on the curve: the part of `amountIn` actually used (the rest is refunded near graduation). */
  amountUsed: bigint
  amountOut: bigint
  tax: bigint
}

export class LaunchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LaunchError'
  }
}

/** Checks tax settings the way the token does and converts them to the contract's struct. Throws LaunchError. */
export function toTaxConfig(t: TaxSettings): TaxConfig {
  const int = (n: number, what: string) => {
    if (!Number.isInteger(n) || n < 0 || n > 10_000) throw new LaunchError(`${what} must be a whole number of basis points (0..10000)`)
    return n
  }
  const buyBps = int(t.buyBps, 'buyBps')
  const sellBps = int(t.sellBps, 'sellBps')
  if (buyBps > PAD.maxTaxBps || sellBps > PAD.maxTaxBps) throw new LaunchError(`a tax can be at most ${PAD.maxTaxBps / 100}%`)
  const wallets = t.wallets ?? []
  if (wallets.length > PAD.maxTaxWallets) throw new LaunchError(`at most ${PAD.maxTaxWallets} tax wallets`)
  const burnShare = int(t.burnShareBps ?? 0, 'burnShareBps')
  const liquidityShare = int(t.liquidityShareBps ?? 0, 'liquidityShareBps')
  const shares = wallets.map((w, i) => int(w.shareBps, `wallets[${i}].shareBps`))
  wallets.forEach((w, i) => {
    if (shares[i] > 0 && sameAddress(w.address, ZERO)) throw new LaunchError(`wallets[${i}] is the zero address`)
  })
  const sum = burnShare + liquidityShare + shares.reduce((a, b) => a + b, 0)
  if ((buyBps > 0 || sellBps > 0) && sum !== 10_000) throw new LaunchError(`the tax shares must add up to 10000 basis points (100%), not ${sum}`)
  const pad3 = <T>(xs: T[], fill: T) => [xs[0] ?? fill, xs[1] ?? fill, xs[2] ?? fill] as const
  return { buyBps, sellBps, burnShare, liquidityShare, wallets: pad3(wallets.map((w) => w.address), ZERO), walletShares: pad3(shares, 0) }
}

function checkNames(name: string, symbol: string, meta: LaunchMeta) {
  const L = PAD.limits
  if (!name.trim() || byteLength(name.trim()) > L.name) throw new LaunchError(`name must be 1..${L.name} bytes`)
  if (!symbol.trim() || byteLength(symbol.trim()) > L.symbol) throw new LaunchError(`symbol must be 1..${L.symbol} bytes`)
  if (byteLength(meta.image ?? '') > L.image) throw new LaunchError(`image link is longer than ${L.image} bytes`)
  if (byteLength(meta.description ?? '') > L.description) throw new LaunchError(`description is longer than ${L.description} bytes`)
  for (const k of ['website', 'twitter', 'telegram'] as const) {
    if (byteLength(meta[k] ?? '') > L.social) throw new LaunchError(`${k} is longer than ${L.social} bytes`)
  }
}

const metaStruct = (m: LaunchMeta) => ({ image: m.image ?? '', description: m.description ?? '', website: m.website ?? '', twitter: m.twitter ?? '', telegram: m.telegram ?? '' })

/**
 * ElysiumPad: launch tokens, trade bonding curves, collect creator fees. Builders return `{ call, approval }`; reads
 * go to the chain (pass `PadApi` results in where you already have them).
 */
export class Launchpad {
  constructor(
    readonly publicClient: PublicClient,
    readonly api: PadApi,
    readonly addresses: Addresses,
  ) {}

  // ---------------------------------------------------------------- reads

  /** The launch fee in HYPE wei, for instant ('v3') or bonding-curve ('curve') launches. */
  launchFee(kind: 'v3' | 'curve' = 'v3'): Promise<bigint> {
    return kind === 'curve'
      ? this.publicClient.readContract({ address: this.addresses.pad.curveLauncher, abi: curveLauncherAbi, functionName: 'launchFee' })
      : this.publicClient.readContract({ address: this.addresses.pad.launcher, abi: padLauncherAbi, functionName: 'launchFee' })
  }

  /** Pair tokens instant launches accept, each with its launch market cap (in that token's own units). */
  async instantQuotes(): Promise<{ token: Address; marketCap: bigint }[]> {
    const tokens = await this.publicClient.readContract({ address: this.addresses.pad.launcher, abi: padLauncherAbi, functionName: 'quoteTokens' })
    const caps = await Promise.all(tokens.map((t) => this.publicClient.readContract({ address: this.addresses.pad.launcher, abi: padLauncherAbi, functionName: 'marketCapRef', args: [t] })))
    return tokens.map((token, i) => ({ token, marketCap: caps[i] }))
  }

  /** Pair tokens bonding curves accept, with their start and graduation market caps (raw units of that token). */
  async curveQuotes(): Promise<{ token: Address; enabled: boolean; startCap: bigint; gradCap: bigint }[]> {
    const tokens = await this.publicClient.readContract({ address: this.addresses.pad.curveLauncher, abi: curveLauncherAbi, functionName: 'quotes' })
    const caps = await Promise.all(tokens.map((t) => this.publicClient.readContract({ address: this.addresses.pad.curveLauncher, abi: curveLauncherAbi, functionName: 'quoteCaps', args: [t] })))
    return tokens.map((token, i) => ({ token, enabled: caps[i][0], startCap: caps[i][1], gradCap: caps[i][2] }))
  }

  /** A bonding-curve token's curve, pair, tax and progress, read from the chain. */
  async curveState(token: Address): Promise<CurveState> {
    const pc = this.publicClient
    const [creator, quote, curve, pair, launchedAt] = await pc.readContract({ address: this.addresses.pad.curveLauncher, abi: curveLauncherAbi, functionName: 'launchInfo', args: [token] })
    if (sameAddress(curve, ZERO)) throw new LaunchError(`${token} is not a bonding-curve launch`)
    const [graduated, remaining, curveSupply, startCap, gradCap, tax] = await Promise.all([
      pc.readContract({ address: curve, abi: bondingCurveAbi, functionName: 'graduated' }),
      pc.readContract({ address: curve, abi: bondingCurveAbi, functionName: 'remaining' }),
      pc.readContract({ address: curve, abi: bondingCurveAbi, functionName: 'curveSupply' }),
      pc.readContract({ address: curve, abi: bondingCurveAbi, functionName: 'startCap' }),
      pc.readContract({ address: curve, abi: bondingCurveAbi, functionName: 'gradCap' }),
      pc.readContract({ address: token, abi: taxTokenAbi, functionName: 'taxConfig' }),
    ])
    return { token, curve, pair, quote, creator, launchedAt: Number(launchedAt), graduated, remaining, curveSupply, startCap, gradCap, tax }
  }

  /**
   * Quote a buy (spend `amountIn` of the pair token) or a sell (sell `amountIn` tokens) of a bonding-curve token:
   * on its curve, or through its v2 pair once it has graduated. Tax and fees are already taken off `amountOut`.
   */
  async quoteCurveTrade(p: { token: Address; side: 'buy' | 'sell'; amountIn: bigint; state?: CurveState }): Promise<CurveTradeQuote> {
    const s = p.state ?? (await this.curveState(p.token))
    const pc = this.publicClient
    const a = p.amountIn
    if (!s.graduated) {
      if (p.side === 'buy') {
        const [out, used, tax] = await pc.readContract({ address: s.curve, abi: bondingCurveAbi, functionName: 'quoteBuy', args: [a] })
        return { side: 'buy', venue: 'curve', amountIn: a, amountUsed: used, amountOut: out, tax }
      }
      const [out, tax] = await pc.readContract({ address: s.curve, abi: bondingCurveAbi, functionName: 'quoteSell', args: [a] })
      return { side: 'sell', venue: 'curve', amountIn: a, amountUsed: a, amountOut: out, tax }
    }
    // After graduation: the v2 router's maths doesn't know the token's tax, so it's applied around the quote.
    const router = this.addresses.dex.v2Router
    if (p.side === 'buy') {
      const amounts = await pc.readContract({ address: router, abi: v2RouterAbi, functionName: 'getAmountsOut', args: [a, [s.quote, s.token]] })
      const gross = amounts[1]
      const tax = (gross * BigInt(s.tax.buyBps)) / 10_000n
      return { side: 'buy', venue: 'v2', amountIn: a, amountUsed: a, amountOut: gross - tax, tax }
    }
    const tax = (a * BigInt(s.tax.sellBps)) / 10_000n
    const amounts = await pc.readContract({ address: router, abi: v2RouterAbi, functionName: 'getAmountsOut', args: [a - tax, [s.token, s.quote]] })
    return { side: 'sell', venue: 'v2', amountIn: a, amountUsed: a, amountOut: amounts[1], tax }
  }

  // ---------------------------------------------------------------- builders

  /**
   * An instant launch: the whole supply goes into a locked 1 % ElysiumSwap v3 pool against `quoteToken` (WHYPE by
   * default). `devBuy` is an optional first buy, always paid in HYPE. `launchFee` is read from the chain if omitted.
   */
  async buildLaunch(p: {
    name: string
    symbol: string
    meta?: LaunchMeta
    quoteToken?: Address
    /** Receives the creator's 70 % of trading fees (default: the zero address, which means the creator). */
    feeWallet?: Address
    devBuy?: bigint
    minTokensOut?: bigint
    launchFee?: bigint
  }): Promise<BuiltTx> {
    const meta = p.meta ?? {}
    checkNames(p.name, p.symbol, meta)
    const fee = p.launchFee ?? (await this.launchFee('v3'))
    const data = encodeFunctionData({
      abi: padLauncherAbi,
      functionName: 'launch',
      args: [p.name.trim(), p.symbol.trim().toUpperCase(), metaStruct(meta), p.feeWallet ?? ZERO, p.quoteToken ?? this.addresses.WHYPE, p.minTokensOut ?? 0n],
    })
    return { call: { to: this.addresses.pad.launcher, data, value: fee + (p.devBuy ?? 0n) }, approval: null }
  }

  /**
   * A bonding-curve launch against `quoteToken` (WHYPE by default) with optional tax. `devBuy` is an optional first
   * buy in the pair token; with WHYPE it's paid in HYPE (no approval), otherwise it needs an approval.
   */
  async buildCurveLaunch(p: {
    name: string
    symbol: string
    meta?: LaunchMeta
    quoteToken?: Address
    tax?: TaxSettings
    devBuy?: bigint
    minTokensOut?: bigint
    launchFee?: bigint
  }): Promise<BuiltTx> {
    const meta = p.meta ?? {}
    checkNames(p.name, p.symbol, meta)
    const quote = p.quoteToken && !isNative(p.quoteToken) ? p.quoteToken : this.addresses.WHYPE
    const tax = toTaxConfig(p.tax ?? { buyBps: 0, sellBps: 0 })
    const fee = p.launchFee ?? (await this.launchFee('curve'))
    const dev = p.devBuy ?? 0n
    const native = sameAddress(quote, this.addresses.WHYPE)
    const to = this.addresses.pad.curveLauncher
    const data = encodeFunctionData({
      abi: curveLauncherAbi,
      functionName: 'launch',
      args: [p.name.trim(), p.symbol.trim().toUpperCase(), metaStruct(meta), quote, tax, native ? 0n : dev, p.minTokensOut ?? 0n],
    })
    return {
      call: { to, data, value: fee + (native ? dev : 0n) },
      approval: !native && dev > 0n ? { token: quote, spender: to, amount: dev } : null,
    }
  }

  /**
   * Buy or sell a bonding-curve token, on its curve or (after graduation) through its v2 pair. With `native`, buys
   * pay HYPE and sells receive HYPE (WHYPE-paired tokens only). `slippageBps` defaults to 100 (1 %).
   */
  async buildCurveTrade(p: {
    token: Address
    side: 'buy' | 'sell'
    amountIn: bigint
    recipient: Address
    native?: boolean
    slippageBps?: number
    deadline?: bigint
    state?: CurveState
  }): Promise<BuiltTx & { quote: CurveTradeQuote; minAmountOut: bigint }> {
    const s = p.state ?? (await this.curveState(p.token))
    const native = !!p.native
    if (native && !sameAddress(s.quote, this.addresses.WHYPE)) throw new LaunchError('native HYPE trades need a WHYPE-paired token')
    const q = await this.quoteCurveTrade({ token: p.token, side: p.side, amountIn: p.amountIn, state: s })
    const min = minusSlippage(q.amountOut, p.slippageBps ?? 100)
    const deadline = p.deadline ?? deadlineIn()
    const a = p.amountIn
    const me = p.recipient
    let built: BuiltTx
    if (!s.graduated) {
      const to = s.curve
      if (p.side === 'buy') {
        built = native
          ? { call: { to, data: encodeFunctionData({ abi: bondingCurveAbi, functionName: 'buyWithNative', args: [min, me, deadline] }), value: a }, approval: null }
          : { call: { to, data: encodeFunctionData({ abi: bondingCurveAbi, functionName: 'buy', args: [a, min, me, deadline] }), value: 0n }, approval: { token: s.quote, spender: to, amount: a } }
      } else {
        built = { call: { to, data: encodeFunctionData({ abi: bondingCurveAbi, functionName: native ? 'sellToNative' : 'sell', args: [a, min, me, deadline] }), value: 0n }, approval: { token: s.token, spender: to, amount: a } }
      }
    } else {
      const to = this.addresses.dex.v2Router
      if (p.side === 'buy') {
        built = native
          ? { call: { to, data: encodeFunctionData({ abi: v2RouterAbi, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens', args: [min, [s.quote, s.token], me, deadline] }), value: a }, approval: null }
          : { call: { to, data: encodeFunctionData({ abi: v2RouterAbi, functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens', args: [a, min, [s.quote, s.token], me, deadline] }), value: 0n }, approval: { token: s.quote, spender: to, amount: a } }
      } else {
        const fn = native ? 'swapExactTokensForETHSupportingFeeOnTransferTokens' : 'swapExactTokensForTokensSupportingFeeOnTransferTokens'
        built = { call: { to, data: encodeFunctionData({ abi: v2RouterAbi, functionName: fn, args: [a, min, [s.token, s.quote], me, deadline] }), value: 0n }, approval: { token: s.token, spender: to, amount: a } }
      }
    }
    return { ...built, quote: q, minAmountOut: min }
  }

  /** Collect an instant launch's trading fees (anyone can call it; the split is fixed by the locker). */
  buildCollectFees(token: Address): BuiltTx {
    return { call: { to: this.addresses.pad.locker, data: encodeFunctionData({ abi: padLockerAbi, functionName: 'collectFees', args: [token] }), value: 0n }, approval: null }
  }

  /** Hand an instant launch's creator fees to a new wallet (only the current fee wallet can). */
  buildSetFeeWallet(token: Address, newWallet: Address): BuiltTx {
    return { call: { to: this.addresses.pad.locker, data: encodeFunctionData({ abi: padLockerAbi, functionName: 'setFeeWallet', args: [token, newWallet] }), value: 0n }, approval: null }
  }

  /** After graduation: add a curve token's collected liquidity tax to its v2 pair (anyone can call it). */
  buildAddLiquidity(token: Address): BuiltTx {
    return { call: { to: token, data: encodeFunctionData({ abi: taxTokenAbi, functionName: 'addLiquidity' }), value: 0n }, approval: null }
  }

  /** The token a launch transaction created, from its receipt logs (instant or bonding-curve). */
  launchedToken(logs: readonly Log[]): Address | null {
    for (const log of logs) {
      for (const abi of [padLauncherAbi, curveLauncherAbi] as const) {
        try {
          const ev = decodeEventLog({ abi, data: log.data, topics: log.topics })
          if (ev.eventName === 'TokenLaunched' || ev.eventName === 'CurveLaunched') return ev.args.token
        } catch {
          // another contract's log
        }
      }
    }
    return null
  }
}
