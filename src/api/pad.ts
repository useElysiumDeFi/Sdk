import type { Address, Hex } from 'viem'
import { API_URLS } from '../constants.js'
import { createHttp, type HttpOptions } from './http.js'

export type PadMeta = { image: string; description: string; website: string; twitter: string; telegram: string }

export type PadTax = {
  buyBps: number
  sellBps: number
  burnShareBps: number
  liquidityShareBps: number
  wallets: { address: Address; shareBps: number }[]
}

/** Bonding-curve launches only. Token amounts are base-unit strings. */
export type PadCurveInfo = {
  curve: Address
  pair: Address
  graduated: boolean
  graduatedAt: number | null
  /** 0..100: share of the curve's tokens sold. */
  progressPct: number
  curveSupply: string
  remaining: string
  gradCap: string
  gradCapUsd: number
  tax: PadTax
}

export type PadLaunch = {
  /** "v3": an instant launch into a locked v3 position. "curve": a bonding-curve launch that graduates to v2. */
  kind: 'v3' | 'curve'
  curve: PadCurveInfo | null
  address: Address
  name: string
  symbol: string
  meta: PadMeta
  creator: Address
  feeWallet: Address
  quote: { address: Address; symbol: string; decimals: number; usd: number }
  pool: Address
  positionId: string
  tokenIsToken0: boolean
  launchedAt: number
  launchTx: Hex
  priceQuote: number
  priceUsd: number
  mcapUsd: number
  launchMcapUsd: number
  athMcapUsd: number
  liquidityUsd: number
  poolTokens: string
  poolQuote: string
  soldPct: number
  volume24hUsd: number
  volumeUsd: number
  buys24h: number
  sells24h: number
  trades: number
  change24h: number
  holders: number
  lastTradeAt: number | null
  feesCreatorUsd: number
}

export type PadTrade = {
  block: number
  logIndex: number
  txHash: Hex
  ts: number
  token: Address
  trader: Address
  side: 'buy' | 'sell'
  tokenAmount: string
  quoteAmount: string
  priceQuote: number
  priceUsd: number
  volumeUsd: number
  mcapUsd: number
}

export type PadHolder = { address: Address; balance: string; percent: number; label: 'pool' | 'curve' | 'tax' | 'burned' | 'locker' | 'launcher' | null }

export type PadClaim = { txHash: Hex; ts: number; token: Address; feeWallet: Address; creatorToken: string; creatorQuote: string; creatorUsd: number }

/** Prices in the pair token. */
export type PadCandle = { t: number; open: number; high: number; low: number; close: number; volumeUsd: number; trades: number; buys: number }

export type PadStats = {
  now: number
  block: number
  hypeUsd: number
  launches: number
  launches24h: number
  volume24hUsd: number
  trades24h: number
  totalMcapUsd: number
  feesCreatorUsd: number
}

export type PadLaunchDetail = { trades: PadTrade[]; holders: PadHolder[]; claims: PadClaim[] }

export type PadSnapshot = {
  now: number
  block: number
  hypeUsd: number
  /** Newest first. */
  launches: PadLaunch[]
  /** By token address (lowercase): latest trades, top holders, fee claims. */
  details: Record<string, PadLaunchDetail>
}

export type PadSort = 'new' | 'mcap' | 'volume' | 'trending'

/** Client for the ElysiumPad API: launches, trades, holders, candles, leaderboards and accounts. */
export class PadApi {
  private readonly request

  constructor(opts: Partial<HttpOptions> = {}) {
    this.request = createHttp({ baseUrl: API_URLS.pad, ...opts })
  }

  /** Totals across ElysiumPad, plus HYPE/USD. */
  stats(): Promise<PadStats> {
    return this.request('/v1/stats')
  }

  /** Every launch with its latest trades, top holders and fee claims, in one request. */
  snapshot(): Promise<PadSnapshot> {
    return this.request('/v1/snapshot')
  }

  /** A page of launches (at most 100). */
  launches(p: { sort?: PadSort; q?: string; creator?: Address; limit?: number; offset?: number } = {}): Promise<{ now: number; total: number; launches: PadLaunch[] }> {
    return this.request('/v1/launches', { sort: p.sort, q: p.q, creator: p.creator?.toLowerCase(), limit: p.limit, offset: p.offset })
  }

  /** One launch with its latest 50 trades, top 20 holders and latest fee claims. */
  launch(token: Address): Promise<{ now: number; launch: PadLaunch } & PadLaunchDetail> {
    return this.request(`/v1/launches/${token.toLowerCase()}`)
  }

  /** A launch's trades, newest first. Pass the previous page's `next` as `before`. */
  trades(token: Address, p: { limit?: number; before?: string } = {}): Promise<{ token: Address; trades: PadTrade[]; next: string | null }> {
    return this.request(`/v1/launches/${token.toLowerCase()}/trades`, { limit: p.limit, before: p.before })
  }

  holders(token: Address, p: { limit?: number } = {}): Promise<{ token: Address; holders: PadHolder[]; count: number }> {
    return this.request(`/v1/launches/${token.toLowerCase()}/holders`, { limit: p.limit })
  }

  /** OHLC candles in the pair token, oldest first. `res`: 300 (5 min), 3600 (1 h) or 86400 (1 day). */
  candles(token: Address, p: { res?: 300 | 3_600 | 86_400; limit?: number } = {}): Promise<{ token: Address; res: number; candles: PadCandle[] }> {
    return this.request(`/v1/launches/${token.toLowerCase()}/candles`, { res: p.res, limit: p.limit })
  }

  /** 24h market-cap series for up to 40 tokens (sparklines). */
  sparklines(tokens: Address[], p: { points?: number } = {}): Promise<{ now: number; series: Record<string, number[]> }> {
    return this.request('/v1/sparklines', { tokens: tokens.map((t) => t.toLowerCase()).join(','), points: p.points })
  }

  /** New launches and trades across ElysiumPad, newest first. */
  activity(p: { limit?: number } = {}): Promise<{ now: number; items: unknown[] }> {
    return this.request('/v1/activity', { limit: p.limit })
  }

  creators(p: { limit?: number } = {}): Promise<{ now: number; creators: { address: Address; launches: number; mcapUsd: number; volumeUsd: number; feesUsd: number }[] }> {
    return this.request('/v1/leaderboard/creators', { limit: p.limit })
  }

  traders(p: { period?: '24h' | 'all'; limit?: number } = {}): Promise<{ now: number; traders: { address: Address; volumeUsd: number; trades: number; buys: number; sells: number; tokens: number; volume24hUsd: number }[] }> {
    return this.request('/v1/leaderboard/traders', { period: p.period, limit: p.limit })
  }

  /** A wallet's holdings, launches, trades and fee claims on ElysiumPad. */
  account(address: Address): Promise<{
    now: number
    address: Address
    valueUsd: number
    feesEarnedUsd: number
    tradedVolumeUsd: number
    holdings: { token: PadLaunch; balance: string; valueUsd: number; percent: number }[]
    created: PadLaunch[]
    trades: PadTrade[]
    claims: PadClaim[]
  }> {
    return this.request(`/v1/accounts/${address.toLowerCase()}`)
  }
}
