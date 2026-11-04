import { parseAbi } from 'viem'

/** Minimal ABIs for what the SDK reads and writes. */

export const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])

export const wethAbi = parseAbi(['function deposit() payable', 'function withdraw(uint256 wad)'])

export const v2FactoryAbi = parseAbi([
  'function getPair(address tokenA, address tokenB) view returns (address)',
  'function allPairs(uint256) view returns (address)',
  'function allPairsLength() view returns (uint256)',
])

export const v2PairAbi = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
])

export const v2RouterAbi = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
])

export const v3FactoryAbi = parseAbi(['function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)'])

export const v3PoolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() view returns (uint128)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
])

/** QuoterV2 reverts internally to measure a swap; it is safe to eth_call, so it's declared `view` here. */
export const v3QuoterAbi = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) view returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
  'function quoteExactOutput(bytes path, uint256 amountOut) view returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
])

export const v3RouterAbi = parseAbi([
  'function multicall(bytes[] data) payable returns (bytes[] results)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) payable',
  'function refundETH() payable',
  'struct ExactInputParams { bytes path; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; }',
  'function exactInput(ExactInputParams params) payable returns (uint256 amountOut)',
])

/** ElysiumSwap Aggregator: split routes across every v2/v3/v4 DEX on Elysium, 0.1 % fee. */
export const aggregatorAbi = parseAbi([
  'struct Leg { uint8 kind; address pool; address tokenIn; address tokenOut; uint24 fee; int24 tickSpacing; address hooks; bytes hookData; }',
  'struct Path { uint16 shareBps; Leg[] legs; }',
  'struct SwapArgs { address tokenIn; address tokenOut; uint256 amountIn; uint256 minAmountOut; address recipient; uint256 deadline; bool feeOnOutput; Path[] paths; }',
  'function swap(SwapArgs s) payable returns (uint256 amountOut)',
  'function quote(Leg[] legs, uint256 amountIn, bool feeOnOutput) returns (uint256 amountOut)',
  'function quoteMulti(Leg[][] paths, uint256[] amounts) returns (uint256[][] out)',
  'function FEE_BPS() view returns (uint256)',
  'function feeRecipient() view returns (address)',
])

// ---------------------------------------------------------------- ElysiumPad

export const padLauncherAbi = parseAbi([
  'struct Metadata { string image; string description; string website; string twitter; string telegram; }',
  'struct LaunchInfo { address creator; address quoteToken; address pool; uint64 launchedAt; uint256 tokenId; }',
  'function launch(string name, string symbol, Metadata meta, address feeWallet, address quoteToken, uint256 minTokensOut) payable returns (address token, address pool, uint256 tokenId)',
  'function launchFee() view returns (uint256)',
  'function quoteTokens() view returns (address[])',
  'function marketCapRef(address quote) view returns (uint256)',
  'function tokenCount() view returns (uint256)',
  'function getLaunches(uint256 offset, uint256 limit) view returns (address[] tokens, LaunchInfo[] infos)',
  'function launchInfo(address) view returns (address creator, address quoteToken, address pool, uint64 launchedAt, uint256 tokenId)',
  'event TokenLaunched(address indexed token, address indexed creator, address indexed quoteToken, address feeWallet, address pool, uint256 tokenId, uint256 marketCapRef)',
])

export const padLockerAbi = parseAbi([
  'function positions(address) view returns (uint256 tokenId, address feeWallet, address token0, address token1, address pool, address positionManager)',
  'function platformShareBps() view returns (uint256)',
  'function collectFees(address token) returns (uint256 amount0, uint256 amount1)',
  'function setFeeWallet(address token, address newWallet)',
  'event FeesCollected(address indexed token, address indexed feeWallet, uint256 creator0, uint256 creator1, uint256 platform0, uint256 platform1)',
])

export const padTokenAbi = parseAbi([
  'struct Metadata { string image; string description; string website; string twitter; string telegram; }',
  'function metadata() view returns (Metadata)',
])

export const curveLauncherAbi = parseAbi([
  'struct Metadata { string image; string description; string website; string twitter; string telegram; }',
  'struct TaxConfig { uint16 buyBps; uint16 sellBps; uint16 burnShare; uint16 liquidityShare; address[3] wallets; uint16[3] walletShares; }',
  'function launch(string name, string symbol, Metadata meta, address quote, TaxConfig tax, uint256 devBuy, uint256 minTokensOut) payable returns (address token, address curve, address pair)',
  'function launchFee() view returns (uint256)',
  'function quotes() view returns (address[])',
  'function quoteCaps(address) view returns (bool enabled, uint256 startCap, uint256 gradCap)',
  'function tokenCount() view returns (uint256)',
  'function latestTokens(uint256 offset, uint256 limit) view returns (address[])',
  'function launchInfo(address) view returns (address creator, address quote, address curve, address pair, uint64 launchedAt)',
  'event CurveLaunched(address indexed token, address indexed creator, address indexed quote, address curve, address pair, uint256 startCap, uint256 gradCap, uint16 buyTaxBps, uint16 sellTaxBps)',
])

export const bondingCurveAbi = parseAbi([
  'function curveSupply() view returns (uint256)',
  'function startCap() view returns (uint256)',
  'function gradCap() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function remaining() view returns (uint256)',
  'function quoteBuy(uint256 quoteIn) view returns (uint256 tokensOut, uint256 quoteUsed, uint256 tax)',
  'function quoteSell(uint256 tokensIn) view returns (uint256 quoteOut, uint256 tax, uint256 fee)',
  'function buy(uint256 quoteIn, uint256 minTokensOut, address to, uint256 deadline) returns (uint256)',
  'function buyWithNative(uint256 minTokensOut, address to, uint256 deadline) payable returns (uint256)',
  'function sell(uint256 tokensIn, uint256 minQuoteOut, address to, uint256 deadline) returns (uint256)',
  'function sellToNative(uint256 tokensIn, uint256 minQuoteOut, address to, uint256 deadline) returns (uint256)',
  'event Trade(address indexed trader, bool indexed isBuy, uint256 quoteAmount, uint256 tokenAmount, uint256 fee, uint256 tax, uint256 x, uint256 y)',
  'event Graduated(address indexed pair, uint256 tokens, uint256 quote, uint256 liquidity)',
])

export const taxTokenAbi = parseAbi([
  'struct TaxConfig { uint16 buyBps; uint16 sellBps; uint16 burnShare; uint16 liquidityShare; address[3] wallets; uint16[3] walletShares; }',
  'function taxConfig() view returns (TaxConfig)',
  'function totalSupply() view returns (uint256)',
  'function liquidityPending() view returns (uint256)',
  'function migrated() view returns (bool)',
  'function addLiquidity()',
])
