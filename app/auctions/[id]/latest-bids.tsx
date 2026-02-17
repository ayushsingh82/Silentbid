"use client"

import { useEffect, useState } from "react"
import { usePublicClient } from "wagmi"
import { formatEther, type Address } from "viem"
import { BID_SUBMITTED_EVENT, BLIND_POOL_ABI, q96ToEth } from "@/lib/auction-contracts"
import { chainId, blockExplorerUrl } from "@/lib/chain-config"

export interface BidRow {
  id: bigint
  owner: Address
  price: bigint
  amount: bigint
  blockNumber: bigint
  encrypted?: boolean
}

function formatTimeAgo(blocksAgo: number): string {
  const seconds = blocksAgo * 12
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

function shortAddress(addr: Address): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// BlindBidPlaced event from BlindPoolCCA
const BLIND_BID_PLACED_EVENT = {
  type: "event",
  name: "BlindBidPlaced",
  inputs: [
    { name: "blindBidId", type: "uint256", indexed: true },
    { name: "bidder", type: "address", indexed: true },
  ],
} as const

export function LatestBids({
  auctionAddress,
  startBlock,
  currentBlock,
  blindPoolAddress,
}: {
  auctionAddress: Address
  startBlock: bigint
  currentBlock: bigint | undefined
  blindPoolAddress?: Address
}) {
  const publicClient = usePublicClient({ chainId })
  const [bids, setBids] = useState<BidRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!publicClient) return
    let cancelled = false

    async function fetchBids() {
      try {
        setLoading(true)
        setError(null)

        const allRows: BidRow[] = []

        // Fetch CCA BidSubmitted events (plain bids)
        const CHUNK = BigInt(9000)
        const latestBlock = await publicClient!.getBlockNumber()
        let from = startBlock
        while (from <= latestBlock) {
          const to = from + CHUNK - BigInt(1) > latestBlock ? latestBlock : from + CHUNK - BigInt(1)
          const logs = await publicClient!.getLogs({
            address: auctionAddress,
            event: BID_SUBMITTED_EVENT,
            fromBlock: from,
            toBlock: to,
          })
          for (const log of logs) {
            allRows.push({
              id: (log.args as { id: bigint }).id,
              owner: (log.args as { owner: Address }).owner,
              price: (log.args as { price: bigint }).price,
              amount: (log.args as { amount: bigint }).amount,
              blockNumber: log.blockNumber ?? BigInt(0),
            })
          }
          from = to + BigInt(1)
        }

        // Fetch BlindPool BlindBidPlaced events (encrypted bids)
        if (blindPoolAddress) {
          from = startBlock
          while (from <= latestBlock) {
            const to = from + CHUNK - BigInt(1) > latestBlock ? latestBlock : from + CHUNK - BigInt(1)
            const blindLogs = await publicClient!.getLogs({
              address: blindPoolAddress,
              event: BLIND_BID_PLACED_EVENT,
              fromBlock: from,
              toBlock: to,
            })
            for (const log of blindLogs) {
              allRows.push({
                id: (log.args as { blindBidId: bigint }).blindBidId,
                owner: (log.args as { bidder: Address }).bidder,
                price: BigInt(0), // encrypted — not visible
                amount: BigInt(0), // encrypted — not visible
                blockNumber: log.blockNumber ?? BigInt(0),
                encrypted: true,
              })
            }
            from = to + BigInt(1)
          }
        }

        if (cancelled) return
        allRows.sort((a, b) => Number(b.blockNumber - a.blockNumber))
        setBids(allRows.slice(0, 10))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load bids")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchBids()
    return () => { cancelled = true }
  }, [publicClient, auctionAddress, startBlock, blindPoolAddress])

  if (loading) {
    return (
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground animate-pulse">
        Loading latest bids…
      </div>
    )
  }

  if (error) {
    return (
      <p className="font-mono text-xs text-destructive/80">
        {error}
      </p>
    )
  }

  if (bids.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        No bids yet. Be the first to place a bid.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-xs border border-border/40">
        <thead>
          <tr className="border-b border-border/40 text-[10px] uppercase tracking-widest text-muted-foreground text-left">
            <th className="py-2 px-3">Wallet</th>
            <th className="py-2 px-3">Amount</th>
            <th className="py-2 px-3">Max price</th>
            <th className="py-2 px-3">Time</th>
          </tr>
        </thead>
        <tbody>
          {bids.map((bid) => (
            <tr key={`${bid.blockNumber}-${bid.id}-${bid.encrypted ? "enc" : "plain"}`} className="border-b border-border/30 hover:bg-muted/20">
              <td className="py-2 px-3">
                {blockExplorerUrl ? (
                  <a
                    href={`${blockExplorerUrl}/address/${bid.owner}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline break-all"
                  >
                    {shortAddress(bid.owner)}
                  </a>
                ) : (
                  <span className="text-accent break-all">{shortAddress(bid.owner)}</span>
                )}
              </td>
              <td className="py-2 px-3 text-foreground">
                {bid.encrypted ? (
                  <span className="text-purple-400 text-[10px]">encrypted</span>
                ) : (
                  `${parseFloat(formatEther(bid.amount)).toFixed(6)} ETH`
                )}
              </td>
              <td className="py-2 px-3 text-foreground">
                {bid.encrypted ? (
                  <span className="text-purple-400 text-[10px]">encrypted</span>
                ) : (
                  `${q96ToEth(bid.price)} ETH`
                )}
              </td>
              <td className="py-2 px-3 text-muted-foreground">
                {currentBlock
                  ? formatTimeAgo(Number(currentBlock - bid.blockNumber))
                  : `Block ${bid.blockNumber.toString()}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 font-mono text-[10px] text-muted-foreground/70">
        Latest bids
        {blockExplorerUrl && (
          <>
            {" · "}
            <a
              href={`${blockExplorerUrl}/address/${auctionAddress}#events`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent/80 hover:underline"
            >
              View all on Etherscan
            </a>
          </>
        )}
      </p>
    </div>
  )
}
