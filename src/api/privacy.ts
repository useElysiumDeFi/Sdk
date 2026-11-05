import type { Address, Hex } from 'viem'
import { API_URLS } from '../constants.js'
import { createHttp, type HttpOptions } from './http.js'

/** One ElysiumSwap Private pool. Amounts are base-unit strings. */
export type PrivacyPool = {
  address: Address
  /** The pooled token; 0xEeee…EEeE for HYPE. */
  asset: Address
  native: boolean
  /** The pool's Privacy Pools scope (a uint256, as a decimal string). */
  scope: string
  /** Deployment block. */
  block: number
  /** Unregistered from the Entrypoint. */
  removed: boolean
  /** Wound down: no new deposits; funds can still leave. */
  dead: boolean
  deposits: number
  ragequits: number
  /** Leaves in the pool's commitment tree (deposits plus withdrawal change). */
  leaves: number
  /** What the pool holds. */
  balance: string
  minimumDeposit: string | null
  vettingFeeBPS: number | null
  maxRelayFeeBPS: number | null
}

export type PrivacyConfig = {
  chainId: number
  entrypoint: Address
  /** Indexed up to this block (and its timestamp). */
  block: number
  ts: number
  pools: PrivacyPool[]
  relayer: {
    enabled: boolean
    address?: Address
    /** HYPE left for gas, in wei. */
    balance?: string | null
    feeBPS?: number
    feeRecipient?: Address
    /** Smallest fee per asset (lowercase address -> base units). */
    minFee?: Record<string, string>
    privateSwap?: Address
    privatePay?: Address
    privateLaunch?: Address
  }
  /** Screening: a deposit becomes usable privately about `delaySecs` after it's made; the set is reposted every `intervalSecs`. */
  asp: { delaySecs: number; intervalSecs: number; worker: boolean }
}

/** The approved set: deposit labels that passed screening, and the root posted on-chain for them. */
export type PrivacyApprovedSet = { root: string | null; cid?: string; ts?: number; block?: number; labels: string[] }

export type PrivacyDeposit = {
  label: string
  commitment: string
  precommitment: string
  depositor: Address
  value: string
  block: number
  logIndex: number
  ts: number
  tx: Hex
  /** Taken back by its depositor. */
  ragequit: boolean
}

export type PrivacyWithdrawal = { nullifier: string; newCommitment: string; value: string; block: number; ts: number; tx: Hex }
export type PrivacyRagequit = { label: string; commitment: string; value: string; ragequitter: Address; block: number; ts: number; tx: Hex }

/** An ERC-5564 scheme-1 announcement: a stealth payment, for recipients to scan. */
export type StealthAnnouncement = { stealthAddress: Address; ephemeralPubKey: Hex; metadata: Hex; caller: Address; block: number; ts: number; tx: Hex }

type Page = { from?: number; limit?: number }

/**
 * Client for the ElysiumSwap Private API: pool state, the approved set, pool history (to rebuild the commitment
 * trees) and stealth announcements. Everything here is public on-chain data.
 */
export class PrivacyApi {
  private readonly request

  constructor(opts: Partial<HttpOptions> = {}) {
    this.request = createHttp({ baseUrl: API_URLS.privacy, ...opts })
  }

  /** Pools, their balances and limits, the relayer's fee and contracts, and the screening timing. */
  async config(): Promise<PrivacyConfig> {
    return this.request('/v1/privacy/config')
  }

  /** The current approved set. */
  async approvedSet(): Promise<PrivacyApprovedSet> {
    return this.request('/v1/privacy/asp')
  }

  /** A pool's tree leaves in order, from index `from`. */
  async leaves(pool: Address, p: Page = {}): Promise<{ pool: Address; from: number; leaves: string[] }> {
    return this.request(`/v1/privacy/pools/${pool.toLowerCase()}/leaves`, p)
  }

  /** A pool's deposits in order, from position `from`. */
  async deposits(pool: Address, p: Page = {}): Promise<{ pool: Address; from: number; deposits: PrivacyDeposit[] }> {
    return this.request(`/v1/privacy/pools/${pool.toLowerCase()}/deposits`, p)
  }

  /** A pool's withdrawals in order (spent nullifiers and their change commitments). */
  async withdrawals(pool: Address, p: Page = {}): Promise<{ pool: Address; from: number; withdrawals: PrivacyWithdrawal[] }> {
    return this.request(`/v1/privacy/pools/${pool.toLowerCase()}/withdrawals`, p)
  }

  /** Deposits taken back by their depositors. */
  async ragequits(pool: Address, p: Page = {}): Promise<{ pool: Address; from: number; ragequits: PrivacyRagequit[] }> {
    return this.request(`/v1/privacy/pools/${pool.toLowerCase()}/ragequits`, p)
  }

  /** Stealth payment announcements in order, from position `from`. Scan them with `checkAnnouncement`. */
  async announcements(p: Page = {}): Promise<{ from: number; announcements: StealthAnnouncement[] }> {
    return this.request('/v1/privacy/announcements', p)
  }
}
