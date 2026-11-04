import type { Address, Hex } from 'viem'
import { API_URLS } from '../constants.js'
import { createHttp, ElysiumApiError, type HttpOptions } from './http.js'

/** One hop of a route, as the Aggregator executes it. kind: 0 = v2, 1 = v3, 2 = v4. */
export type RouteLeg = {
  kind: number
  pool: Address
  tokenIn: Address
  tokenOut: Address
  fee: number
  tickSpacing: number
  hooks: Address
  hookData: Hex
  protocol: 'v2' | 'v3' | 'v4'
  /** Factory (v2/v3) or PoolManager (v4): which DEX the pool belongs to. */
  source: Address
  /** An ElysiumSwap pool. */
  own: boolean
}

export type RoutePath = { shareBps: number; tokens: Address[]; legs: RouteLeg[] }

/** The best split route for an exact-input trade (HYPE as WHYPE). Amounts are base-unit strings. */
export type ApiRoute = {
  amountIn: string
  amountOut: string
  feeOnOutput: boolean
  routerFeeBps: number
  priceImpact: number
  lpFee: number
  paths: RoutePath[]
}

export type MarketToken = {
  address: Address
  symbol: string
  name: string
  decimals: number
  priceUsd: number | null
  liquidityUsd: number
  supply: number | null
  marketCapUsd: number | null
  volume24hUsd: number
  change24h: number | null
  pools: number
  /** In the `include` list of the request. */
  listed: boolean
  /** Traded through ElysiumSwap's pools or the Aggregator. */
  traded: boolean
}

export type MarketPool = {
  id: string
  protocol: 'v2' | 'v3' | 'v4'
  source: Address
  token0: Address
  token1: Address
  symbol0: string | null
  symbol1: string | null
  decimals0: number | null
  decimals1: number | null
  fee: number
  hooks: Address
  own: boolean
  reserve0: number
  reserve1: number
  tvlUsd: number
  volume24hUsd: number
}

export type MarketTokenDetail = Omit<MarketToken, 'change24h' | 'pools' | 'listed' | 'traded'> & { pools: MarketPool[] }

/** One of ElysiumSwap's own pools. Reserves are raw units; sqrtPrice is sqrtPriceX96 / 2^96 (v3; 0 for v2). */
export type OwnPool = {
  id: Address
  protocol: 'v2' | 'v3'
  token0: Address
  token1: Address
  fee: number
  reserve0: number
  reserve1: number
  sqrtPrice: number
  liquidity: number
  tvlUsd: number
  volume24hUsd: number
  symbol0: string | null
  symbol1: string | null
  decimals0: number | null
  decimals1: number | null
  name0: string | null
  name1: string | null
}

export type MarketOverview = {
  now: number
  /** Liquidity in ElysiumSwap's own pools. */
  ownTvlUsd: number
  ownPools: number
  /** Liquidity across every DEX on Elysium. */
  tvlUsd: number
  pools: number
  topPools: Omit<OwnPool, 'reserve0' | 'reserve1' | 'sqrtPrice' | 'liquidity' | 'volume24hUsd'>[]
}

export type MarketTrade = {
  via: 'aggregator' | 'elysiumswap'
  block: number
  logIndex: number
  ts: number
  tx: Hex
  account: Address | null
  tokenIn: Address
  tokenOut: Address
  amountIn: string
  amountOut: string
  amountUsd: number
}

/**
 * Client for the ElysiumSwap market API: routing and market data across every DEX on Elysium.
 * Routes are quotes, not guarantees: `Dex.quote` re-checks them on-chain before you trade.
 */
export class MarketApi {
  private readonly request

  constructor(opts: Partial<HttpOptions> = {}) {
    this.request = createHttp({ baseUrl: API_URLS.market, ...opts })
  }

  /** Best split route for selling `amountIn` of `tokenIn`, or null when there's no route. Use WHYPE for HYPE. */
  async route(p: { tokenIn: Address; tokenOut: Address; amountIn: bigint; feeOnOutput?: boolean }): Promise<ApiRoute | null> {
    try {
      return await this.request<ApiRoute>('/v1/route', {
        tokenIn: p.tokenIn,
        tokenOut: p.tokenOut,
        amountIn: p.amountIn.toString(),
        feeOnOutput: p.feeOnOutput ?? false,
      })
    } catch (e) {
      if (e instanceof ElysiumApiError && e.status === 404) return null
      throw e
    }
  }

  /** Tokens in `include` plus every token traded through ElysiumSwap, deepest liquidity first. */
  async tokens(p: { include?: Address[]; limit?: number } = {}): Promise<{ now: number; tokens: MarketToken[] }> {
    return this.request('/v1/market/tokens', { include: p.include?.length ? p.include.map((a) => a.toLowerCase()).join(',') : undefined, limit: p.limit })
  }

  /** One token: price, liquidity, market cap, 24h volume and every pool it's in (on any DEX). */
  async token(address: Address): Promise<MarketTokenDetail> {
    return this.request(`/v1/market/tokens/${address.toLowerCase()}`)
  }

  /** ElysiumSwap's own pools with their latest state. */
  async pools(p: { limit?: number } = {}): Promise<{ now: number; pools: OwnPool[] }> {
    return this.request('/v1/market/pools', { limit: p.limit })
  }

  /** Headline numbers: liquidity in ElysiumSwap's pools and across Elysium, and the deepest pools. */
  async overview(): Promise<MarketOverview> {
    return this.request('/v1/market/overview')
  }

  /** Trades through ElysiumSwap (its pools and the Aggregator), newest first. */
  async trades(p: { token?: Address; account?: Address; limit?: number } = {}): Promise<{ trades: MarketTrade[] }> {
    return this.request('/v1/market/trades', { token: p.token?.toLowerCase(), account: p.account?.toLowerCase(), limit: p.limit })
  }
}
