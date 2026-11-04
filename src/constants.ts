import { defineChain, type Address } from 'viem'

/** Elysium mainnet: an Arbitrum Orbit chain that settles to HyperEVM, with HYPE as gas. */
export const elysium = defineChain({
  id: 99901,
  name: 'Elysium',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.elysiumswap.finance', 'https://rpc-live.elysp.com'] } },
})

/** Stands for native HYPE wherever a token address is expected (the usual 0xEeee… convention). */
export const NATIVE: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
export const ZERO: Address = '0x0000000000000000000000000000000000000000'

/** ElysiumSwap and ElysiumPad on Elysium mainnet. Source: github.com/useElysiumDeFi/ElysiumDeFi-Deployments. */
export const ADDRESSES = {
  /** Canonical bridged WHYPE. */
  WHYPE: '0xbA876237B0F021A6c6D852d6c26E107997cC5E81',
  /** USDC bridged from HyperEVM (6 decimals). */
  USDC: '0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65',
  dex: {
    v2Factory: '0xC48C733F9cEaC05d79D0d583A15f3C68a14B8715',
    v2Router: '0x194a77bCA0Ada3Eb15d7B3Af201AcA197dbE3B26',
    v3Factory: '0x7266c0EcfF2A687B4Ad0Ead7B24840929540b697',
    v3Router: '0x9fae201fa4c0740b1b92DebEcDDfFE74C1Ecd8b3',
    v3Quoter: '0xc256C98819BB29661Dd66e3DBCE3cA71875D8143',
    v3PositionManager: '0xC6Dc519451F58dFd27bB2920EeFAe57597bd91f5',
    aggregator: '0xD9106be99e93cC88A0c81522F416fF4e8394fe51',
  },
  pad: {
    launcher: '0x3318b09E6e4D222513D8fBCF76205b3c5566d76c',
    locker: '0xa83212Cac640Cb27005B956531c6cB251F14465C',
    quoter: '0xc730A76E6339A41Acf2D430264603484Fd592aC8',
    tokenImpl: '0x4Bf70643c298a7c438f1cAcDBf1F71B041AEEE8E',
    curveLauncher: '0xB7F444558A6Ae7ded39E859769bF4497D3FEfFC5',
    curveTokenImpl: '0x8aFB6A16374520923a6749F32D7E722d0A16CfEa',
    curveImpl: '0x5cF201Fda7771878FfC68958b2cC28A619421a92',
  },
} as const satisfies {
  WHYPE: Address
  USDC: Address
  dex: Record<string, Address>
  pad: Record<string, Address>
}

export type Addresses = {
  WHYPE: Address
  USDC: Address
  dex: { [K in keyof typeof ADDRESSES.dex]: Address }
  pad: { [K in keyof typeof ADDRESSES.pad]: Address }
}

/** Blocks the contracts were deployed at: where log scans can start. */
export const START_BLOCKS = { v2Factory: 139_223n, v3Factory: 139_258n, launcher: 139_422n, aggregator: 141_305n, curveLauncher: 161_259n } as const

/** Public APIs (read-only). */
export const API_URLS = {
  market: 'https://api.elysiumswap.finance',
  pad: 'https://api.elysiumpad.fun',
} as const

/** Fixed in the Aggregator: 0.1 % of each trade. */
export const AGGREGATOR_FEE_BPS = 10
/** ElysiumSwap v3 fee tiers (hundredths of a basis point) and their tick spacing. */
export const V3_FEE_TIERS = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10_000, tickSpacing: 200 },
] as const

/** ElysiumPad rules, fixed in the contracts. */
export const PAD = {
  /** Every launched token has this supply (18 decimals). */
  totalSupply: 1_000_000_000n * 10n ** 18n,
  /** Instant launches go into this ElysiumSwap v3 fee tier (1 %). */
  instantFeeTier: 10_000,
  /** Bonding curve: 1 % fee per trade. */
  curveFeeBps: 100,
  /** Bonding curve: the platform's share of a token's own tax. */
  curvePlatformTaxShareBps: 5_000,
  /** Tax tokens: the most a buy or sell tax can be (10 %). */
  maxTaxBps: 1_000,
  /** Tax tokens: at most three tax wallets. */
  maxTaxWallets: 3,
  /** On-chain length limits, in UTF-8 bytes. */
  limits: { name: 32, symbol: 12, image: 200, description: 1_000, social: 120 },
} as const
