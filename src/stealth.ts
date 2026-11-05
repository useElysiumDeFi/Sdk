/**
 * Stealth payments: ERC-5564 scheme 1 (secp256k1 with view tags) and ERC-6538 pay IDs.
 *
 * A recipient publishes a stealth meta-address ("pay ID": `st:eth:0x` + compressed spending key + compressed
 * viewing key). A payer derives a fresh one-time address from it, pays that address and announces the payment.
 * Only the recipient's viewing key can tell the payment is theirs, and only their spending key can move it.
 * The same scheme as ElysiumSwap Private's pay IDs, so payments made here show up there.
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { bytesToHex, encodeFunctionData, encodePacked, getAddress, hexToBytes, keccak256, type Address, type Hex, type PublicClient } from 'viem'
import { publicKeyToAddress } from 'viem/accounts'
import { erc20Abi, stealthAnnouncerAbi, stealthRegistryAbi } from './abis.js'
import { ADDRESSES, NATIVE } from './constants.js'
import { isNative, type Call } from './utils.js'

export const STEALTH_SCHEME_ID = 1n
const N = secp256k1.CURVE.n
/** ERC-5564 metadata bytes 1-4: a native payment, or the ERC-20 transfer selector. */
const NATIVE_MARK = '0xeeeeeeee'
const TRANSFER_SELECTOR = '0xa9059cbb'

/** A recipient's private keys: spending (moves funds) and viewing (finds payments). */
export type StealthKeys = { spendingKey: Hex; viewingKey: Hex }

const toKey = (h: Hex): Hex => {
  const k = BigInt(h) % N
  if (k === 0n) throw new Error('invalid key')
  return `0x${k.toString(16).padStart(64, '0')}`
}
const compressed = (key: Hex) => bytesToHex(secp256k1.getPublicKey(hexToBytes(key), true))
const viewTagOf = (s: Hex) => Number(BigInt(s) >> 248n)

/** New random stealth keys. Keep them secret: anyone with the spending key can move your payments. */
export function randomStealthKeys(): StealthKeys {
  return { spendingKey: bytesToHex(secp256k1.utils.randomPrivateKey()), viewingKey: bytesToHex(secp256k1.utils.randomPrivateKey()) }
}

/** The pay ID for these keys: `st:eth:0x…` (use `metaAddressBytes` for the raw form ERC-6538 stores). */
export function metaAddress(k: StealthKeys): string {
  return `st:eth:${metaAddressBytes(k)}`
}

export function metaAddressBytes(k: StealthKeys): Hex {
  return `0x${compressed(toKey(k.spendingKey)).slice(2)}${compressed(toKey(k.viewingKey)).slice(2)}`
}

/** Parses `st:eth:0x…` or the raw 66 bytes. Null when it isn't a valid pay ID. */
export function parseMetaAddress(s: string): { spendingPubKey: Hex; viewingPubKey: Hex } | null {
  const raw = s.trim().replace(/^st:eth:/i, '')
  if (!/^0x[0-9a-fA-F]{132}$/.test(raw)) return null
  const spendingPubKey = `0x${raw.slice(2, 68)}` as Hex
  const viewingPubKey = `0x${raw.slice(68)}` as Hex
  try {
    secp256k1.ProjectivePoint.fromHex(spendingPubKey.slice(2)).assertValidity()
    secp256k1.ProjectivePoint.fromHex(viewingPubKey.slice(2)).assertValidity()
  } catch {
    return null
  }
  return { spendingPubKey, viewingPubKey }
}

/** A fresh one-time address for a pay ID: where to pay, and what to announce. `ephemeralKey` is for tests only. */
export function generateStealthAddress(payId: string, ephemeralKey?: Hex): { stealthAddress: Address; ephemeralPubKey: Hex; viewTag: number } {
  const m = parseMetaAddress(payId)
  if (!m) throw new Error('not a valid stealth meta-address (pay ID)')
  const r = ephemeralKey ? toKey(ephemeralKey) : bytesToHex(secp256k1.utils.randomPrivateKey())
  const s = keccak256(bytesToHex(secp256k1.getSharedSecret(hexToBytes(r), hexToBytes(m.viewingPubKey), true)))
  const P = secp256k1.ProjectivePoint.fromHex(m.spendingPubKey.slice(2)).add(secp256k1.ProjectivePoint.BASE.multiply(BigInt(s) % N))
  return { stealthAddress: getAddress(publicKeyToAddress(bytesToHex(P.toRawBytes(false)))), ephemeralPubKey: compressed(r), viewTag: viewTagOf(s) }
}

/** ERC-5564 metadata: view tag, then the native mark or transfer selector, the token and the amount. */
export function encodeMetadata(viewTag: number, asset: Address, amount: bigint): Hex {
  const native = isNative(asset)
  return encodePacked(['uint8', 'bytes4', 'address', 'uint256'], [viewTag, native ? NATIVE_MARK : TRANSFER_SELECTOR, native ? NATIVE : asset, amount])
}

/** What an announcement's metadata says was sent, if it says. */
export function decodeMetadata(metadata: Hex): { asset: Address; amount: bigint } | null {
  if (metadata.length < 2 + 2 * 57) return null
  return { asset: getAddress(`0x${metadata.slice(12, 52)}`), amount: BigInt(`0x${metadata.slice(52, 116)}`) }
}

/**
 * If announcement `a` is a payment to these keys, the private key of its stealth address; otherwise null. The view
 * tag rejects all but ~1/256 of other people's announcements with one hash.
 */
export function checkAnnouncement(a: { stealthAddress: Address; ephemeralPubKey: Hex; metadata: Hex }, k: StealthKeys): Hex | null {
  if (!/^0x[0-9a-fA-F]{66}$/.test(a.ephemeralPubKey) || a.metadata.length < 4) return null
  let shared: Uint8Array
  try {
    shared = secp256k1.getSharedSecret(hexToBytes(toKey(k.viewingKey)), hexToBytes(a.ephemeralPubKey), true)
  } catch {
    return null
  }
  const s = keccak256(bytesToHex(shared))
  if (Number.parseInt(a.metadata.slice(2, 4), 16) !== viewTagOf(s)) return null
  const key = `0x${((BigInt(toKey(k.spendingKey)) + BigInt(s)) % N).toString(16).padStart(64, '0')}` as Hex
  return getAddress(publicKeyToAddress(bytesToHex(secp256k1.getPublicKey(hexToBytes(key), false)))) === getAddress(a.stealthAddress) ? key : null
}

/** The pay ID a wallet published in the ERC-6538 registry, or null. */
export async function lookupPayId(publicClient: PublicClient, wallet: Address, registry: Address = ADDRESSES.privacy.stealthRegistry): Promise<string | null> {
  const raw = await publicClient.readContract({ address: registry, abi: stealthRegistryAbi, functionName: 'stealthMetaAddressOf', args: [wallet, STEALTH_SCHEME_ID] })
  return raw && raw !== '0x' && parseMetaAddress(raw) ? `st:eth:${raw}` : null
}

/** The call that publishes your pay ID for the sending wallet's address. */
export function buildRegisterPayId(keys: StealthKeys, registry: Address = ADDRESSES.privacy.stealthRegistry): Call {
  return { to: registry, data: encodeFunctionData({ abi: stealthRegistryAbi, functionName: 'registerKeys', args: [STEALTH_SCHEME_ID, metaAddressBytes(keys)] }), value: 0n }
}

/**
 * A public stealth payment from your wallet: send `transfer`, then `announce` (two transactions). The recipient finds
 * it by scanning announcements. A token payment should usually come with a little HYPE to the same address, so the
 * recipient can pay gas to move it. To pay without your wallet showing, pay from an ElysiumSwap Private balance instead.
 */
export function buildStealthPayment(p: { payId: string; asset: Address; amount: bigint; announcer?: Address; ephemeralKey?: Hex }): {
  stealthAddress: Address
  transfer: Call
  announce: Call
} {
  if (p.amount <= 0n) throw new RangeError('amount must be positive')
  const g = generateStealthAddress(p.payId, p.ephemeralKey)
  const transfer: Call = isNative(p.asset)
    ? { to: g.stealthAddress, data: '0x', value: p.amount }
    : { to: p.asset, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [g.stealthAddress, p.amount] }), value: 0n }
  const announce: Call = {
    to: p.announcer ?? ADDRESSES.privacy.stealthAnnouncer,
    data: encodeFunctionData({ abi: stealthAnnouncerAbi, functionName: 'announce', args: [STEALTH_SCHEME_ID, g.stealthAddress, g.ephemeralPubKey, encodeMetadata(g.viewTag, p.asset, p.amount)] }),
    value: 0n,
  }
  return { stealthAddress: g.stealthAddress, transfer, announce }
}
