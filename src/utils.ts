import { encodePacked, type Address, type Hex } from 'viem'
import { ADDRESSES, NATIVE, ZERO } from './constants.js'

/** A transaction to send: `{ to, data, value }`, ready for `walletClient.sendTransaction`. */
export type Call = { to: Address; data: Hex; value: bigint }

/** An ERC-20 allowance a call needs before it can run. */
export type Approval = { token: Address; spender: Address; amount: bigint }

/** A built action: the call, plus the approval it needs first (null when none, e.g. when paying in HYPE). */
export type BuiltTx = { call: Call; approval: Approval | null }

export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** True for native HYPE (NATIVE, or the zero address the Aggregator uses for it). */
export const isNative = (a: string) => sameAddress(a, NATIVE) || sameAddress(a, ZERO)

/** HYPE as WHYPE: how pools and the APIs see it. */
export const wrapped = (a: Address, whype: Address = ADDRESSES.WHYPE): Address => (isNative(a) ? whype : a)

/** `amount` less `bps` basis points (rounded down): the minimum to accept for a quoted output. */
export function minusSlippage(amount: bigint, bps: number): bigint {
  assertBps(bps)
  return (amount * BigInt(10_000 - Math.round(bps))) / 10_000n
}

/** `amount` plus `bps` basis points (rounded up): the maximum to pay for a quoted input. */
export function plusSlippage(amount: bigint, bps: number): bigint {
  assertBps(bps)
  return (amount * BigInt(10_000 + Math.round(bps)) + 9_999n) / 10_000n
}

function assertBps(bps: number) {
  if (!Number.isFinite(bps) || bps < 0 || bps >= 10_000) throw new RangeError(`slippage must be 0..9999 basis points, got ${bps}`)
}

/** A deadline `seconds` from now, in unix seconds (what routers and curves expect). */
export const deadlineIn = (seconds = 1_200) => BigInt(Math.floor(Date.now() / 1000) + seconds)

/** Packed Uniswap v3 path: token, fee, token, fee, token… Pass `reverse` for exact-output paths. */
export function encodeV3Path(tokens: readonly Address[], fees: readonly number[], reverse = false): Hex {
  if (tokens.length !== fees.length + 1) throw new Error('a v3 path needs exactly one fee between each pair of tokens')
  const t = reverse ? [...tokens].reverse() : [...tokens]
  const f = reverse ? [...fees].reverse() : [...fees]
  const types: ('address' | 'uint24')[] = []
  const values: (Address | number)[] = []
  t.forEach((tok, i) => {
    types.push('address')
    values.push(tok)
    if (i < f.length) {
      types.push('uint24')
      values.push(f[i])
    }
  })
  return encodePacked(types, values)
}

/** UTF-8 byte length (on-chain limits count bytes, not characters). */
export const byteLength = (s: string) => new TextEncoder().encode(s).length
