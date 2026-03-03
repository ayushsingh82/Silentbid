# SilentBid

**Privacy-focused fork of Uniswap's Continuous Clearing Auction (CCA) with sealed-bid configuration.**

Demo video - https://youtu.be/dnrUvJf2Mg4

Pitch - https://blind-pool.vercel.app/ppt

Contract Scripts Repo - https://github.com/ayushsingh82/BlindPool-scripts (SilentBid contracts)

## TODO

**Chainlink Hackathon - Privacy Track ($6,000)**

Participating in the Chainlink hackathon. This project integrates **Chainlink Confidential Compute** (early access) for private transactions and/or **CRE's Confidential HTTP** capability to build privacy-preserving workflows, where API credentials, selected request and response data, and value flows are protected, and sensitive application logic executes offchain.

This track focuses on applications that require secure API connectivity and/or compliant non-public token movement, enabling decentralized workflows without exposing secrets, sensitive inputs or outputs, or internal transaction flows onchain.

*Note: Confidential HTTP and Chainlink Confidential Compute (early access) will be available from Feb 16th.*

### Example use cases and design patterns

- **Sealed-bid auctions & private payments:** Bidders submit payments via compliant private transactions; auction logic runs offchain to determine winners; settlement and refunds occur privately.
- **Private treasury and fund operations:** Move funds internally without exposing detailed transaction flows, while retaining the ability to withdraw to public token contracts.
- **Private governance payouts & incentives:** Governance or scoring logic runs offchain; rewards, grants, or incentives are distributed via compliant private transactions; individual recipients and amounts are not publicly visible.
- **Private rewards & revenue distribution:** Offchain computation determines allocations; payments executed via private transactions; supports rebates, revenue shares, bounties, and incentives.
- **OTC and brokered settlements:** Settle negotiated trades privately between counterparties, with execution coordinated offchain.
- **Secure Web2 API integration for decentralized workflows:** Use external APIs in CRE without exposing API keys or sensitive request & response parameters onchain.
- **Protected request–driven automation:** Trigger offchain or onchain workflows based on API data while keeping credentials and selected request inputs confidential.
- **Safe access to regulated or high-risk APIs:** Interact with APIs where leaked credentials or request parameters could cause financial, security, or compliance risk.
- **Credential-secure data ingestion and processing:** Fetch and process external data offchain using CRE while preventing secrets from being exposed to the blockchain or logs.
- **Controlled offchain data handling with auditability:** Execute API requests offchain with reliable execution guarantees and traceable usage, without writing sensitive inputs onchain.

### Requirements

Build, simulate, or deploy a **CRE Workflow** that's used as an orchestration layer within your project. Your workflow should:

- Integrate at least one blockchain with an external API, system, data source, LLM, or AI agent
- Demonstrate a successful simulation (via the CRE CLI) or a live deployment on the CRE network

## What It Is

[Uniswap's Continuous Clearing Auction (CCA)](https://docs.uniswap.org/) is a mechanism for **fair, continuous price discovery** and **liquidity bootstrapping** for a new token — all onchain and permissionless. Bids are automatically integrated over time to determine a market-clearing price and seed liquidity into a Uniswap pool when the auction ends.

**SilentBid** extends CCA by adding **sealed-bid / confidentiality features**: participants submit bids **privately**, so no one else (including bots or MEV actors) can see bid prices or identities before the auction closes. It resembles sealed-bid auctions in traditional finance, but built for onchain DeFi. Research in confidentiality on blockchains points toward **confidential compute** or **zero-knowledge (ZK)** techniques for this kind of privacy.

## Why It Matters

- **Reduces pre-bid sniping and front-running** — Bids stay hidden until the auction closes.
- **Prevents leakage of strategic bid information** that can be exploited by MEV bots.
- **Brings a more equitable token launch experience** — Fairer access for all participants.

## Risks & Challenges

- **Cryptographic privacy** — Must integrate ZK proofs and/or confidential compute.
- **Onchain enforceability and fairness** — Confidentiality must be verifiable and enforceable onchain.

---

## Workflow

SilentBid follows the same high-level flow as [Uniswap CCA](https://docs.uniswap.org/contracts/liquidity-launchpad/CCA) (prepare → deploy → bid → price discovery → settlement), but **sealed bids** keep participant data private until the auction closes.

### Workflow diagram

```mermaid
flowchart LR
  subgraph Public["PUBLIC (onchain / visible)"]
    A[Prepare token] --> B[Deploy auction]
    B --> C[Auction params & end time]
    C --> D[Clearing price after close]
    D --> E[Settlement & pool seed]
  end

  subgraph Private["PRIVATE until close (SilentBid)"]
    P1[Bidder identity]
    P2[Bid price / max price]
    P3[Bid amount / budget]
    P4[Individual bid details]
  end

  subgraph Flow["Flow"]
    B --> F[Place sealed bids]
    F --> G[Price discovery]
    G --> D
  end

  F -.-> Private
  G -.-> Private
```

**During auction:** Only sealed commitments (e.g. hashes or ZK proofs) are visible onchain. **Bid price**, **bid amount**, and **bidder identity** stay private so MEV and snipers cannot react.

**After close:** Clearing price, total commitment, and settlement become public; liquidity is seeded to Uniswap as in standard CCA.

### Contract reference: what to make private

Relative to the [CCA contract flow](https://docs.uniswap.org/contracts/liquidity-launchpad/CCA) and [technical docs](https://github.com/Uniswap/continuous-clearing-auction):

| CCA concept | Standard CCA | SilentBid (target) |
|-------------|--------------|--------------------|
| **Bidder identity** | Public (msg.sender / address) | **Private** until auction close |
| **Max price per bid** | Public (onchain bid param) | **Private** until close |
| **Budget / bid amount** | Public (onchain bid param) | **Private** until close |
| **Per-bid fill state** | Public (who got how many tokens) | **Private** until close; reveal at settlement |
| **Clearing price (per block / final)** | Public | Public **after** close (can remain hidden during auction) |
| **Total commitment** | Public | Public **after** close |
| **Auction params, end time, token** | Public | Public |
| **Settlement & pool creation** | Public | Public (after close) |

**Implementation direction:** Store only **commitments** (e.g. `commit(bidder, maxPrice, amount)`) or ZK proofs onchain during the auction; reveal or prove against them at settlement so that clearing price and allocations can be computed without leaking individual bids to the public mempool or chain state before close.

---

## Tech Stack

- **Next.js** — App framework
- **Tailwind CSS** — Styling
- **Uniswap CCA** — Base mechanism (forked and extended for privacy)
- **RainbowKit + Wagmi** — Wallet connection (Connect button on auctions)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the SilentBid app.

**WalletConnect (optional):** For production wallet connect, set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in `.env.local` with your [WalletConnect Cloud](https://cloud.walletconnect.com/) project ID. The app runs without it; RainbowKit may show a placeholder until set.

## Scripts & Testing

Scripts for deploying SilentBid, CCA auctions, and testing on Sepolia (Foundry):

- **[BlindPool-scripts](https://github.com/ayushsingh82/BlindPool-scripts)** — Deploy CCA, deploy SilentBid (SilentBidCCA/SilentBidFactory), submit bids, check status, CRE finalize. See the repo README for setup and usage.

## Learn More

- [Uniswap CCA Documentation](https://docs.uniswap.org/)
- [CCA Contract & Technical Reference](https://github.com/Uniswap/continuous-clearing-auction)
- [Next.js Documentation](https://nextjs.org/docs)

---

© 2025 SilentBid. Privacy-first CCA. Sealed-bid token launches.
