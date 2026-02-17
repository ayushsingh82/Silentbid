"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import Link from "next/link"
import { usePublicClient, useBlockNumber } from "wagmi"
import { formatEther, type Address } from "viem"
import { cn } from "@/lib/utils"
import { chainId, networkName } from "@/lib/chain-config"
import {
  CCA_FACTORY,
  FACTORY_DEPLOY_BLOCK,
  FACTORY_ABI,
  AUCTION_ABI,
  q96ToEth,
  type OnchainAuction,
  type AuctionStatus,
} from "@/lib/auction-contracts"

const CACHE_TTL = 30_000 // 30 seconds

function statusLabel(s: AuctionStatus) {
  switch (s) {
    case "active": return "Live"
    case "upcoming": return "Upcoming"
    case "ended": return "Ended"
  }
}

const STATUS_ORDER: Record<AuctionStatus, number> = { active: 0, upcoming: 1, ended: 2 }

function blocksToTime(blocks: bigint): string {
  const seconds = Number(blocks) * 12
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

function deriveStatus(startBlock: bigint, endBlock: bigint, currentBlock: bigint): AuctionStatus {
  if (currentBlock >= endBlock) return "ended"
  if (currentBlock >= startBlock) return "active"
  return "upcoming"
}

export function AuctionList({ filter }: { filter?: AuctionStatus }) {
  const publicClient = usePublicClient({ chainId })
  // Block number ONLY for countdown display — not used in any effect deps
  const { data: currentBlock } = useBlockNumber({ chainId, watch: true })

  const [auctions, setAuctions] = useState<OnchainAuction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastFetchRef = useRef<number>(0)
  const fetchingRef = useRef(false)

  const fetchAuctions = useCallback(async (isBackground: boolean) => {
    if (!publicClient || fetchingRef.current) return
    fetchingRef.current = true

    try {
      // Only show loading spinner on initial fetch, not background refreshes
      if (!isBackground) setLoading(true)

      const latestBlock = await publicClient.getBlockNumber()

      // Fetch AuctionCreated events (paginate in 1000-block chunks)
      const CHUNK = BigInt(1000)
      const allLogs: { auction: Address; token: Address }[] = []
      let from = FACTORY_DEPLOY_BLOCK

      while (from <= latestBlock) {
        const to = from + CHUNK - BigInt(1) > latestBlock ? latestBlock : from + CHUNK - BigInt(1)
        const chunk = await publicClient.getLogs({
          address: CCA_FACTORY,
          event: FACTORY_ABI[0],
          fromBlock: from,
          toBlock: to,
        })
        for (const log of chunk) {
          if (log.args.auction && log.args.token) {
            allLogs.push({ auction: log.args.auction, token: log.args.token })
          }
        }
        from = to + BigInt(1)
      }

      // Read each auction's state (creation order = allLogs order, so CCA1, CCA2, ...)
      const raw = await Promise.all(
        allLogs.map(async (log) => {
          const results = await publicClient.multicall({
            contracts: [
              { address: log.auction, abi: AUCTION_ABI, functionName: "startBlock" },
              { address: log.auction, abi: AUCTION_ABI, functionName: "endBlock" },
              { address: log.auction, abi: AUCTION_ABI, functionName: "clearingPrice" },
              { address: log.auction, abi: AUCTION_ABI, functionName: "floorPrice" },
              { address: log.auction, abi: AUCTION_ABI, functionName: "nextBidId" },
              { address: log.auction, abi: AUCTION_ABI, functionName: "currencyRaised" },
              { address: log.auction, abi: AUCTION_ABI, functionName: "totalSupply" },
            ],
          })

          const startBlock = (results[0].result as bigint) ?? BigInt(0)
          const endBlock = (results[1].result as bigint) ?? BigInt(0)
          const clearingPriceRaw = (results[2].result as bigint) ?? BigInt(0)
          const floorPriceRaw = (results[3].result as bigint) ?? BigInt(0)

          return {
            address: log.auction,
            token: log.token,
            startBlock,
            endBlock,
            clearingPrice: q96ToEth(clearingPriceRaw),
            clearingPriceRaw,
            floorPrice: q96ToEth(floorPriceRaw),
            floorPriceRaw,
            bidCount: Number((results[4].result as bigint) ?? BigInt(0)),
            currencyRaised: formatEther((results[5].result as bigint) ?? BigInt(0)),
            totalSupply: formatEther((results[6].result as bigint) ?? BigInt(0)),
            status: deriveStatus(startBlock, endBlock, latestBlock),
          }
        })
      )

      const all = raw.map((a, i) => ({ ...a, auctionNumber: i + 1 })) as OnchainAuction[]
      setAuctions(all)
      setError(null)
      lastFetchRef.current = Date.now()
    } catch (err: unknown) {
      // Only show error if no cached data
      if (auctions.length === 0) {
        setError(err instanceof Error ? err.message : "Failed to fetch auctions")
      }
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, [publicClient]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial fetch
  useEffect(() => {
    if (!publicClient) return
    fetchAuctions(false)
  }, [publicClient, fetchAuctions])

  // Background refresh every 30 seconds
  useEffect(() => {
    if (!publicClient) return
    const interval = setInterval(() => {
      if (Date.now() - lastFetchRef.current >= CACHE_TTL) {
        fetchAuctions(true)
      }
    }, CACHE_TTL)
    return () => clearInterval(interval)
  }, [publicClient, fetchAuctions])

  // Recompute statuses from currentBlock without refetching
  const auctionsWithLiveStatus = auctions.map((a) => ({
    ...a,
    status: currentBlock ? deriveStatus(a.startBlock, a.endBlock, currentBlock) : a.status,
  }))

  const filtered = filter
    ? auctionsWithLiveStatus.filter((a) => a.status === filter)
    : [...auctionsWithLiveStatus].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])

  if (loading) {
    return (
      <div className="border border-border/40 p-12 text-center">
        <p className="font-mono text-sm text-muted-foreground animate-pulse">
          Loading auctions from {networkName}...
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-destructive/50 bg-destructive/10 p-6">
        <p className="font-mono text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="border border-border/40 p-12 md:p-16 text-center">
        <p className="font-mono text-sm text-muted-foreground">
          {filter
            ? `No ${statusLabel(filter).toLowerCase()} auctions right now.`
            : `No auctions found on ${networkName}.`}
        </p>
        {filter && (
          <Link href="/auctions" className="mt-4 inline-block font-mono text-xs uppercase tracking-widest text-accent hover:underline">
            View all
          </Link>
        )}
      </div>
    )
  }

  return (
    <>
      <span className="mb-4 block font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {filtered.length} auction{filtered.length !== 1 ? "s" : ""} on {networkName}
      </span>
      <ul className="grid gap-4 md:gap-6">
        {filtered.map((auction) => (
          <li key={auction.address}>
            <Link
              href={`/auctions/${auction.address}`}
              className={cn(
                "block border border-border/40 p-6 md:p-8 transition-all duration-200",
                "hover:border-accent/60 hover:bg-accent/5",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-[var(--font-bebas)] text-2xl md:text-4xl tracking-tight">CCA{auction.auctionNumber}</span>
                    <span className={cn(
                      "font-mono text-[10px] uppercase tracking-widest px-2 py-1 border",
                      auction.status === "active" && "border-accent/60 text-accent",
                      auction.status !== "active" && "border-muted-foreground/40 text-muted-foreground",
                    )}>
                      {statusLabel(auction.status)}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-xs text-muted-foreground break-all">{auction.address}</p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                    Token {auction.token.slice(0, 6)}…{auction.token.slice(-4)} · {networkName}
                  </p>
                </div>
                <div className="flex flex-wrap gap-6 md:gap-10 font-mono text-xs text-muted-foreground">
                  <div>
                    <span className="block text-[10px] uppercase tracking-widest text-muted-foreground/70">Clearing price</span>
                    <span className="text-foreground">{auction.clearingPrice} ETH</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-widest text-muted-foreground/70">Bids</span>
                    <span className="text-foreground">{auction.bidCount}</span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-widest text-muted-foreground/70">
                      {auction.status === "ended" ? "Ended" : "Ends in"}
                    </span>
                    <span className="text-foreground">
                      {auction.status === "ended"
                        ? "Closed"
                        : currentBlock
                          ? `~${blocksToTime(auction.endBlock - currentBlock)}`
                          : "—"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-widest text-muted-foreground/70">Raised</span>
                    <span className="text-foreground">{parseFloat(auction.currencyRaised).toFixed(4)} ETH</span>
                  </div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
