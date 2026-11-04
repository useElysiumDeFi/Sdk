import { encodeFunctionData, type Address, type Hash, type PublicClient, type TransactionReceipt, type WalletClient } from 'viem'
import { erc20Abi } from './abis.js'
import type { Approval, BuiltTx, Call } from './utils.js'

/** True when `owner` hasn't yet allowed `approval.spender` to move `approval.amount`. */
export async function needsApproval(publicClient: PublicClient, owner: Address, approval: Approval | null): Promise<boolean> {
  if (!approval || approval.amount === 0n) return false
  const allowance = await publicClient.readContract({ address: approval.token, abi: erc20Abi, functionName: 'allowance', args: [owner, approval.spender] })
  return allowance < approval.amount
}

/** The approve call for an approval (exact amount by default; `unlimited` approves the maximum). */
export function approveCall(approval: Approval, unlimited = false): Call {
  const amount = unlimited ? 2n ** 256n - 1n : approval.amount
  return { to: approval.token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [approval.spender, amount] }), value: 0n }
}

/**
 * Sends a built transaction from `walletClient`'s account: first the approval if one is missing (waiting for it to
 * confirm), then the call. Returns the hashes and the call's receipt. Simulates the call first, so a transaction that
 * would revert throws here instead of being sent.
 */
export async function execute(
  walletClient: WalletClient,
  publicClient: PublicClient,
  built: BuiltTx,
  o: { unlimitedApproval?: boolean; skipSimulation?: boolean } = {},
): Promise<{ approvalHash: Hash | null; hash: Hash; receipt: TransactionReceipt }> {
  const account = walletClient.account
  if (!account) throw new Error('the wallet client has no account')
  const chain = walletClient.chain ?? null
  let approvalHash: Hash | null = null
  if (await needsApproval(publicClient, account.address, built.approval)) {
    const a = approveCall(built.approval!, o.unlimitedApproval)
    approvalHash = await walletClient.sendTransaction({ account, chain, to: a.to, data: a.data, value: a.value })
    const r = await publicClient.waitForTransactionReceipt({ hash: approvalHash })
    if (r.status !== 'success') throw new Error(`approval ${approvalHash} reverted`)
  }
  const { to, data, value } = built.call
  if (!o.skipSimulation) await publicClient.call({ account: account.address, to, data, value })
  const hash = await walletClient.sendTransaction({ account, chain, to, data, value })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`transaction ${hash} reverted`)
  return { approvalHash, hash, receipt }
}
