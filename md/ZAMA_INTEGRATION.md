# Zama integration in this app

What is integrated and what is not.

---

## Privacy and USDC (what to say)

**For Zama encrypted bidding to actually hide bid amounts, you need USDC (or another ERC20), not native ETH.**

- **Native ETH cannot be encrypted:** the bid amount is sent as `msg.value`, which is always visible in the transaction. Zama fhEVM encrypts values in *contract state*, not the value field of a tx.
- **So:** create the auction in **USDC** and bid in **USDC**. Then the amount is an ERC20 transfer (e.g. via Permit2) and can be tied to encrypted state; the CCA and our app support USDC create + USDC bidding on chains where the factory allows it.
- **On Sepolia** we only allow ETH (create + bid) because USDC creation reverts on that chain; encrypted bids there still use ETH, so the amount is visible on-chain. On mainnet (or other supported chains), use USDC for full confidentiality.

**One-liner for judges:** *“Private CCA uses USDC for both creating the auction and bidding so that bid amounts can be encrypted with Zama; native ETH cannot be encrypted.”*

---

## Integrated (in the app)

| Part | Where | What it does |
|------|--------|--------------|
| **Zama config** | `lib/zama.ts` | Sepolia relayer config, `getZamaInstance()`, `encryptBidInput(blindPool, user, maxPriceQ96, amountWei)` → `{ handlePrice, handleAmount, inputProof }`. |
| **Encrypt + submit sealed bid** | `app/auctions/[id]/place-bid-form.tsx` | When a BlindPool address is set (env or UI-deployed), the form encrypts amount and max price with Zama and calls `BlindPoolCCA.submitBlindBid(handlePrice, handleAmount, inputProof)` with `msg.value = amount`. |
| **BlindPool from UI** | `app/auctions/[id]/page.tsx` | If `NEXT_PUBLIC_BLIND_POOL_FACTORY_ADDRESS` is set, the auction page shows “Deploy BlindPool for this auction”. User connects wallet and clicks; one tx deploys a BlindPool for that CCA. That BlindPool is then used for sealed bids on that page. |
| **ABIs** | `lib/auction-contracts.ts` | `BLIND_POOL_ABI` (submitBlindBid), `BLIND_POOL_FACTORY_ABI` (deployBlindPool). |

**Flow in the app today:** Create auction → (optional) Deploy BlindPool for it (button or env) → Place sealed bid (encrypt in browser → submitBlindBid). No private key in terminal for placing bids or deploying BlindPool from the UI.

---

## Not in the app (post–deadline)

| Part | Where it lives | What’s missing in the UI |
|------|----------------|--------------------------|
| **requestReveal()** | Contract: `BlindPoolCCA.requestReveal()` | No “Request reveal” button. You can call it via `cca` scripts (`make reveal-blindpool BLIND_POOL_ADDRESS=0x...`) or add a button that calls it. |
| **Decrypt + forwardBidToCCA** | Off-chain: Zama relayer `publicDecrypt` → then `BlindPoolCCA.forwardBidToCCA(bidId, maxPrice, amount, proof)` | No in-app flow. Documented in `md/ZAMA_ENCRYPTED_BIDDING.md`; done via scripts or a backend that uses the relayer SDK. |

**Flow today for reveal:** After the blind-bid deadline, someone calls `requestReveal()` (script or future button). Then, for each blind bid, run the relayer’s `publicDecrypt` to get clear (maxPrice, amount) and proof, then call `forwardBidToCCA(bidId, maxPrice, amount, proof)` so the real CCA receives the bid.

---

## Summary

- **Zama is integrated** for **creating and submitting sealed bids**: encrypt (Zama relayer SDK) + `submitBlindBid` in the place-bid form when a BlindPool is set.
- **Reveal and forward** (requestReveal + decrypt + forwardBidToCCA) are **not** in the app; they are script/doc flow. See `md/ZAMA_ENCRYPTED_BIDDING.md` for the full flow and options (creator-only vs automatic).