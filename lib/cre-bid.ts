import { keccak256, encodePacked } from "viem"

/**
 * Compute the onchain bid commitment for SilentBid (SilentBidCCA.submitSilentBid(bytes32)).
 * Must match the format expected by CRE workflows (see md/CRE_INTEGRATION.md).
 */
export function computeBidCommitment(
  auctionId: `0x${string}`,
  sender: `0x${string}`,
  maxPriceQ96: bigint,
  amountWei: bigint,
  timestampSeconds: bigint = BigInt(Math.floor(Date.now() / 1000))
): `0x${string}` {
  return keccak256(
    encodePacked(
      ["address", "address", "uint256", "uint256", "uint256"],
      [auctionId, sender, maxPriceQ96, amountWei, timestampSeconds]
    )
  )
}
