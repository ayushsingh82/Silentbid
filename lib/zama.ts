import { type Address, toHex } from "viem"

// Lazy-loaded singleton — avoids WASM init on every page
let instancePromise: Promise<any> | null = null

export async function getZamaInstance() {
  if (!instancePromise) {
    instancePromise = (async () => {
      console.log("[Zama] Importing relayer-sdk/web...")
      const { createInstance, SepoliaConfig, initSDK } = await import("@zama-fhe/relayer-sdk/web")
      console.log("[Zama] Initializing WASM (initSDK)...")
      await initSDK()
      console.log("[Zama] WASM ready, creating instance...")
      const instance = await createInstance({ ...SepoliaConfig, network: "https://1rpc.io/sepolia" })
      console.log("[Zama] Instance created successfully")
      return instance
    })()
  }
  return instancePromise
}

/**
 * Encrypt maxPrice and amount for BlindPoolCCA.submitBlindBid().
 * Returns { handles: [bytes32, bytes32], inputProof: bytes } ready for the contract call.
 */
export async function encryptBidInputs(
  blindPoolAddress: Address,
  userAddress: Address,
  maxPrice: bigint,
  amount: bigint,
): Promise<{ handles: `0x${string}`[]; inputProof: `0x${string}` }> {
  console.log("[Zama] encryptBidInputs:", { blindPoolAddress, userAddress, maxPrice: maxPrice.toString(), amount: amount.toString() })
  const instance = await getZamaInstance()
  console.log("[Zama] Creating encrypted input...")
  const input = instance.createEncryptedInput(blindPoolAddress, userAddress)
  input.add64(maxPrice)
  input.add64(amount)
  console.log("[Zama] Encrypting + getting ZK proof from relayer...")
  const encrypted = await input.encrypt()
  console.log("[Zama] Encrypted result keys:", Object.keys(encrypted))
  console.log("[Zama] handles type:", typeof encrypted.handles?.[0], "inputProof type:", typeof encrypted.inputProof)
  // encrypt() returns { handles, inputProof } — may be Uint8Array or hex string depending on SDK version
  const handles = encrypted.handles.map((h: Uint8Array | string) =>
    typeof h === "string" ? h as `0x${string}` : toHex(h)
  )
  const inputProof = typeof encrypted.inputProof === "string"
    ? encrypted.inputProof as `0x${string}`
    : toHex(encrypted.inputProof)
  console.log("[Zama] handles[0]:", handles[0]?.slice(0, 20) + "...", "inputProof:", inputProof?.slice(0, 20) + "...")
  return { handles, inputProof }
}
