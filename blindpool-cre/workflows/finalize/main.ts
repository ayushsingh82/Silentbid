/**
 * SilentBid Auction Finalization Workflow (CRE)
 *
 * HTTP trigger: POST body = { auctionId, silentBidAddress? }
 * - Loads sealed bids for auction from CRE store / external API (Confidential HTTP).
 * - Computes clearing price and per-bid allocations offchain.
 * - Calls SilentBidCCA.forwardBidsToCCA(silentBidIds, clearMaxPrices, clearAmounts, owners, hookData)
 *   via admin key (EVM write). Requires CRE consumer or EVMClient integration.
 *
 * This stub returns a placeholder; full implementation would:
 * 1. Fetch bids from store (keyed by auctionId).
 * 2. Run price discovery (e.g. uniform-price).
 * 3. Build arrays for forwardBidsToCCA.
 * 4. Submit via EVM (evmClient or report to consumer contract).
 *
 * Refs: plan_execution.md, BlindPool-scripts/src/SilentBidCCA.sol
 */

import {
  HTTPCapability,
  handler,
  Runner,
  decodeJson,
  type Runtime,
  type HTTPPayload,
} from "@chainlink/cre-sdk"
import { z } from "zod"

const configSchema = z.object({
  chainId: z.number(),
  silentBidAddress: z.string(),
  rpcUrl: z.string(),
})

type Config = z.infer<typeof configSchema>

type FinalizePayload = {
  auctionId: string
  silentBidAddress?: string
}

const onFinalizeRequest = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  if (!payload.input || payload.input.length === 0) {
    throw new Error("Empty request body")
  }

  const raw = decodeJson(payload.input) as FinalizePayload
  const auctionId = raw.auctionId
  const silentBid = raw.silentBidAddress ?? runtime.config.silentBidAddress

  runtime.log(`Finalize requested for auction ${auctionId}, silentBid ${silentBid}`)

  // Stub: in production, load bids from store, compute clearing, call forwardBidsToCCA
  const result = {
    auctionId,
    silentBidAddress: silentBid,
    status: "stub",
    message: "Load bids from store, compute clearing price, call forwardBidsToCCA(silentBidIds, clearMaxPrices, clearAmounts, owners, hookData) as admin.",
  }
  return JSON.stringify(result)
}

const initWorkflow = (config: Config) => {
  const http = new HTTPCapability()
  const trigger = http.trigger({ authorizedKeys: [] })
  return [handler(trigger, onFinalizeRequest)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
