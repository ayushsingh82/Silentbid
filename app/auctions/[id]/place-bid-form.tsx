"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { useAccount, usePublicClient, useWriteContract, useWaitForTransactionReceipt } from "wagmi"
import { parseEther, type Address } from "viem"
import { AUCTION_ABI, SILENTBID_ABI, ethToQ96, snapToTickBoundary } from "@/lib/auction-contracts"
import { computeBidCommitment } from "@/lib/cre-bid"
import { chainId } from "@/lib/chain-config"

const inputClass = cn(
  "mt-2 w-full border border-border bg-input/50 px-4 py-3 font-mono text-sm",
  "placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent",
)
const labelClass = "block font-mono text-[10px] uppercase tracking-widest text-muted-foreground"

export function PlaceBidForm({
  auctionId,
  tokenSymbol,
  floorPrice,
  floorPriceRaw,
  clearingPrice,
  clearingPriceRaw,
  totalSupply,
  tickSpacing,
  silentBidAddress,
  onBidSuccess,
}: {
  auctionId: string
  tokenSymbol: string
  floorPrice?: string
  floorPriceRaw: bigint
  clearingPrice?: string
  clearingPriceRaw: bigint
  totalSupply?: string
  tickSpacing: bigint
  silentBidAddress?: Address
  onBidSuccess?: () => void
}) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId })
  const [amount, setAmount] = useState("")
  const [maxPrice, setMaxPrice] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [simulating, setSimulating] = useState(false)

  const { data: txHash, writeContract, isPending: isWriting, reset: resetWrite, error: writeError } = useWriteContract()

  const { isLoading: isConfirming, isSuccess, error: receiptError } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const hookError = writeError || receiptError
  const submitted = simulating || isWriting || (isConfirming && !hookError)

  const isEncrypted = !!silentBidAddress

  useEffect(() => {
    if (isSuccess && onBidSuccess) onBidSuccess()
  }, [isSuccess, onBidSuccess])

  // Check if auction is unfunded (totalSupply is 0 or very close to 0)
  const isUnfunded = totalSupply !== undefined && parseFloat(totalSupply) === 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (hookError) resetWrite()

    if (!isConnected || !address) {
      setError("Connect your wallet first.")
      return
    }

    if (!publicClient) {
      setError("Network not connected.")
      return
    }

    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Amount must be a positive number.")
      return
    }

    const maxPriceNum = parseFloat(maxPrice)
    if (!Number.isFinite(maxPriceNum) || maxPriceNum <= 0) {
      setError("Max price must be a positive number.")
      return
    }

    const amountWei = parseEther(amount)

    // ── CRE sealed-bid path: SilentBid (commitment only onchain) ──
    if (isEncrypted && silentBidAddress) {
      const rawQ96 = ethToQ96(maxPrice)
      if (rawQ96 === BigInt(0)) {
        setError("Max price is too small to encode.")
        return
      }
      const maxPriceQ96 = snapToTickBoundary(rawQ96, tickSpacing)
      const commitment = computeBidCommitment(
        auctionId as `0x${string}`,
        address,
        maxPriceQ96,
        amountWei
      )
      writeContract({
        address: silentBidAddress,
        abi: SILENTBID_ABI,
        functionName: "submitSilentBid",
        args: [commitment],
        value: amountWei,
      })
      return
    }

    // ── Plain path: direct CCA bid ──
    const rawQ96 = ethToQ96(maxPrice)
    if (rawQ96 === BigInt(0)) {
      setError("Max price is too small to encode.")
      return
    }

    const maxPriceQ96 = snapToTickBoundary(rawQ96, tickSpacing)

    if (clearingPriceRaw > BigInt(0) && maxPriceQ96 <= clearingPriceRaw) {
      setError(`Max price must be strictly above the clearing price (${clearingPrice} ETH).`)
      return
    }

    if (floorPriceRaw > BigInt(0) && maxPriceQ96 < floorPriceRaw) {
      setError(`Max price must be at or above the floor price (${floorPrice} ETH).`)
      return
    }

    const bidArgs = [
      maxPriceQ96,
      amountWei,
      address,
      floorPriceRaw,
      "0x" as `0x${string}`,
    ] as const

    setSimulating(true)
    try {
      await publicClient.simulateContract({
        address: auctionId as Address,
        abi: AUCTION_ABI,
        functionName: "submitBid",
        args: bidArgs,
        value: amountWei,
        account: address,
      })
    } catch (simErr: unknown) {
      setSimulating(false)
      const msg = simErr instanceof Error ? simErr.message : String(simErr)
      const shortMatch = msg.match(/reverted with the following reason:\s*(.+?)(?:\n|$)/i)
      const customMatch = msg.match(/reverted with custom error\s*["']?(\w+)\(?\)?/i)
      const reason = customMatch?.[1] || shortMatch?.[1] || msg
      setError(`Bid simulation failed: ${reason}`)
      return
    }
    setSimulating(false)

    writeContract({
      address: auctionId as Address,
      abi: AUCTION_ABI,
      functionName: "submitBid",
      args: bidArgs,
      value: amountWei,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 max-w-sm space-y-5">
      {isEncrypted && (
        <div className="border border-accent/50 bg-accent/10 px-4 py-3 font-mono text-[10px] text-accent">
          Sealed bids via Chainlink CRE: only a commitment is stored onchain; price and amount are private until the CRE workflow finalizes the auction.
        </div>
      )}

      {(error || hookError) && (
        <div
          role="alert"
          className="border border-destructive/50 bg-destructive/10 px-4 py-3 font-mono text-sm text-destructive break-all"
        >
          {error || hookError?.message || "Transaction failed."}
          {hookError && "shortMessage" in hookError && hookError.shortMessage && (
            <p className="mt-1 text-[10px] text-destructive/70">{String(hookError.shortMessage)}</p>
          )}
        </div>
      )}
      {isSuccess && (
        <div
          role="status"
          className="border border-accent/50 bg-accent/10 px-4 py-3 font-mono text-sm text-accent"
        >
          {isEncrypted ? "Sealed bid placed!" : "Bid placed!"} Tx: {txHash?.slice(0, 10)}...
          <br />
          <span className="text-[10px] text-muted-foreground">
            {isEncrypted
              ? "Your bid is sealed (commitment onchain). CRE will finalize and forward bids after the blind bid deadline."
              : `You will receive ${tokenSymbol} at the clearing price when the auction ends.`}
          </span>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => {
                resetWrite()
                setAmount("")
                setMaxPrice("")
                setError(null)
              }}
              className="border border-accent/40 px-3 py-1 font-mono text-[10px] uppercase tracking-widest hover:bg-accent/20 transition-colors"
            >
              Place another bid
            </button>
          </div>
        </div>
      )}

      {isUnfunded && !isEncrypted && (
        <div
          role="alert"
          className="border border-yellow-500/50 bg-yellow-500/10 px-4 py-3 font-mono text-sm text-yellow-600"
        >
          Auction has 0 token supply. It may not have been funded yet (tokens minted + onTokensReceived called).
          Bids will likely revert with <code>TokensNotReceived</code>.
        </div>
      )}

      {/* Current prices */}
      {!isEncrypted && (
        <div className="font-mono text-[10px] text-muted-foreground/70 space-y-1">
          {floorPrice && <p>Floor price: <span className="text-foreground">{floorPrice} ETH</span></p>}
          {clearingPrice && clearingPrice !== "0" && (
            <p>Clearing price: <span className="text-foreground">{clearingPrice} ETH</span> — bid must be <strong>above</strong> this</p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="maxPrice" className={labelClass}>
          Max price (ETH per token)
        </label>
        <input
          id="maxPrice"
          type="text"
          inputMode="decimal"
          placeholder={floorPrice ? `above ${floorPrice}` : "0.001"}
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          className={inputClass}
          disabled={submitted}
          required
        />
        <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
          {isEncrypted
            ? "Encrypted on-chain (scaled to fit uint64, converted to Q96 at reveal)."
            : "Must be strictly above the current clearing price (Q96 encoded onchain)."}
        </p>
      </div>

      <div>
        <label htmlFor="amount" className={labelClass}>
          Amount (ETH)
        </label>
        <input
          id="amount"
          type="text"
          inputMode="decimal"
          placeholder="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={inputClass}
          disabled={submitted}
          required
        />
        <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
          {isEncrypted
            ? "ETH escrow sent with the bid. Excess refunded after reveal + forward."
            : "ETH to commit. Sent as msg.value with the bid."}
        </p>
      </div>

      <button
        type="submit"
        disabled={submitted || !amount || !maxPrice || !isConnected}
        aria-busy={isWriting || isConfirming}
        className={cn(
          "mt-4 border border-foreground/20 px-6 py-3 font-mono text-xs uppercase tracking-widest",
          "hover:border-accent hover:text-accent transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none",
        )}
      >
        {encrypting
          ? "Encrypting bid..."
          : simulating
            ? "Simulating..."
            : isWriting
              ? "Confirm in wallet..."
              : isConfirming && !hookError
                ? "Confirming..."
                : isSuccess
                  ? "Bid placed"
                  : hookError
                    ? "Try again"
                    : isEncrypted
                      ? IS_ANVIL
                        ? "Submit mock blind bid"
                        : "Submit encrypted bid"
                      : "Submit bid"}
      </button>

      <div className="mt-4 font-mono text-[10px] text-muted-foreground/70 border border-border/40 px-3 py-2 space-y-1">
        {isEncrypted ? (
          <>
            <p>
              {IS_ANVIL
                ? <>Calls <code>mockSubmitBlindBid(maxPrice, amount)</code> on the SilentBid contract with <code>msg.value = amount</code>.</>
                : <>Calls <code>submitBlindBid(commitment)</code> on the SilentBid contract with <code>msg.value = amount</code>.</>
              }
            </p>
            <p>
              SilentBid: <code className="text-accent/80 break-all">{silentBidAddress}</code>
            </p>
          </>
        ) : (
          <>
            <p>
              Calls <code>submitBid(maxPrice, amount, owner, prevTickPrice, hookData)</code> on the auction
              with <code>msg.value = amount</code>.
            </p>
            <p>
              Auction: <code className="text-accent/80 break-all">{auctionId}</code>
            </p>
          </>
        )}
      </div>
    </form>
  )
}
