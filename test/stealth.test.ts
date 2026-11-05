import { describe, expect, it } from 'vitest'
import { decodeFunctionData, encodePacked } from 'viem'
import {
  ADDRESSES,
  NATIVE,
  abis,
  buildRegisterPayId,
  buildStealthPayment,
  checkAnnouncement,
  decodeMetadata,
  encodeMetadata,
  generateStealthAddress,
  metaAddress,
  parseMetaAddress,
  randomStealthKeys,
} from '../src/index.js'

// Reference vector from @scopelift/stealth-address-sdk 1.0.0-beta.5: spending key 0x11…, viewing key 0x22…, ephemeral 0x01….
const keys = { spendingKey: `0x${'11'.repeat(32)}`, viewingKey: `0x${'22'.repeat(32)}` } as const

describe('stealth payments', () => {
  it('matches the reference ERC-5564 implementation', () => {
    expect(metaAddress(keys)).toBe('st:eth:0x034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27')
    const g = generateStealthAddress(metaAddress(keys), `0x${'01'.repeat(32)}`)
    expect(g.stealthAddress).toBe('0x11C25496B3F154155A401A333d23F29590663EE9')
    expect(g.ephemeralPubKey).toBe('0x031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f')
    expect(g.viewTag).toBe(0x2b)
    // An announcement the reference made, with its own random ephemeral key.
    const metadata = encodePacked(['bytes1', 'bytes4', 'address', 'uint256'], ['0x1f', '0xeeeeeeee', NATIVE, 1n])
    const theirs = { stealthAddress: '0xA47bD0866c6e4Ee751a48E4c7DcF6BdCf8112B0e', ephemeralPubKey: '0x0282ec3ea12aae70faf33916025cbab783aaa62a4011d8c64f970f9c6b79c4e7f9', metadata } as const
    expect(checkAnnouncement(theirs, keys)).toBe('0x30d90382ab0967e2eb8048433e5f6a54293ccd7868ac39f2e02a66b206846adb')
  })

  it('pays to an address only the recipient finds', () => {
    const me = randomStealthKeys()
    const other = randomStealthKeys()
    const pay = buildStealthPayment({ payId: metaAddress(me), asset: ADDRESSES.USDC, amount: 5_000_000n })
    const { args } = decodeFunctionData({ abi: abis.stealthAnnouncerAbi, data: pay.announce.data })
    const a = { stealthAddress: args[1], ephemeralPubKey: args[2], metadata: args[3] }
    expect(a.stealthAddress).toBe(pay.stealthAddress)
    expect(checkAnnouncement(a, me)).toMatch(/^0x[0-9a-f]{64}$/)
    expect(checkAnnouncement(a, other)).toBeNull()
    expect(decodeMetadata(a.metadata)).toEqual({ asset: ADDRESSES.USDC, amount: 5_000_000n })
    expect(pay.transfer.to).toBe(ADDRESSES.USDC)
    expect(pay.announce.to).toBe(ADDRESSES.privacy.stealthAnnouncer)
  })

  it('pays HYPE as a plain transfer with the native mark', () => {
    const pay = buildStealthPayment({ payId: metaAddress(keys), asset: NATIVE, amount: 10n ** 16n })
    expect(pay.transfer).toEqual({ to: pay.stealthAddress, data: '0x', value: 10n ** 16n })
    expect(encodeMetadata(0x2b, NATIVE, 1n).slice(4, 12)).toBe('eeeeeeee')
    expect(encodeMetadata(0x2b, ADDRESSES.USDC, 1n).slice(4, 12)).toBe('a9059cbb')
  })

  it('rejects malformed pay IDs and amounts', () => {
    expect(parseMetaAddress('st:eth:0x1234')).toBeNull()
    expect(parseMetaAddress(`st:eth:0x${'00'.repeat(66)}`)).toBeNull()
    expect(() => buildStealthPayment({ payId: 'nope', asset: NATIVE, amount: 1n })).toThrow()
    expect(() => buildStealthPayment({ payId: metaAddress(keys), asset: NATIVE, amount: 0n })).toThrow()
  })

  it('builds the registry call', () => {
    const c = buildRegisterPayId(keys)
    expect(c.to).toBe(ADDRESSES.privacy.stealthRegistry)
    const { args } = decodeFunctionData({ abi: abis.stealthRegistryAbi, data: c.data })
    expect(`st:eth:${args[1]}`).toBe(metaAddress(keys))
  })
})
