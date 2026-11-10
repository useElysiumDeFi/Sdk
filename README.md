# ElysiumDeFi SDK

TypeScript SDK for **ElysiumSwap** (DEX) and **ElysiumPad** (launchpad) on Elysium (chain ID 99901), built on [viem](https://viem.sh).

- **Swaps:** the best split route across every DEX on Elysium, re-quoted on-chain before you trade, plus direct ElysiumSwap v2/v3 swaps.
- **ElysiumPad:** instant and bonding-curve launches, curve trading (before and after graduation), and creator fees.
- **ElysiumSwap Private:** pool state, the approved set and pool history, plus stealth payments (ERC-5564 / ERC-6538 pay IDs).
- **Data:** typed clients for the market API, the ElysiumPad API and the ElysiumSwap Private API.
- **Transactions:** every action is returned as plain data (`{ call, approval }`) for you to send, or `execute()` sends it for you.

ElysiumSwap and ElysiumPad are independent projects built on Elysium. They are not affiliated with, or endorsed by, Elysium or Kinetiq.

## Install

```sh
npm install github:useElysiumDeFi/Sdk#v0.2.1 viem
```

You need Node 18 or later; `viem` is a peer dependency. Releases are tagged (`v0.2.1`, …); see [CHANGELOG.md](CHANGELOG.md).

## Quick start

```ts
import { createElysiumClient, NATIVE, execute } from '@elysiumdefi/sdk'
import { createWalletClient, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const elysium = createElysiumClient() // public RPC and APIs
// Any Elysium RPC works: createElysiumClient({ rpcUrl: 'https://rpc.elysium.kinetiq.xyz' })

// Market data
const { tokens } = await elysium.market.tokens()
const pad = await elysium.padApi.snapshot()

// Quote 1 HYPE -> a token: best split across every DEX, re-checked on-chain
const quote = await elysium.dex.quote({ tokenIn: NATIVE, tokenOut: '0x…', amountIn: parseEther('1') })
if (!quote) throw new Error('no route')

// Build the transaction (0.5 % slippage by default) and send it
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`)
const wallet = createWalletClient({ account, chain: elysium.chain, transport: http() })
const tx = elysium.dex.buildSwap(quote, { recipient: account.address, slippageBps: 50 })
const { hash } = await execute(wallet, elysium.publicClient, tx) // approves first if needed
```

`NATIVE` (`0xEeee…EEeE`) stands for HYPE wherever a token address is expected.

## Swaps

```ts
const q = await elysium.dex.quote({ tokenIn, tokenOut, amountIn })
```

`quote` returns null when there's no route. Otherwise you get:

- **Amounts:**
  - `amountOut`: what the chain pays for the exact split right now, after the Aggregator's 0.1 % fee.
  - `apiAmountOut`: what the market API quoted.
  - `priceImpact` and `lpFee`.
- **The route:**
  - `paths`: the split as the Aggregator executes it.
  - `route`: the same split for display, with token paths, which DEX each pool belongs to, and whether it's an ElysiumSwap pool.

A route that doesn't check out on-chain throws `RouteCheckError`. HYPE ↔ WHYPE quotes come back as `kind: 'wrap' | 'unwrap'`, at 1:1.

```ts
const tx = elysium.dex.buildSwap(q, { recipient, slippageBps: 50, deadline })
// tx.call: { to, data, value }; tx.approval: { token, spender, amount } | null; tx.minAmountOut
```

**Direct ElysiumSwap swaps.** These run on a path you choose, without the Aggregator's fee.

```ts
const out = await elysium.dex.quoteV3([WHYPE, TOKEN], [10_000], amountIn)
const tx = elysium.dex.buildV3Swap({ tokens: [NATIVE, TOKEN], fees: [10_000], amountIn, amountOutMin: minusSlippage(out, 50), recipient })
// or quoteV2 / buildV2Swap with a v2 path
```

## ElysiumPad

### Instant launch

The whole supply goes into a locked 1 % ElysiumSwap v3 pool:

```ts
const tx = await elysium.launchpad.buildLaunch({
  name: 'My Token',
  symbol: 'MYT',
  meta: { image: 'ipfs://…', description: '…', website: 'https://…', twitter: 'https://x.com/…', telegram: 'https://t.me/…' },
  devBuy: parseEther('0.5'), // optional first buy, in HYPE
})
const { receipt } = await execute(wallet, elysium.publicClient, tx)
const token = elysium.launchpad.launchedToken(receipt.logs)
```

### Bonding-curve launch

The token sells on its own curve, then graduates to an ElysiumSwap v2 pair:

```ts
import { ADDRESSES } from '@elysiumdefi/sdk'

const tx = await elysium.launchpad.buildCurveLaunch({
  name: 'My Token',
  symbol: 'MYT',
  quoteToken: ADDRESSES.WHYPE, // or ADDRESSES.USDC
  tax: {
    buyBps: 300,
    sellBps: 300, // up to 1000 (10 %) each way
    burnShareBps: 5_000, // where the tax goes, in basis points of the tax; must add up to 10 000
    wallets: [{ address: '0x…', shareBps: 5_000 }], // up to three
  },
  devBuy: parseEther('0.5'),
})
```

Tax settings are checked locally (`toTaxConfig`), with the same rules as the token contract.

### Trading a curve token

Before graduation the trade goes to the curve; after graduation it goes through the v2 pair. `buildCurveTrade` picks the right one:

```ts
const q = await elysium.launchpad.quoteCurveTrade({ token, side: 'buy', amountIn: parseEther('1') })
const tx = await elysium.launchpad.buildCurveTrade({ token, side: 'buy', amountIn: parseEther('1'), recipient, native: true })
```

`native: true` pays (or receives) HYPE. It only works for WHYPE-paired tokens.

### Fees and upkeep

- `buildCollectFees(token)`: collect an instant launch's trading fees. Anyone can call it.
- `buildSetFeeWallet(token, wallet)`: hand an instant launch's creator fees to a new wallet. Only the current fee wallet can.
- `buildAddLiquidity(token)`: after graduation, add a curve token's collected liquidity tax to its v2 pair. Anyone can call it.

### Reads

- `launchFee('v3' | 'curve')`: the launch fee in HYPE wei.
- `instantQuotes()`: pair tokens for instant launches, with each one's launch market cap.
- `curveQuotes()`: pair tokens for bonding curves, with their start and graduation market caps.
- `curveState(token)`: a curve token's curve, pair, tax, progress and graduation status.

## ElysiumSwap Private

[ElysiumSwap Private](https://docs.elysiumswap.finance/swap/private.html) lets people hold HYPE and USDC privately, then withdraw, swap, pay or launch without linking it to their wallet. Private spending needs zero-knowledge proofs made with the account's secrets, which the ElysiumSwap and ElysiumPad apps do in the browser. The SDK covers the public side.

### Data

```ts
const config = await elysium.privacyApi.config()
// pools (balances, minimum deposits, fee caps), relayer fee and contracts, screening timing
const set = await elysium.privacyApi.approvedSet() // deposit labels that passed screening
```

Also `leaves`, `deposits`, `withdrawals` and `ragequits` per pool (to rebuild the commitment trees), and `announcements` (stealth payments). `market.overview()` now splits ElysiumSwap's TVL into `ammTvlUsd` and `privateTvlUsd`.

### Stealth payments

Pay anyone at a fresh one-time address that only they can find, using their pay ID (`st:eth:0x…`). Payments made this way show up in the recipient's ElysiumSwap Private account.

```ts
import { buildStealthPayment, lookupPayId, NATIVE } from '@elysiumdefi/sdk'

const payId = await lookupPayId(elysium.publicClient, '0xRecipientWallet…') // or one they shared with you
const pay = buildStealthPayment({ payId: payId!, asset: NATIVE, amount: parseEther('1') })
await wallet.sendTransaction(pay.transfer) // 1: pay the one-time address
await wallet.sendTransaction(pay.announce) // 2: announce it, so the recipient finds it
```

These payments come from your wallet, so the payer is public; the recipient isn't. To receive with your own keys:

```ts
import { randomStealthKeys, metaAddress, buildRegisterPayId, checkAnnouncement } from '@elysiumdefi/sdk'

const keys = randomStealthKeys() // keep secret
const myPayId = metaAddress(keys)
await wallet.sendTransaction(buildRegisterPayId(keys)) // optional: publish it for your wallet address

const { announcements } = await elysium.privacyApi.announcements({ from: 0 })
for (const a of announcements) {
  const key = checkAnnouncement(a, keys) // the one-time address's private key, or null
}
```

## Data APIs

`elysium.market` (ElysiumSwap market API):
- `route`
- `tokens`
- `token(address)`
- `pools`
- `overview`
- `trades`

`elysium.padApi` (ElysiumPad API):
- `stats`
- `snapshot`
- `launches`
- `launch(token)`
- `trades`
- `holders`
- `candles`
- `sparklines`
- `activity`
- `creators`
- `traders`
- `account(address)`

`elysium.privacyApi` (ElysiumSwap Private API):
- `config`
- `approvedSet`
- `leaves(pool)`
- `deposits(pool)`
- `withdrawals(pool)`
- `ragequits(pool)`
- `announcements`

Failed requests throw `ElysiumApiError`, which carries the HTTP status. The APIs are read-only and public for server-side use. Browser apps on other domains are blocked by the APIs' allowed-origins list.

## Addresses

`ADDRESSES` has every contract; `START_BLOCKS` has their deployment blocks. The same data, with deployment transactions, is in [useElysiumDeFi/ElysiumDeFi-Deployments](https://github.com/useElysiumDeFi/ElysiumDeFi-Deployments). Contract source: [useElysiumDeFi/ElysiumPad](https://github.com/useElysiumDeFi/ElysiumPad).

## Development

```sh
npm install
npm test            # unit tests, offline
npm run typecheck
npm run build
ELYSIUM_LIVE=1 npx vitest run test/live.test.ts   # read-only checks against mainnet
```

The live tests dry-run (with `eth_call`) a real swap and a curve buy built by the SDK, and read the privacy API. Nothing is signed or sent.

## License

MIT
