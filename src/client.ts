import { createPublicClient, fallback, http, type PublicClient } from 'viem'
import { MarketApi } from './api/market.js'
import { PadApi } from './api/pad.js'
import { ADDRESSES, API_URLS, elysium, type Addresses } from './constants.js'
import { Dex } from './dex.js'
import { Launchpad } from './launchpad.js'

export type ElysiumClientOptions = {
  /** Your own viem public client for Elysium. If omitted, one is created from `rpcUrl`. */
  publicClient?: PublicClient
  /**
   * RPC endpoint(s), tried in order. Default: the public relay (keyless, rate-limited per IP), then Elysium's public
   * RPC. For bots and backends, use an API-key URL (https://rpc.elysiumswap.finance/<key>).
   */
  rpcUrl?: string | string[]
  /** Override the market API URL (default https://api.elysiumswap.finance). */
  marketApiUrl?: string
  /** Override the ElysiumPad API URL (default https://api.elysiumpad.fun). */
  padApiUrl?: string
  /** API request timeout in milliseconds (default 10 000). */
  apiTimeoutMs?: number
  /** A fetch implementation for the API clients (default: the global fetch). */
  fetch?: typeof fetch
  /** Override contract addresses (for a fork or a test deployment). */
  addresses?: Addresses
}

export type ElysiumClient = {
  chain: typeof elysium
  addresses: Addresses
  publicClient: PublicClient
  market: MarketApi
  padApi: PadApi
  dex: Dex
  launchpad: Launchpad
}

/** Everything in one place: chain, addresses, both API clients, and the DEX and launchpad modules. */
export function createElysiumClient(o: ElysiumClientOptions = {}): ElysiumClient {
  const urls = o.rpcUrl === undefined ? [...elysium.rpcUrls.default.http] : Array.isArray(o.rpcUrl) ? o.rpcUrl : [o.rpcUrl]
  const publicClient =
    o.publicClient ??
    (createPublicClient({
      chain: elysium,
      transport: urls.length > 1 ? fallback(urls.map((u) => http(u, { batch: true }))) : http(urls[0], { batch: true }),
    }) as PublicClient)
  const addresses = o.addresses ?? ADDRESSES
  const market = new MarketApi({ baseUrl: o.marketApiUrl ?? API_URLS.market, timeoutMs: o.apiTimeoutMs, fetch: o.fetch })
  const padApi = new PadApi({ baseUrl: o.padApiUrl ?? API_URLS.pad, timeoutMs: o.apiTimeoutMs, fetch: o.fetch })
  return {
    chain: elysium,
    addresses,
    publicClient,
    market,
    padApi,
    dex: new Dex(publicClient, market, addresses),
    launchpad: new Launchpad(publicClient, padApi, addresses),
  }
}
