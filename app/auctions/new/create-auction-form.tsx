"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { useAccount, useBlockNumber, useWriteContract, useWaitForTransactionReceipt } from "wagmi"
import { parseEther, encodeAbiParameters, parseAbiParameters, type Address, decodeEventLog, formatEther } from "viem"
import { chainId, networkName } from "@/lib/chain-config"
import {
  CCA_FACTORY,
  FACTORY_ABI as FACTORY_EVENT_ABI,
  AUCTION_ABI,
  ERC20_ABI,
  BLIND_POOL_FACTORY_ABI,
  BLIND_POOL_FACTORY_ADDRESS,
  ethToQ96,
} from "@/lib/auction-contracts"

// Full Factory ABI: event + initializeDistribution
const FACTORY_ABI = [
  ...FACTORY_EVENT_ABI,
  {
    name: "initializeDistribution",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "configData", type: "bytes" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const

const MOCK_TOKEN = "0xc4aAE767E65a18bF381c3159e58b899CA7f8561F" as const

const DURATION_OPTIONS = [
  { value: "5m", label: "5 min (testing)", blocks: 25 },
  { value: "1h", label: "1 hr", blocks: 300 },
  { value: "6h", label: "6 hr", blocks: 1800 },
  { value: "1d", label: "1 day", blocks: 7200 },
  { value: "7d", label: "7 day", blocks: 50400 },
] as const

const inputClass = cn(
  "mt-2 w-full border border-border bg-input/50 px-4 py-3 font-mono text-sm",
  "placeholder:text-muted-foreground/50 focus:outline-none focus:border-accent",
)
const labelClass = "block font-mono text-[10px] uppercase tracking-widest text-muted-foreground"

// Build auctionStepsData: 100% linear release over the auction duration
// Each step is 8 bytes: uint24(mps) in high 3 bytes | uint40(blockDelta) in low 5 bytes
// mps is millipercent-per-block; sum(mps_i * blockDelta_i) must equal exactly 10,000,000
function buildAuctionSteps(durationBlocks: number): `0x${string}` {
  const TOTAL_MPS = BigInt(10_000_000)
  const blocks = BigInt(durationBlocks)
  const mpsPerBlock = TOTAL_MPS / blocks

  // Check if it divides evenly — single step is enough
  if (mpsPerBlock * blocks === TOTAL_MPS) {
    const step = (mpsPerBlock << BigInt(40)) | blocks
    return `0x${step.toString(16).padStart(16, "0")}`
  }

  // Not evenly divisible: use two steps so the total is exact
  // Step 1: mpsPerBlock for (blocks - 1) blocks
  // Step 2: remainder for 1 block
  const mainBlocks = blocks - BigInt(1)
  const lastMps = TOTAL_MPS - mpsPerBlock * mainBlocks

  const step1 = (mpsPerBlock << BigInt(40)) | mainBlocks
  const step2 = (lastMps << BigInt(40)) | BigInt(1)

  const hex1 = step1.toString(16).padStart(16, "0")
  const hex2 = step2.toString(16).padStart(16, "0")
  return `0x${hex1}${hex2}`
}

function isValidAddress(addr: string): addr is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

function extractAuctionAddress(receipt: { logs: readonly { data: `0x${string}`; topics: readonly `0x${string}`[] }[] } | undefined): Address | null {
  if (!receipt) return null
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: FACTORY_EVENT_ABI,
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      })
      if (decoded.eventName === "AuctionCreated" && decoded.args.auction) {
        return decoded.args.auction as Address
      }
    } catch {
      // not our event
    }
  }
  return null
}

type Step = "form" | "funding" | "activating" | "blindpool" | "done"

export function CreateAuctionForm() {
  const router = useRouter()
  const { address, isConnected } = useAccount()
  const { data: currentBlock } = useBlockNumber({ chainId, watch: true })

  // User-initiated flag: skipped the minting step
  const [fundingSkipped, setFundingSkipped] = useState(false)

  // Offchain metadata
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  // Onchain params
  const [tokenAddress, setTokenAddress] = useState(MOCK_TOKEN as string)
  const [totalSupply, setTotalSupply] = useState("")
  const [reservePrice, setReservePrice] = useState("")
  const [duration, setDuration] = useState<string>("5m")
  const [tokensRecipient, setTokensRecipient] = useState("")
  const [fundsRecipient, setFundsRecipient] = useState("")

  const [error, setError] = useState<string | null>(null)

  // Step 1: initializeDistribution
  const {
    data: createTxHash,
    writeContract: writeCreate,
    isPending: isCreating,
    reset: resetCreate,
    error: createWriteError,
  } = useWriteContract()

  const { isLoading: isCreateConfirming, data: createReceipt, error: createReceiptError } =
    useWaitForTransactionReceipt({ hash: createTxHash })

  // Step 2: mint tokens to auction
  const {
    data: mintTxHash,
    writeContract: writeMint,
    isPending: isMinting,
    reset: resetMint,
    error: mintWriteError,
  } = useWriteContract()

  const { isLoading: isMintConfirming, isSuccess: isMintSuccess, error: mintReceiptError } =
    useWaitForTransactionReceipt({ hash: mintTxHash })

  // Step 3: onTokensReceived
  const {
    data: activateTxHash,
    writeContract: writeActivate,
    isPending: isActivating,
    reset: resetActivate,
    error: activateWriteError,
  } = useWriteContract()

  const { isLoading: isActivateConfirming, isSuccess: isActivateSuccess, error: activateReceiptError } =
    useWaitForTransactionReceipt({ hash: activateTxHash })

  // Step 4: Deploy BlindPool
  const {
    data: blindPoolTxHash,
    writeContract: writeDeployBlindPool,
    isPending: isDeployingBlindPool,
    reset: resetBlindPool,
    error: blindPoolWriteError,
  } = useWriteContract()

  const { isLoading: isBlindPoolConfirming, isSuccess: isBlindPoolSuccess, data: blindPoolReceipt, error: blindPoolReceiptError } =
    useWaitForTransactionReceipt({ hash: blindPoolTxHash })

  // Extract BlindPool address from deploy receipt
  const blindPoolAddress = useMemo(() => {
    if (!blindPoolReceipt) return null
    for (const log of blindPoolReceipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: BLIND_POOL_FACTORY_ABI,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        })
        if (decoded.eventName === "BlindPoolDeployed" && decoded.args.blindPool) {
          return decoded.args.blindPool as Address
        }
      } catch {
        // not our event
      }
    }
    return null
  }, [blindPoolReceipt])

  // Combine all hook errors into a single displayable error
  const hookError = createWriteError || createReceiptError || mintWriteError || mintReceiptError || activateWriteError || activateReceiptError || blindPoolWriteError || blindPoolReceiptError

  // Derive auction address from receipt (no setState needed)
  const auctionAddress = useMemo(() => extractAuctionAddress(createReceipt), [createReceipt])

  // Derive current step from state
  const step: Step = useMemo(() => {
    if (!auctionAddress) return "form"
    if (isBlindPoolSuccess) return "done"
    if (isActivateSuccess) return "blindpool"
    if (isMintSuccess || fundingSkipped) return "activating"
    return "funding"
  }, [auctionAddress, isBlindPoolSuccess, isActivateSuccess, isMintSuccess, fundingSkipped])

  const isSubmitting = isCreating || (isCreateConfirming && !hookError)

  function handleCreateAuction(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (hookError) resetCreate()

    if (!isConnected || !address) {
      setError("Connect your wallet first.")
      return
    }
    if (!currentBlock) {
      setError("Waiting for current block number.")
      return
    }
    if (!name.trim()) {
      setError("Name is required.")
      return
    }
    if (!isValidAddress(tokenAddress)) {
      setError("Token address must be a valid Ethereum address.")
      return
    }
    const supply = parseFloat(totalSupply)
    if (!Number.isFinite(supply) || supply <= 0) {
      setError("Total supply must be a positive number.")
      return
    }
    const reserve = parseFloat(reservePrice)
    if (!Number.isFinite(reserve) || reserve <= 0) {
      setError("Reserve price (floor) must be a positive number.")
      return
    }
    const tokensRecip = (tokensRecipient.trim() || address) as Address
    const fundsRecip = (fundsRecipient.trim() || address) as Address
    if (!isValidAddress(tokensRecip)) {
      setError("Tokens recipient must be a valid address.")
      return
    }
    if (!isValidAddress(fundsRecip)) {
      setError("Funds recipient must be a valid address.")
      return
    }

    const durationOpt = DURATION_OPTIONS.find((o) => o.value === duration)!
    const startBlock = currentBlock + BigInt(5)
    const endBlock = startBlock + BigInt(durationOpt.blocks)
    const claimBlock = endBlock

    const floorPrice = ethToQ96(reservePrice)
    const tickSpacing = floorPrice

    const auctionStepsData = buildAuctionSteps(durationOpt.blocks)

    const configData = encodeAbiParameters(
      parseAbiParameters(
        "address currency, address tokensRecipient, address fundsRecipient, uint64 startBlock, uint64 endBlock, uint64 claimBlock, uint256 tickSpacing, address validationHook, uint256 floorPrice, uint128 requiredCurrencyRaised, bytes auctionStepsData"
      ),
      [
        "0x0000000000000000000000000000000000000000",
        tokensRecip,
        fundsRecip,
        startBlock,
        endBlock,
        claimBlock,
        tickSpacing,
        "0x0000000000000000000000000000000000000000",
        floorPrice,
        BigInt(0),
        auctionStepsData,
      ]
    )

    const amount = parseEther(totalSupply)

    const saltBytes = new Uint8Array(32)
    crypto.getRandomValues(saltBytes)
    const salt = `0x${Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`

    writeCreate({
      address: CCA_FACTORY,
      abi: FACTORY_ABI,
      functionName: "initializeDistribution",
      args: [tokenAddress as Address, amount, configData, salt],
    })
  }

  function handleMintTokens() {
    if (!auctionAddress) return
    setError(null)
    const amount = parseEther(totalSupply)

    writeMint({
      address: tokenAddress as Address,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [auctionAddress, amount],
    })
  }

  function handleActivateAuction() {
    if (!auctionAddress) return
    setError(null)

    writeActivate({
      address: auctionAddress,
      abi: AUCTION_ABI,
      functionName: "onTokensReceived",
      args: [],
    })
  }

  function handleDeployBlindPool() {
    if (!auctionAddress || !BLIND_POOL_FACTORY_ADDRESS) return
    setError(null)
    writeDeployBlindPool({
      address: BLIND_POOL_FACTORY_ADDRESS,
      abi: BLIND_POOL_FACTORY_ABI,
      functionName: "deployBlindPool",
      args: [auctionAddress],
    })
  }

  function handleReset() {
    setFundingSkipped(false)
    setError(null)
    resetCreate()
    resetMint()
    resetActivate()
    resetBlindPool()
  }

  // Step indicators
  const stepLabels = [
    { key: "form", label: "1. Create" },
    { key: "funding", label: "2. Fund" },
    { key: "activating", label: "3. Activate" },
    { key: "blindpool", label: "4. Encrypt" },
    { key: "done", label: "5. Done" },
  ] as const

  const stepIndex = stepLabels.findIndex((s) => s.key === step)

  return (
    <div className="max-w-xl space-y-6">
      {/* Step progress */}
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
        {stepLabels.map((s, i) => (
          <span
            key={s.key}
            className={cn(
              "px-2 py-1 border transition-colors",
              i === stepIndex
                ? "border-accent text-accent"
                : i < stepIndex
                  ? "border-accent/30 text-accent/60"
                  : "border-border/40 text-muted-foreground/40",
            )}
          >
            {s.label}
          </span>
        ))}
      </div>

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

      {/* STEP 1: Create auction form */}
      {step === "form" && (
        <form onSubmit={handleCreateAuction} className="space-y-6">
          {currentBlock && (
            <p className="font-mono text-[10px] text-muted-foreground/60">
              Current {networkName} block: {currentBlock.toString()}
            </p>
          )}

          <div>
            <label htmlFor="name" className={labelClass}>
              Name <span className="text-muted-foreground/50">(offchain)</span>
            </label>
            <input
              id="name"
              type="text"
              placeholder="e.g. My Token Launch"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              disabled={isSubmitting}
              required
            />
          </div>

          <div>
            <label htmlFor="description" className={labelClass}>
              Description <span className="text-muted-foreground/50">(offchain)</span>
            </label>
            <textarea
              id="description"
              placeholder="Describe the auction and token..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={cn(inputClass, "resize-y min-h-20")}
              disabled={isSubmitting}
            />
          </div>

          <div className="border-t border-border/40 pt-6">
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent mb-4">
              Onchain parameters ({networkName})
            </p>

            <div className="space-y-5">
              <div>
                <label htmlFor="tokenAddress" className={labelClass}>
                  Token address
                </label>
                <input
                  id="tokenAddress"
                  type="text"
                  placeholder="0x..."
                  value={tokenAddress}
                  onChange={(e) => setTokenAddress(e.target.value)}
                  className={inputClass}
                  disabled={isSubmitting}
                  required
                />
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                  ERC20 token you deployed on {networkName}
                </p>
              </div>

              <div>
                <label htmlFor="totalSupply" className={labelClass}>
                  Total supply (tokens to sell)
                </label>
                <input
                  id="totalSupply"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 1000000"
                  value={totalSupply}
                  onChange={(e) => setTotalSupply(e.target.value)}
                  className={inputClass}
                  disabled={isSubmitting}
                  required
                />
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                  Amount of tokens (in token units, e.g. 18 decimals)
                </p>
              </div>

              <div>
                <label htmlFor="reservePrice" className={labelClass}>
                  Floor price (ETH per token)
                </label>
                <input
                  id="reservePrice"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.001"
                  value={reservePrice}
                  onChange={(e) => setReservePrice(e.target.value)}
                  className={inputClass}
                  disabled={isSubmitting}
                  required
                />
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                  Minimum price per token (encoded as Q96 onchain)
                </p>
              </div>

              <div>
                <label htmlFor="duration" className={labelClass}>
                  Duration
                </label>
                <select
                  id="duration"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className={cn(
                    inputClass,
                    "cursor-pointer appearance-none bg-input/50 pr-10",
                    "bg-size-[12px] bg-position-[right_12px_center] bg-no-repeat",
                  )}
                  style={{
                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='%23555' stroke-width='1.5' stroke-linecap='round'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                  }}
                  disabled={isSubmitting}
                >
                  {DURATION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} (~{opt.blocks} blocks)
                    </option>
                  ))}
                </select>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                  Converted to startBlock / endBlock (~12s per block)
                </p>
              </div>

              <div>
                <label htmlFor="tokensRecipient" className={labelClass}>
                  Tokens recipient <span className="text-muted-foreground/50">(optional)</span>
                </label>
                <input
                  id="tokensRecipient"
                  type="text"
                  placeholder={address || "0x... (defaults to your wallet)"}
                  value={tokensRecipient}
                  onChange={(e) => setTokensRecipient(e.target.value)}
                  className={inputClass}
                  disabled={isSubmitting}
                />
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                  Receives leftover tokens. Defaults to connected wallet.
                </p>
              </div>

              <div>
                <label htmlFor="fundsRecipient" className={labelClass}>
                  Funds recipient <span className="text-muted-foreground/50">(optional)</span>
                </label>
                <input
                  id="fundsRecipient"
                  type="text"
                  placeholder={address || "0x... (defaults to your wallet)"}
                  value={fundsRecipient}
                  onChange={(e) => setFundsRecipient(e.target.value)}
                  className={inputClass}
                  disabled={isSubmitting}
                />
                <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                  Receives raised ETH. Defaults to connected wallet.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6 pt-4">
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !isConnected || !currentBlock}
              aria-busy={isCreating || isCreateConfirming}
              className={cn(
                "border border-foreground/20 px-6 py-3 font-mono text-xs uppercase tracking-widest",
                "hover:border-accent hover:text-accent transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none",
              )}
            >
              {!currentBlock
                ? "Loading block..."
                : isCreating
                  ? "Confirm in wallet..."
                  : isCreateConfirming && !hookError
                    ? "Confirming..."
                    : hookError
                      ? "Try again"
                      : "Create auction"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/auctions")}
              className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>

          <div className="mt-8 font-mono text-[10px] text-muted-foreground/70 border border-border/40 px-3 py-2 space-y-1">
            <p>
              <strong>Factory:</strong>{" "}
              <code className="text-accent/80">{CCA_FACTORY}</code> ({networkName})
            </p>
            <p>
              Calls <code>initializeDistribution(token, amount, configData, salt)</code> on the CCA Factory.
            </p>
          </div>
        </form>
      )}

      {/* STEP 2: Fund auction — mint tokens to auction address */}
      {step === "funding" && auctionAddress && (
        <div className="space-y-6">
          <div className="border border-accent/50 bg-accent/10 px-4 py-3 font-mono text-sm text-accent">
            Auction created! Tx: {createTxHash?.slice(0, 10)}...
          </div>

          <div className="space-y-3">
            <p className="font-mono text-sm text-foreground">
              Step 2: Mint <strong>{totalSupply}</strong> tokens to the auction contract.
            </p>
            <p className="font-mono text-[10px] text-muted-foreground break-all">
              Auction address: <code className="text-accent/80">{auctionAddress}</code>
            </p>
            <p className="font-mono text-[10px] text-muted-foreground break-all">
              Token: <code className="text-accent/80">{tokenAddress}</code>
            </p>
            <p className="font-mono text-[10px] text-muted-foreground/60">
              This calls <code>token.mint(auctionAddress, amount)</code>. Your token contract must have a public
              mint function. If your token uses transfer instead, send the tokens manually and proceed to step 3.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleMintTokens}
              disabled={isMinting || isMintConfirming}
              className={cn(
                "border border-foreground/20 px-6 py-3 font-mono text-xs uppercase tracking-widest",
                "hover:border-accent hover:text-accent transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none",
              )}
            >
              {isMinting
                ? "Confirm in wallet..."
                : isMintConfirming
                  ? "Confirming..."
                  : "Mint tokens to auction"}
            </button>
            <button
              type="button"
              onClick={() => setFundingSkipped(true)}
              className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip (already funded)
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Activate auction — call onTokensReceived */}
      {step === "activating" && auctionAddress && (
        <div className="space-y-6">
          <div className="border border-accent/50 bg-accent/10 px-4 py-3 font-mono text-sm text-accent">
            {isMintSuccess ? "Tokens minted!" : "Skipped minting."} Now auction getting activated.
          </div>

          <div className="space-y-3">
            <p className="font-mono text-sm text-foreground">
              Step 3: Call <code>onTokensReceived()</code> on the auction contract so it can start accepting bids.
            </p>
            <p className="font-mono text-[10px] text-muted-foreground break-all">
              Auction: <code className="text-accent/80">{auctionAddress}</code>
            </p>
          </div>

          <button
            type="button"
            onClick={handleActivateAuction}
            disabled={isActivating || isActivateConfirming}
            className={cn(
              "border border-foreground/20 px-6 py-3 font-mono text-xs uppercase tracking-widest",
              "hover:border-accent hover:text-accent transition-all duration-200 disabled:opacity-50 disabled:pointer-events-none",
            )}
          >
            {isActivating
              ? "Confirm in wallet..."
              : isActivateConfirming
                ? "Confirming..."
                : "Activate auction"}
          </button>
        </div>
      )}

      {/* STEP 4: Deploy BlindPool for encrypted bidding */}
      {step === "blindpool" && auctionAddress && (
        <div className="space-y-6">
          <div className="border border-accent/50 bg-accent/10 px-4 py-3 font-mono text-sm text-accent">
            Auction activated! Now deploying encrypted bidding.
          </div>

          <div className="space-y-3">
            <p className="font-mono text-sm text-foreground">
              Step 4: Deploy a BlindPool to enable Zama fhEVM encrypted bidding.
            </p>
            <p className="font-mono text-[10px] text-muted-foreground break-all">
              Auction: <code className="text-accent/80">{auctionAddress}</code>
            </p>
            <p className="font-mono text-[10px] text-muted-foreground/60">
              This calls <code>BlindPoolFactory.deployBlindPool(auction)</code>. All bids will be encrypted on-chain until the reveal phase.
            </p>
          </div>

          <button
            type="button"
            onClick={handleDeployBlindPool}
            disabled={isDeployingBlindPool || isBlindPoolConfirming}
            className={cn(
              "border border-purple-500/40 px-6 py-3 font-mono text-xs uppercase tracking-widest text-purple-400",
              "hover:bg-purple-500/10 transition-colors disabled:opacity-50 disabled:pointer-events-none",
            )}
          >
            {isDeployingBlindPool
              ? "Confirm in wallet..."
              : isBlindPoolConfirming
                ? "Deploying BlindPool..."
                : "Deploy BlindPool"}
          </button>
        </div>
      )}

      {/* STEP 5: Done */}
      {step === "done" && auctionAddress && (
        <div className="space-y-6">
          <div className="border border-accent/50 bg-accent/10 px-4 py-3 font-mono text-sm text-accent space-y-2">
            <p>Auction is live with encrypted bidding!</p>
            <p className="text-[10px] text-muted-foreground break-all">
              Auction: <code className="text-accent/80">{auctionAddress}</code>
            </p>
            {blindPoolAddress && (
              <p className="text-[10px] text-purple-400 break-all">
                BlindPool: <code>{blindPoolAddress}</code>
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => router.push(`/auctions/${auctionAddress}`)}
              className={cn(
                "border border-accent/40 px-6 py-3 font-mono text-xs uppercase tracking-widest",
                "hover:bg-accent/20 transition-colors",
              )}
            >
              View auction
            </button>
            <button
              type="button"
              onClick={() => router.push("/auctions")}
              className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              All auctions
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Create another
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
