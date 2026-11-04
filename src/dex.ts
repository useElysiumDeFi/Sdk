import { encodeFunctionData, type Address, type Hex, type PublicClient } from 'viem'
import { aggregatorAbi, v2RouterAbi, v3QuoterAbi, v3RouterAbi, wethAbi } from './abis.js'
import type { MarketApi, RoutePath } from './api/market.js'
import { AGGREGATOR_FEE_BPS, ZERO, type Addresses } from './constants.js'
import { deadlineIn, encodeV3Path, isNative, minusSlippage, sameAddress, wrapped, type BuiltTx } from './utils.js'

/** One hop, as the Aggregator's `swap` takes it. */
export type AggLeg = { kind: number; pool: Address; tokenIn: Address; tokenOut: Address; fee: number; tickSpacing: number; hooks: Address; hookData: Hex }
export type AggPath = { shareBps: number; legs: AggLeg[] }

export type SwapQuote =
  | { kind: 'wrap' | 'unwrap'; tokenIn: Address; tokenOut: Address; amountIn: bigint; amountOut: bigint }
  | {
      kind: 'aggregator'
      tokenIn: Address
      tokenOut: Address
      amountIn: bigint
      /** What the chain pays for this exact split right now, after the Aggregator's 0.1 % fee. */
      amountOut: bigint
      /** What the market API quoted (the chain's figure above is the one to use). */
      apiAmountOut: bigint
      /** The 0.1 % fee is taken from the output (true) or the input (false). */
      feeOnOutput: boolean
      priceImpact: number
      lpFee: number
      /** The split as the Aggregator executes it. */
      paths: AggPath[]
      /** The same split with token paths, DEX sources and ElysiumSwap flags, for display. */
      route: RoutePath[]
    }

/** The market API's route didn't check out on-chain. */
export class RouteCheckError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RouteCheckError'
  }
}

/**
 * Swaps on Elysium. `quote` finds the best split across every DEX through the market API and re-quotes it on-chain
 * through the Aggregator. `buildSwap` turns a quote into a transaction. The direct v2/v3 helpers trade on
 * ElysiumSwap's own pools along a path you choose, without the Aggregator's fee.
 */
export class Dex {
  constructor(
    readonly publicClient: PublicClient,
    readonly market: MarketApi,
    readonly addresses: Addresses,
  ) {}

  /** HYPE, WHYPE and USDC count as "base" assets: the Aggregator takes its fee in them when it can. */
  private isBase(a: Address) {
    return isNative(a) || sameAddress(a, this.addresses.WHYPE) || sameAddress(a, this.addresses.USDC)
  }

  /** The fee is taken from the output when the trade pays out a base asset and doesn't sell one. */
  feeOnOutput(tokenIn: Address, tokenOut: Address) {
    return this.isBase(tokenOut) && !this.isBase(tokenIn)
  }

  /**
   * Best exact-input quote for selling `amountIn` of `tokenIn` (use `NATIVE` for HYPE). Returns null when no
   * route exists. With `verify` (the default) the split is re-quoted on-chain and `amountOut` is the chain's figure;
   * a route the chain can't fill throws `RouteCheckError`.
   */
  async quote(p: { tokenIn: Address; tokenOut: Address; amountIn: bigint; verify?: boolean }): Promise<SwapQuote | null> {
    const { tokenIn, tokenOut, amountIn } = p
    if (amountIn <= 0n) throw new RangeError('amountIn must be positive')
    const W = this.addresses.WHYPE
    if (isNative(tokenIn) && sameAddress(tokenOut, W)) return { kind: 'wrap', tokenIn, tokenOut, amountIn, amountOut: amountIn }
    if (sameAddress(tokenIn, W) && isNative(tokenOut)) return { kind: 'unwrap', tokenIn, tokenOut, amountIn, amountOut: amountIn }
    const tIn = wrapped(tokenIn, W)
    const tOut = wrapped(tokenOut, W)
    if (sameAddress(tIn, tOut)) throw new Error('tokenIn and tokenOut are the same asset')

    const feeOnOutput = this.feeOnOutput(tokenIn, tokenOut)
    const r = await this.market.route({ tokenIn: tIn, tokenOut: tOut, amountIn, feeOnOutput })
    if (!r) return null
    if (BigInt(r.amountIn) !== amountIn || r.feeOnOutput !== feeOnOutput) throw new RouteCheckError('the API answered for a different trade')
    if (!r.paths.length || r.paths.length > 8 || r.paths.reduce((s, x) => s + x.shareBps, 0) !== 10_000) throw new RouteCheckError('the route split is malformed')
    for (const path of r.paths) {
      // HYPE is address(0) on v4 legs; to the route it's WHYPE.
      const asW = (a: Address) => (sameAddress(a, ZERO) ? W : a)
      const first = path.legs[0]
      const last = path.legs[path.legs.length - 1]
      if (!first || !sameAddress(asW(first.tokenIn), tIn) || !sameAddress(asW(last.tokenOut), tOut)) throw new RouteCheckError('a route path does not connect the two tokens')
    }

    const paths: AggPath[] = r.paths.map((x) => ({
      shareBps: x.shareBps,
      legs: x.legs.map((l) => ({ kind: l.kind, pool: l.pool, tokenIn: l.tokenIn, tokenOut: l.tokenOut, fee: l.fee, tickSpacing: l.tickSpacing, hooks: l.hooks, hookData: '0x' as Hex })),
    }))
    const apiAmountOut = BigInt(r.amountOut)
    const amountOut = p.verify === false ? apiAmountOut : await this.checkOnChain(paths, amountIn, feeOnOutput)
    return { kind: 'aggregator', tokenIn, tokenOut, amountIn, amountOut, apiAmountOut, feeOnOutput, priceImpact: r.priceImpact, lpFee: r.lpFee, paths, route: r.paths }
  }

  /** Re-quotes exactly what `swap` will run (the last path takes the remainder) in one eth_call. */
  private async checkOnChain(paths: AggPath[], amountIn: bigint, feeOnOutput: boolean): Promise<bigint> {
    const afterFee = feeOnOutput ? amountIn : amountIn - (amountIn * BigInt(AGGREGATOR_FEE_BPS)) / 10_000n
    let left = afterFee
    const parts = paths.map((x, i) => {
      const part = i === paths.length - 1 ? left : (afterFee * BigInt(x.shareBps)) / 10_000n
      left -= part
      return part
    })
    const { result } = await this.publicClient.simulateContract({
      address: this.addresses.dex.aggregator,
      abi: aggregatorAbi,
      functionName: 'quoteMulti',
      args: [paths.map((x) => x.legs), parts],
    })
    const outs = paths.map((_, i) => result[i]?.[i] ?? 0n)
    if (outs.some((o) => o === 0n)) throw new RouteCheckError('a path of the route cannot be filled on-chain right now')
    const raw = outs.reduce((a, b) => a + b, 0n)
    return feeOnOutput ? raw - (raw * BigInt(AGGREGATOR_FEE_BPS)) / 10_000n : raw
  }

  /**
   * The transaction for a quote. `slippageBps` (default 50 = 0.5 %) sets the minimum received. Selling an ERC-20
   * needs `approval` first; selling HYPE sends it as the transaction's value.
   */
  buildSwap(quote: SwapQuote, o: { recipient: Address; slippageBps?: number; deadline?: bigint }): BuiltTx & { minAmountOut: bigint } {
    const W = this.addresses.WHYPE
    if (quote.kind !== 'aggregator') {
      // HYPE <-> WHYPE is 1:1 through the WHYPE contract.
      const data = quote.kind === 'wrap' ? encodeFunctionData({ abi: wethAbi, functionName: 'deposit' }) : encodeFunctionData({ abi: wethAbi, functionName: 'withdraw', args: [quote.amountIn] })
      return { call: { to: W, data, value: quote.kind === 'wrap' ? quote.amountIn : 0n }, approval: null, minAmountOut: quote.amountOut }
    }
    const minAmountOut = minusSlippage(quote.amountOut, o.slippageBps ?? 50)
    const nativeIn = isNative(quote.tokenIn)
    const to = this.addresses.dex.aggregator
    const data = encodeFunctionData({
      abi: aggregatorAbi,
      functionName: 'swap',
      args: [{
        tokenIn: nativeIn ? ZERO : quote.tokenIn,
        tokenOut: isNative(quote.tokenOut) ? ZERO : quote.tokenOut,
        amountIn: quote.amountIn,
        minAmountOut,
        recipient: o.recipient,
        deadline: o.deadline ?? deadlineIn(),
        feeOnOutput: quote.feeOnOutput,
        paths: quote.paths,
      }],
    })
    return {
      call: { to, data, value: nativeIn ? quote.amountIn : 0n },
      approval: nativeIn ? null : { token: quote.tokenIn, spender: to, amount: quote.amountIn },
      minAmountOut,
    }
  }

  // ---------------------------------------------------------------- ElysiumSwap pools directly

  /** Exact-input quote through ElysiumSwap v2 along `path` (use WHYPE for HYPE). */
  async quoteV2(path: Address[], amountIn: bigint): Promise<bigint> {
    const amounts = await this.publicClient.readContract({ address: this.addresses.dex.v2Router, abi: v2RouterAbi, functionName: 'getAmountsOut', args: [amountIn, path] })
    return amounts[amounts.length - 1]
  }

  /** Exact-input quote through ElysiumSwap v3 along `tokens`, with one fee tier per hop (use WHYPE for HYPE). */
  async quoteV3(tokens: Address[], fees: number[], amountIn: bigint): Promise<bigint> {
    const [amountOut] = await this.publicClient.readContract({ address: this.addresses.dex.v3Quoter, abi: v3QuoterAbi, functionName: 'quoteExactInput', args: [encodeV3Path(tokens, fees), amountIn] })
    return amountOut
  }

  /**
   * Exact-input swap on ElysiumSwap v2 along `path`. The first or last token may be NATIVE (HYPE); the rest of the
   * path uses WHYPE. `amountOutMin` is yours to set (e.g. `minusSlippage(await quoteV2(...), 50)`).
   */
  buildV2Swap(p: { path: Address[]; amountIn: bigint; amountOutMin: bigint; recipient: Address; deadline?: bigint }): BuiltTx {
    if (p.path.length < 2) throw new Error('a path needs at least two tokens')
    const W = this.addresses.WHYPE
    const nativeIn = isNative(p.path[0])
    const nativeOut = isNative(p.path[p.path.length - 1])
    const path = p.path.map((a) => wrapped(a, W))
    const to = this.addresses.dex.v2Router
    const deadline = p.deadline ?? deadlineIn()
    const data = nativeIn
      ? encodeFunctionData({ abi: v2RouterAbi, functionName: 'swapExactETHForTokens', args: [p.amountOutMin, path, p.recipient, deadline] })
      : nativeOut
        ? encodeFunctionData({ abi: v2RouterAbi, functionName: 'swapExactTokensForETH', args: [p.amountIn, p.amountOutMin, path, p.recipient, deadline] })
        : encodeFunctionData({ abi: v2RouterAbi, functionName: 'swapExactTokensForTokens', args: [p.amountIn, p.amountOutMin, path, p.recipient, deadline] })
    return { call: { to, data, value: nativeIn ? p.amountIn : 0n }, approval: nativeIn ? null : { token: path[0], spender: to, amount: p.amountIn } }
  }

  /** Exact-input swap on ElysiumSwap v3 along `tokens` and `fees`. The first or last token may be NATIVE (HYPE). */
  buildV3Swap(p: { tokens: Address[]; fees: number[]; amountIn: bigint; amountOutMin: bigint; recipient: Address; deadline?: bigint }): BuiltTx {
    const W = this.addresses.WHYPE
    const nativeIn = isNative(p.tokens[0])
    const nativeOut = isNative(p.tokens[p.tokens.length - 1])
    const tokens = p.tokens.map((a) => wrapped(a, W))
    const to = this.addresses.dex.v3Router
    // Native out: the router receives WHYPE, then unwraps it to the recipient.
    const swap = encodeFunctionData({
      abi: v3RouterAbi,
      functionName: 'exactInput',
      args: [{ path: encodeV3Path(tokens, p.fees), recipient: nativeOut ? to : p.recipient, deadline: p.deadline ?? deadlineIn(), amountIn: p.amountIn, amountOutMinimum: p.amountOutMin }],
    })
    const data = nativeOut
      ? encodeFunctionData({ abi: v3RouterAbi, functionName: 'multicall', args: [[swap, encodeFunctionData({ abi: v3RouterAbi, functionName: 'unwrapWETH9', args: [p.amountOutMin, p.recipient] })]] })
      : swap
    return { call: { to, data, value: nativeIn ? p.amountIn : 0n }, approval: nativeIn ? null : { token: tokens[0], spender: to, amount: p.amountIn } }
  }
}
