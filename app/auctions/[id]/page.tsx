"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useAccount, usePublicClient, useBlockNumber } from "wagmi"
import { formatEther, type Address } from "viem"
import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import { PlaceBidForm } from "./place-bid-form"
import { LatestBids } from "./latest-bids"
import { cn } from "@/lib/utils"
import { chainId, networkName } from "@/lib/chain-config"
import {
  CCA_FACTORY,
  FACTORY_DEPLOY_BLOCK,
  FACTORY_ABI,
  AUCTION_ABI,
  BLIND_POOL_ABI,
  BLIND_POOL_FACTORY_ABI,
  BLIND_POOL_FACTORY_ADDRESS,
  BLIND_POOL_OVERRIDE,
  q96ToEth,
  type AuctionStatus,
} from "@/lib/auction-contracts"

// Note: BLIND_POOL_FACTORY_ABI kept for event log parsing in findExistingBlindPool

function statusLabel(s: AuctionStatus) {
  switch (s) {
    case "active": return "Live"
    case "upcoming": return "Upcoming"
    case "ended": return "Ended"
  }
}

function blocksToTime(blocks: bigint): string {
  const seconds = Number(blocks) * 12
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`
  return `${Math.round(seconds / 86400)}d`
}

interface AuctionData {
  address: Address
  token: Address
  /** CCA1, CCA2, ... by creation order */
  auctionNumber: number
  startBlock: bigint
  endBlock: bigint
  clearingPrice: string
  clearingPriceRaw: bigint
  floorPrice: string
  floorPriceRaw: bigint
  bidCount: number
  currencyRaised: string
  totalSupply: string
  tickSpacing: bigint
}

export default function AuctionDetailPage() {
  const params = useParams()
  const auctionAddress = params.id as Address
  const { isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId })

  // Watch block ONLY for countdown display — NOT used in any useEffect deps
  const { data: currentBlock } = useBlockNumber({ chainId, watch: true })

  const [auction, setAuction] = useState<AuctionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [bidsRefreshKey, setBidsRefreshKey] = useState(0)
  const fetchedRef = useRef(false)
  const handleBidSuccess = useCallback(() => setBidsRefreshKey((k) => k + 1), [])

  // ── BlindPool state ──
  const [blindPoolAddress, setBlindPoolAddress] = useState<Address | null>(
    BLIND_POOL_OVERRIDE || null
  )
  const [blindPoolLoading, setBlindPoolLoading] = useState(false)
  const [blindPoolDeadline, setBlindPoolDeadline] = useState<bigint | null>(null)
  const [blindPoolBidCount, setBlindPoolBidCount] = useState<number | null>(null)
  const [blindPoolRevealed, setBlindPoolRevealed] = useState(false)


  // Look for existing BlindPool from factory events (skip if override is set)
  useEffect(() => {
    if (!publicClient || !BLIND_POOL_FACTORY_ADDRESS || blindPoolAddress) return

    async function findExistingBlindPool() {
      if (!publicClient) return
      setBlindPoolLoading(true)
      try {
        const latestBlock = await publicClient.getBlockNumber()
        // Search backwards from latest in 9000-block chunks (RPC limit is 10k)
        const CHUNK = BigInt(9000)
        let to = latestBlock
        const minBlock = FACTORY_DEPLOY_BLOCK
        while (to >= minBlock) {
          const from = to - CHUNK + BigInt(1) < minBlock ? minBlock : to - CHUNK + BigInt(1)
          const logs = await publicClient.getLogs({
            address: BLIND_POOL_FACTORY_ADDRESS,
            event: BLIND_POOL_FACTORY_ABI[1], // BlindPoolDeployed event
            args: { cca: auctionAddress },
            fromBlock: from,
            toBlock: to,
          })
          if (logs.length > 0) {
            const latest = logs[logs.length - 1]
            const addr = latest.args.blindPool as Address
            console.log("[BlindPool] Found:", addr, "for CCA:", auctionAddress)
            setBlindPoolAddress(addr)
            if (latest.args.blindBidDeadline) {
              setBlindPoolDeadline(BigInt(latest.args.blindBidDeadline))
            }
            return
          }
          to = from - BigInt(1)
        }
        console.log("[BlindPool] No BlindPool found for CCA:", auctionAddress)
      } catch (err) {
        console.error("[BlindPool] Search error:", err)
      } finally {
        setBlindPoolLoading(false)
      }
    }
    findExistingBlindPool()
  }, [publicClient, auctionAddress, blindPoolAddress])

  // Fetch BlindPool metadata when we have an address (re-runs on bidsRefreshKey to update count)
  useEffect(() => {
    if (!publicClient || !blindPoolAddress) return

    async function fetchBlindPoolData() {
      if (!publicClient || !blindPoolAddress) return
      try {
        const results = await publicClient.multicall({
          contracts: [
            { address: blindPoolAddress, abi: BLIND_POOL_ABI, functionName: "blindBidDeadline" },
            { address: blindPoolAddress, abi: BLIND_POOL_ABI, functionName: "nextBlindBidId" },
            { address: blindPoolAddress, abi: BLIND_POOL_ABI, functionName: "revealed" },
          ],
        })
        if (results[0].result !== undefined) setBlindPoolDeadline(BigInt(results[0].result as bigint))
        if (results[1].result !== undefined) setBlindPoolBidCount(Number(results[1].result))
        if (results[2].result !== undefined) setBlindPoolRevealed(results[2].result as boolean)
      } catch {
        // BlindPool may not be fully deployed yet
      }
    }
    fetchBlindPoolData()
  }, [publicClient, blindPoolAddress, bidsRefreshKey])

  const fetchAuction = useCallback(async () => {
    if (!publicClient) return
    try {
      const [results, latestBlock] = await Promise.all([
        publicClient.multicall({
          contracts: [
            { address: auctionAddress, abi: AUCTION_ABI, functionName: "token" },
            { address: auctionAddress, abi: AUCTION_ABI, functionName: "startBlock" },
            { address: auctionAddress, abi: AUCTION_ABI, functionName: "endBlock" },
            { address: auctionAddress, abi: AUCTION_ABI, functionName: "clearingPrice" },
            { address: auctionAddress, abi: AUCTION_ABI, functionName: "floorPrice" },
            { address: auctionAddress, abi: AUCTION_ABI, functionName: "nextBidId" },
            { address: auctionAddress, abi: AUCTION_ABI, functionName: "currencyRaised" },
            { address: auctionAddress, abi: AUCTION_ABI, functionName: "totalSupply" },
            { address: auctionAddress, abi: AUCTION_ABI, functionName: "tickSpacing" },
          ],
        }),
        publicClient.getBlockNumber(),
      ])

      const tokenAddress = results[0].result as Address

      // Creation order from factory events → CCA1, CCA2, ...
      const CHUNK = BigInt(1000)
      const auctionAddresses: Address[] = []
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
          if (log.args.auction) auctionAddresses.push(log.args.auction)
        }
        from = to + BigInt(1)
      }
      const auctionNumber = auctionAddresses.indexOf(auctionAddress) + 1 || 1

      setAuction({
        address: auctionAddress,
        token: tokenAddress,
        auctionNumber,
        startBlock: (results[1].result as bigint) ?? BigInt(0),
        endBlock: (results[2].result as bigint) ?? BigInt(0),
        clearingPrice: q96ToEth((results[3].result as bigint) ?? BigInt(0)),
        clearingPriceRaw: (results[3].result as bigint) ?? BigInt(0),
        floorPrice: q96ToEth((results[4].result as bigint) ?? BigInt(0)),
        floorPriceRaw: (results[4].result as bigint) ?? BigInt(0),
        bidCount: Number((results[5].result as bigint) ?? BigInt(0)),
        currencyRaised: formatEther((results[6].result as bigint) ?? BigInt(0)),
        totalSupply: formatEther((results[7].result as bigint) ?? BigInt(0)),
        tickSpacing: (results[8].result as bigint) ?? BigInt(0),
      })
      setFetchError(null)
    } catch (err: unknown) {
      // Only set error if we have no data yet
      if (!auction) setFetchError(err instanceof Error ? err.message : "Failed to fetch auction")
    } finally {
      setLoading(false)
    }
  }, [publicClient, auctionAddress]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial fetch — runs once when publicClient is ready
  useEffect(() => {
    if (!publicClient || fetchedRef.current) return
    fetchedRef.current = true
    fetchAuction()
  }, [publicClient, fetchAuction])

  // Derive status from block number — never downgrade if currentBlock is temporarily undefined
  const prevStatusRef = useRef<AuctionStatus>("upcoming")
  const status: AuctionStatus = useMemo(() => {
    if (!auction) return prevStatusRef.current
    if (!currentBlock) return prevStatusRef.current // keep previous, don't unmount form
    let s: AuctionStatus = "upcoming"
    if (currentBlock >= auction.endBlock) s = "ended"
    else if (currentBlock >= auction.startBlock) s = "active"
    prevStatusRef.current = s
    return s
  }, [auction, currentBlock])

  // Can bid if auction is active AND (no blind pool, or blind pool deadline not passed)
  const blindBidOpen = blindPoolAddress && blindPoolDeadline && currentBlock
    ? currentBlock < blindPoolDeadline
    : true
  const canBid = status === "active"

  if (loading) {
    return (
      <div className="px-6 md:px-12 py-12 md:py-20">
        <p className="font-mono text-sm text-muted-foreground animate-pulse">
          Loading auction from {networkName}...
        </p>
      </div>
    )
  }

  if (fetchError || !auction) {
    return (
      <div className="px-6 md:px-12 py-12 md:py-20">
        <Link href="/auctions" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-accent transition-colors">
          &larr; All auctions
        </Link>
        <div className="mt-8 border border-destructive/50 bg-destructive/10 p-6">
          <p className="font-mono text-sm text-destructive">{fetchError ?? "Auction not found."}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-6 md:px-12 py-12 md:py-20">
      <Link href="/auctions" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-accent transition-colors">
        &larr; All auctions
      </Link>

      <div className="mt-8 md:mt-12 max-w-5xl">
        <div className="flex items-center gap-3">
          <h1 className="font-[var(--font-bebas)] text-4xl md:text-6xl tracking-tight">CCA{auction.auctionNumber}</h1>
          <span className={cn(
            "font-mono text-[10px] uppercase tracking-widest px-2 py-1 border",
            status === "active" && "border-accent/60 text-accent",
            status !== "active" && "border-muted-foreground/40 text-muted-foreground",
          )}>
            {statusLabel(status)}
          </span>
          {blindPoolAddress && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-2 py-1 border border-purple-500/60 text-purple-400">
              Encrypted
            </span>
          )}
        </div>
        <p className="mt-2 font-mono text-xs text-muted-foreground break-all">
          {blindPoolAddress ?? auction.address}
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
          Token {auction.token.slice(0, 6)}...{auction.token.slice(-4)} · {networkName}
          {blindPoolAddress && <> · Powered by <span className="text-purple-400">Zama fhEVM</span></>}
        </p>

        <dl className="mt-10 grid grid-cols-2 md:grid-cols-4 gap-6 font-mono text-sm">
          {blindPoolAddress ? (
            <>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Floor price</dt>
                <dd className="mt-1 text-foreground">{auction.floorPrice} ETH</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Clearing price</dt>
                <dd className="mt-1 text-purple-400 text-[10px]">hidden until reveal</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Encrypted bids</dt>
                <dd className="mt-1 text-foreground">{blindPoolBidCount ?? 0}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Total supply</dt>
                <dd className="mt-1 text-foreground">{parseFloat(auction.totalSupply).toLocaleString()} tokens</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Bid deadline</dt>
                <dd className="mt-1 text-foreground">
                  {blindPoolDeadline && currentBlock
                    ? currentBlock < blindPoolDeadline
                      ? `~${blocksToTime(blindPoolDeadline - currentBlock)}`
                      : "Closed"
                    : "\u2014"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">{status === "ended" ? "Ended" : "Auction ends"}</dt>
                <dd className="mt-1 text-foreground">
                  {status === "ended"
                    ? "Closed"
                    : currentBlock
                      ? `~${blocksToTime(auction.endBlock - currentBlock)}`
                      : "\u2014"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Phase</dt>
                <dd className="mt-1 text-foreground text-[10px]">
                  {blindPoolRevealed
                    ? "Revealed — forwarding to CCA"
                    : blindPoolDeadline && currentBlock && currentBlock >= blindPoolDeadline
                      ? "Bidding closed — awaiting reveal"
                      : "Accepting encrypted bids"}
                </dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Clearing price</dt>
                <dd className="mt-1 text-foreground">{auction.clearingPrice} ETH</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Floor price</dt>
                <dd className="mt-1 text-foreground">{auction.floorPrice} ETH</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Bids</dt>
                <dd className="mt-1 text-foreground">{auction.bidCount}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Raised</dt>
                <dd className="mt-1 text-foreground">{parseFloat(auction.currencyRaised).toFixed(4)} ETH</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">Total supply</dt>
                <dd className="mt-1 text-foreground">{parseFloat(auction.totalSupply).toLocaleString()} tokens</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-widest text-muted-foreground/70">{status === "ended" ? "Ended" : "Ends in"}</dt>
                <dd className="mt-1 text-foreground">
                  {status === "ended"
                    ? "Closed"
                    : currentBlock
                      ? `~${blocksToTime(auction.endBlock - currentBlock)}`
                      : "\u2014"}
                </dd>
              </div>
            </>
          )}
        </dl>

        {/* ── Encryption info ── */}
        {blindPoolAddress && (
          <div className="mt-8 border border-purple-500/30 bg-purple-500/5 p-4 font-mono text-[10px] text-muted-foreground space-y-1">
            <p className="text-purple-400 uppercase tracking-widest">Zama fhEVM encrypted auction</p>
            <p>All bids are encrypted on-chain. Price and amount are hidden until the reveal phase.</p>
            <p>After the bid deadline, bids are decrypted and forwarded to the CCA for settlement.</p>
          </div>
        )}


        {canBid && (
          <div className="mt-14 pt-10 border-t border-border/40">
            <div className="grid grid-cols-1 md:grid-cols-[1fr,minmax(280px,380px)] gap-8 md:gap-12 items-start">
              <div className="min-w-0">
                <h2 className="font-[var(--font-bebas)] text-2xl md:text-3xl tracking-tight">
                  {blindPoolAddress ? "Place encrypted bid" : "Place sealed bid"}
                </h2>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {blindPoolAddress
                    ? "Your bid is encrypted with Zama fhEVM. Price and amount are hidden until the reveal phase."
                    : "Your bid is confidential until the auction closes."}
                </p>
                <PlaceBidForm
                  auctionId={auction.address}
                  tokenSymbol={`CCA${auction.auctionNumber}`}
                  floorPrice={auction.floorPrice}
                  floorPriceRaw={auction.floorPriceRaw}
                  clearingPrice={auction.clearingPrice}
                  clearingPriceRaw={auction.clearingPriceRaw}
                  totalSupply={auction.totalSupply}
                  tickSpacing={auction.tickSpacing}
                  blindPoolAddress={blindPoolAddress ?? undefined}
                  onBidSuccess={handleBidSuccess}
                />
              </div>
              <div className="min-w-0 border border-border/40 rounded-sm p-4 bg-muted/20">
                <h3 className="font-[var(--font-bebas)] text-xl tracking-tight text-muted-foreground mb-3">Latest bids</h3>
                <LatestBids
                  key={bidsRefreshKey}
                  auctionAddress={auction.address}
                  startBlock={auction.startBlock}
                  currentBlock={currentBlock ?? undefined}
                  blindPoolAddress={blindPoolAddress ?? undefined}
                />
              </div>
            </div>
          </div>
        )}

        {status === "upcoming" && (
          <div className="mt-14 pt-10 border-t border-border/40">
            <p className="font-mono text-sm text-muted-foreground">
              Auction has not started yet. Bidding opens at block {auction.startBlock.toString()}.
              {currentBlock && <> Current block: {currentBlock.toString()}.</>}
            </p>
          </div>
        )}

        {status === "ended" && (
          <div className="mt-14 pt-10 border-t border-border/40">
            <p className="font-mono text-sm text-muted-foreground">This auction has ended. Final clearing price: {auction.clearingPrice} ETH.</p>
          </div>
        )}
      </div>
    </div>
  )
}
