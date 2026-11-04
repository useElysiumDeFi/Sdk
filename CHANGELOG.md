# Changelog

## 0.1.0

First release.

- **Client setup:** `createElysiumClient()` creates the Elysium chain, contract addresses, both API clients, and the DEX and launchpad modules in one call.
- **Swaps (`Dex`):**
  - Best split route across every DEX on Elysium through the market API, re-quoted on-chain through the Aggregator.
  - Builders for Aggregator swaps, HYPE ↔ WHYPE wrapping, and direct ElysiumSwap v2/v3 exact-input swaps, each with an on-chain quote.
- **ElysiumPad (`Launchpad`):**
  - Instant and bonding-curve launches, with local checks of tax settings and metadata limits.
  - Curve quotes and trades, before and after graduation.
  - Fee collection, fee-wallet handover, and adding liquidity tax after graduation.
  - Launch settings and curve state reads.
- **APIs:** typed clients for the market API (routes, tokens, pools, overview, trades) and the ElysiumPad API (stats, snapshot, launches, trades, holders, candles, sparklines, leaderboards, accounts).
- **Transactions:**
  - `execute()` approves if needed, simulates, sends and waits.
  - `needsApproval()` and `approveCall()` let you handle approvals yourself.
