## BlindPool Privacy Migration – Execution Log

This file tracks concrete steps taken to implement the plan in `plan.md`, plus next actions.

### 1. Documentation cleanup

**Goal:** Remove Zama fhEVM–specific references and reposition BlindPool as using Chainlink Confidential Compute + CRE Confidential HTTP.

- [x] Update `BlindPool-scripts/README.md` intro
  - Switched description from “using Zama fhEVM” to “uses Chainlink Confidential Compute and CRE Confidential HTTP to orchestrate private, compliant auction flows offchain”.
- [x] Update privacy mechanism description
  - Rephrased sealed‑bid description so bid privacy comes from offchain CRE workflows, not onchain FHE.
- [x] Remove fhEVM contract addresses
  - Deleted the “Zama fhEVM (Sepolia coprocessor)” table and related addresses.
- [x] Simplify build steps
  - Removed `lib/fhevm` submodule instructions and encrypted‑types / FHEVMHostAddresses notes.
  - Build is now a plain `forge build`.
- [x] Remove Zama relayer frontend section
  - Deleted the `@zama-fhe/relayer-sdk` example and replaced it with a “Frontend / CRE Integration (planned)” section that references EIP‑712 + Confidential HTTP into CRE.
- [x] Update resources
  - Dropped Zama links and added links to Chainlink Confidential Compute / CRE docs and the Compliant Private Transfer demo.
- [x] Scan remaining docs (including the main `BlindPool` README) for any leftover fhEVM / Zama mentions and update them to CRE terminology.

### 2. Contract surface review (planned)

**Goal:** Identify the minimum changes needed so a CRE workflow can drive auctions while preserving CCA invariants.

Planned tasks:

- [x] List core BlindPool contracts:
  - `BlindPoolCCA` – wrapper around a Uniswap CCA auction that currently handles encrypted blind bids and forwards them to the CCA.
  - `BlindPoolFactory` – factory that deploys a `BlindPoolCCA` for a given CCA auction and sets a blind-bid deadline based on `endBlock()`.
– [x] For `BlindPoolCCA`:
  - `submitBlindBid(bytes32 bidCommitment)`:
    - Onchain public: bidder address, ETH deposit, opaque commitment hash.
    - Offchain (CRE): full bid details (maxPrice, amount, flags, compliance state).
  - `forwardBidToCCA(...)` / `forwardBidsToCCA(...)`:
    - Onchain public: final maxPrice, amount, and owner actually sent to CCA.
    - Offchain (CRE): proof that these values match the sealed bid + any compliance checks.
- [ ] Repeat the same analysis for any additional BlindPool contracts we introduce (e.g., vault/treasury wrappers, CRE-specific hooks).
- [ ] For each entrypoint, mark:
  - What data must remain public onchain.
  - What can be moved offchain into CRE (sealed bids, compliance state, etc.).
- [ ] Propose minimal new hooks, for example:
  - `finalizeFromCRE(auctionId, clearingPrice, totalRaised, proofOrMetadata)`
  - `linkOffchainBid(auctionId, offchainBidId, onchainDepositId)` if needed.
- [ ] Capture decisions back into `plan.md` and update this execution log.

### 3. CRE workflow design (planned)

**Goal:** Turn the high‑level workflows from `plan.md` into concrete CRE workflow specs we can implement and test.

Planned tasks:

- [x] Draft a **Bid Ingestion Workflow** spec:
  - Endpoint (via Confidential HTTP): `POST /cre/bid`.
  - Input: signed EIP‑712 bid (mirroring `Compliant-Private-Transfer-Demo/api-scripts/src/private-transfer.ts`), including:
    - `sender`, `auctionId`, `maxPrice`, `amount`, `flags[]`, `timestamp`, and signature.
  - Steps:
    - Verify EIP‑712 signature and timestamp.
    - Call external KYC / compliance API (kept private in CRE) using Confidential HTTP.
    - If approved, compute `bidCommitment = keccak256(abi.encodePacked(auctionId, sender, maxPrice, amount, flags, timestamp))`.
    - Store full bid details + commitment in CRE’s private store / DB.
    - Trigger onchain call to `BlindPoolCCA.submitBlindBid(bidCommitment)` from a CRE‑controlled signer, sending the escrow amount as `msg.value`.
- [x] Draft an **Auction Finalization Workflow** spec:
  - Endpoint: `POST /cre/finalize`.
  - Input: `auctionId`, close signal (block/time or manual).
  - Steps:
    - Fetch all bids for `auctionId` from the CRE store.
    - Run price discovery offchain to compute clearing price and per‑bid allocations.
    - For each winning bid, choose `clearAmount` (<= escrow) and `clearMaxPrice`.
    - Batch onchain calls to `BlindPoolCCA.forwardBidsToCCA(...)` with:
      - arrays of `blindBidIds`, `clearMaxPrices`, `clearAmounts`, `owners`, `hookData`.
    - Optionally write final aggregates (clearing price, total raised) into a separate onchain “lens” or emit an event via CRE for the frontend.
- [x] Draft a **Settlement / Payout Workflow** spec:
  - Endpoint: `POST /cre/settle`.
  - Input: finalized allocations and/or an auction completion event.
  - Steps:
    - For issuer / treasury flows, reuse the compliant‑private‑transfer demo pattern:
      - Construct and sign EIP‑712 messages representing private transfers from a policy‑controlled vault.
      - Call a private transfer API that, in turn, executes onchain transfers under policy control.
    - For user claims that should remain manual, let users call CCA `claimTokens` directly; for automated payouts, have CRE trigger the appropriate CCA / vault functions.
- [x] Ensure each workflow meets the hackathon requirement:
  - Integrates at least one blockchain (Sepolia CCA / BlindPool contracts) + one external API (KYC / compliance, or treasury / payout service).
  - Can be simulated via CRE CLI (workflow simulations) and/or deployed to the CRE network, with Confidential HTTP used for any external calls.

### 4. Frontend + API integration (planned)

**Goal:** Replace fhEVM client code with EIP‑712 + Confidential HTTP into CRE workflows.

Planned tasks:

- [ ] Identify any existing frontend code that assumed fhEVM or Zama relayer flows.
- [ ] Design a minimal bid‑signing interface:
  - EIP‑712 domain + types for a BlindPool bid (`sender`, `auctionId`, `maxPrice`, `amount`, `flags`, `timestamp`).
  - Alignment with what the CRE Bid Ingestion Workflow expects.
- [ ] Define API endpoints / Confidential HTTP routes:
  - e.g., `/cre/bid`, `/cre/finalize`, `/cre/settle`.
- [ ] Implement a small backend / gateway (if needed) that:
  - Receives public HTTP requests from the app.
  - Invokes the underlying CRE workflows securely.

### 5. Hardening and testing (planned)

**Goal:** Prove that the CRE‑driven BlindPool flow is correct, robust, and matches CCA semantics.

Planned tasks:

- [x] Define solidity test scenarios:
  - Auction lifecycle:
    - Deploy CCA + `BlindPoolCCA` + `BlindPoolFactory`.
    - Simulate bids by calling `submitBlindBid` with mock commitments and ETH.
    - From an `admin` test account (standing in for CRE), call `forwardBidToCCA` / `forwardBidsToCCA` with chosen clear prices/amounts.
  - Edge cases:
    - Bids after `blindBidDeadline` revert with `AuctionClosed`.
    - `forwardBidToCCA` by non‑admin reverts with `OnlyAdmin`.
    - Re‑forwarding an already forwarded bid reverts with `AlreadyForwarded`.
    - Over‑sized `clearAmount` is capped by `ethDeposit` and refunds excess.
- [x] Sketch CRE workflow tests:
  - Use CRE CLI to simulate:
    - A successful `Bid Ingestion Workflow` run from signed EIP‑712 message → stored bid → onchain `submitBlindBid`.
    - A rejected bid path where compliance API fails and no onchain transaction is sent.
    - A full `finalize` + `settle` run that computes a clearing price and calls `forwardBidsToCCA`, then verifies results by querying CCA state.
- [ ] Implement the actual Foundry tests (`forge test`) and wire them to the new `BlindPoolCCA` interface.
- [ ] Capture the exact `forge` commands and expected outputs here once tests are written and passing.

---

This file will be updated as each step is implemented so it stays in sync with the higher‑level design in `plan.md`.

