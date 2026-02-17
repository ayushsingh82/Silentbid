import { sepolia, type Chain } from "viem/chains"
import { http } from "wagmi"

export const IS_ANVIL = process.env.NEXT_PUBLIC_NETWORK === "anvil"

const anvilChain: Chain = {
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
}

export const activeChain = IS_ANVIL ? anvilChain : sepolia

export const chainId = activeChain.id

export const activeTransport = IS_ANVIL
  ? http("http://127.0.0.1:8545")
  : http("https://1rpc.io/sepolia")

export const blockExplorerUrl = IS_ANVIL ? null : "https://sepolia.etherscan.io"

export const networkName = IS_ANVIL ? "Anvil" : "Sepolia"
