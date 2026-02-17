import { type Address } from "viem"
import { IS_ANVIL } from "./chain-config"

export const CCA_FACTORY = (
  IS_ANVIL
    ? "0x2fB4bEC86aBEB9724c036c544313F58a535F1af4"
    : "0xcca1101C61cF5cb44C968947985300DF945C3565"
) as Address

export const FACTORY_DEPLOY_BLOCK = IS_ANVIL ? BigInt(0) : BigInt(10_184_000)

export const Q96 = BigInt(2) ** BigInt(96)

/** Convert Q96-encoded price to a human-readable ETH string */
export function q96ToEth(q96Price: bigint): string {
  if (q96Price === BigInt(0)) return "0"
  // price = q96Price / 2^96, show up to 8 decimals
  const whole = q96Price / Q96
  const remainder = q96Price % Q96
  const decimals = (remainder * BigInt(100_000_000)) / Q96
  const dec = decimals.toString().padStart(8, "0").replace(/0+$/, "")
  if (!dec) return whole.toString()
  return `${whole}.${dec}`
}

export type AuctionStatus = "upcoming" | "active" | "ended"

export interface OnchainAuction {
  /** Auction contract address (used as ID) */
  address: Address
  token: Address
  /** Display name: CCA1, CCA2, ... by creation order (offchain name is not on contract) */
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
  status: AuctionStatus
}

// Factory ABI — only the event we need
export const FACTORY_ABI = [
  {
    type: "event",
    name: "AuctionCreated",
    inputs: [
      { name: "auction", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "configData", type: "bytes", indexed: false },
    ],
  },
] as const

// BidSubmitted event for fetching latest bids
export const BID_SUBMITTED_EVENT = {
  type: "event",
  name: "BidSubmitted",
  inputs: [
    { name: "id", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { name: "price", type: "uint256", indexed: false },
    { name: "amount", type: "uint128", indexed: false },
  ],
} as const

// Auction contract ABI — view + write functions + event
export const AUCTION_ABI = [
  { type: "function", name: "token", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "startBlock", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "endBlock", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "clearingPrice", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "floorPrice", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "nextBidId", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "currencyRaised", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "totalSupply", inputs: [], outputs: [{ type: "uint128" }], stateMutability: "view" },
  { type: "function", name: "tickSpacing", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  // Write: 5-arg submitBid with prevTickPrice hint (avoids gas-heavy tick iteration)
  {
    type: "function",
    name: "submitBid",
    inputs: [
      { name: "maxPrice", type: "uint256" },
      { name: "amount", type: "uint128" },
      { name: "owner", type: "address" },
      { name: "prevTickPrice", type: "uint256" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [{ name: "bidId", type: "uint256" }],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "onTokensReceived",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const

// ── BlindPool (Zama fhEVM encrypted bidding) ───────────────────────

export const BLIND_POOL_FACTORY_ADDRESS =
  (process.env.NEXT_PUBLIC_BLIND_POOL_FACTORY_ADDRESS ?? "") as Address

/** On Anvil, there's no BlindPoolFactory — use this env var to inject the blind pool address directly */
export const BLIND_POOL_OVERRIDE =
  (process.env.NEXT_PUBLIC_BLIND_POOL_OVERRIDE ?? "") as Address

export const BLIND_POOL_FACTORY_ABI = [
  {
    type: "function",
    name: "deployBlindPool",
    inputs: [{ name: "_cca", type: "address" }],
    outputs: [{ name: "blindPool", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "BlindPoolDeployed",
    inputs: [
      { name: "cca", type: "address", indexed: true },
      { name: "blindPool", type: "address", indexed: true },
      { name: "blindBidDeadline", type: "uint64", indexed: false },
    ],
  },
] as const

export const BLIND_POOL_ABI = [
  // Write
  {
    type: "function",
    name: "submitBlindBid",
    inputs: [
      { name: "_encMaxPrice", type: "bytes32" },
      { name: "_encAmount", type: "bytes32" },
      { name: "_inputProof", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "requestReveal",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Views
  { type: "function", name: "admin", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "cca", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "blindBidDeadline", inputs: [], outputs: [{ type: "uint64" }], stateMutability: "view" },
  { type: "function", name: "nextBlindBidId", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "revealed", inputs: [], outputs: [{ type: "bool" }], stateMutability: "view" },
  {
    type: "function",
    name: "getBlindBidInfo",
    inputs: [{ name: "_blindBidId", type: "uint256" }],
    outputs: [
      { name: "bidder", type: "address" },
      { name: "ethDeposit", type: "uint256" },
      { name: "forwarded", type: "bool" },
    ],
    stateMutability: "view",
  },
  // Events
  {
    type: "event",
    name: "BlindBidPlaced",
    inputs: [
      { name: "blindBidId", type: "uint256", indexed: true },
      { name: "bidder", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "BidsRevealed",
    inputs: [{ name: "totalBids", type: "uint256", indexed: false }],
  },
] as const

// Mock blind bid ABI — used on Anvil where Zama encryption is not available
export const MOCK_BLIND_BID_ABI = [
  {
    type: "function",
    name: "mockSubmitBlindBid",
    inputs: [
      { name: "_maxPrice", type: "uint64" },
      { name: "_amount", type: "uint64" },
    ],
    outputs: [],
    stateMutability: "payable",
  },
] as const

// ERC20 ABI — mint and transfer for funding auctions
export const ERC20_ABI = [
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const

/** Convert an ETH-denominated price string to Q96 fixed-point */
export function ethToQ96(ethPrice: string): bigint {
  const price = parseFloat(ethPrice)
  if (!Number.isFinite(price) || price <= 0) return BigInt(0)
  const decimals = (ethPrice.split(".")[1] || "").length
  const denominator = BigInt(10) ** BigInt(decimals)
  const numerator = BigInt(Math.round(price * Number(denominator)))
  return (numerator * Q96) / denominator
}

/** Snap a Q96 price UP to the nearest valid tick boundary */
export function snapToTickBoundary(priceQ96: bigint, tickSpacing: bigint): bigint {
  const p = BigInt(priceQ96)
  const ts = BigInt(tickSpacing)
  if (ts <= BigInt(0)) return p
  const remainder = p % ts
  if (remainder === BigInt(0)) return p
  // Round up to next tick boundary
  return p - remainder + ts
}
