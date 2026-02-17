/**
 * Mock CCA (Continuous Clearing Auction) data for BlindPool demo.
 * Mirrors concepts from Uniswap CCA: token, status, clearing price, sealed bids, end time.
 */

export type AuctionStatus = "upcoming" | "active" | "ended"

export interface Auction {
  id: string
  tokenSymbol: string
  tokenName: string
  status: AuctionStatus
  /** Unix ms */
  startTime: number
  /** Unix ms */
  endTime: number
  /** Current / final clearing price (quote per token) */
  clearingPrice: string
  /** Sealed bid count (hidden until ended in real CCA) */
  bidCount: number
  /** Total quote committed (e.g. ETH) — hidden until ended in real CCA */
  totalCommitment: string
  /** Pool will be seeded on this chain */
  chainId: number
  chainName: string
  description?: string
}

const now = Date.now()
const day = 24 * 60 * 60 * 1000

export const mockAuctions: Auction[] = [
  {
    id: "bp-eth-001",
    tokenSymbol: "BLIND",
    tokenName: "BlindPool Genesis",
    status: "active",
    startTime: now - 2 * day,
    endTime: now + 5 * day,
    clearingPrice: "0.0024",
    bidCount: 127,
    totalCommitment: "12.4",
    chainId: 1,
    chainName: "Ethereum",
    description: "Genesis token launch. Sealed bids only; clearing price updates continuously.",
  },
  {
    id: "bp-eth-002",
    tokenSymbol: "PRIV",
    tokenName: "Privacy Token",
    status: "upcoming",
    startTime: now + 3 * day,
    endTime: now + 10 * day,
    clearingPrice: "—",
    bidCount: 0,
    totalCommitment: "0",
    chainId: 1,
    chainName: "Ethereum",
    description: "Upcoming sealed-bid CCA. No MEV leakage; bids are confidential until close.",
  },
  {
    id: "bp-base-001",
    tokenSymbol: "SEAL",
    tokenName: "Sealed Bid Demo",
    status: "ended",
    startTime: now - 14 * day,
    endTime: now - 1 * day,
    clearingPrice: "0.0018",
    bidCount: 89,
    totalCommitment: "8.2",
    chainId: 8453,
    chainName: "Base",
    description: "Completed auction. Liquidity seeded to Uniswap pool.",
  },
  {
    id: "bp-eth-003",
    tokenSymbol: "ZK",
    tokenName: "ZK Launch",
    status: "active",
    startTime: now - 1 * day,
    endTime: now + 7 * day,
    clearingPrice: "0.0031",
    bidCount: 43,
    totalCommitment: "5.1",
    chainId: 1,
    chainName: "Ethereum",
    description: "Active CCA with ZK-sealed bids. Price discovery in progress.",
  },
]

export function getAuctionById(id: string): Auction | undefined {
  return mockAuctions.find((a) => a.id === id)
}

export function getAuctionsByStatus(status: AuctionStatus): Auction[] {
  return mockAuctions.filter((a) => a.status === status)
}
