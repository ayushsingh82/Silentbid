# Zama Encrypted Bidding — Smart Contract Reference

Privacy wrapper for Uniswap CCA using Zama fhEVM. Bids are encrypted on-chain during the auction and only revealed after the blind bid deadline passes.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         BlindPoolCCA.sol                            │
│  Stores encrypted bids (euint64 handles) + ETH escrow              │
│                                                                      │
│  Phase 1: submitBlindBid()   ← encrypted inputs from relayer SDK   │
│  Phase 2: requestReveal()    ← marks ciphertexts decryptable       │
│  Phase 3: forwardBidToCCA()  ← sends decrypted bids to real CCA   │
│                         │                                            │
│                         ▼                                            │
│              ┌─────────────────────┐                                 │
│              │  Uniswap CCA        │  ← receives plain bids         │
│              │  (settlement layer) │  ← exitBid / claimTokens       │
│              └─────────────────────┘                                 │
└──────────────────────────────────────────────────────────────────────┘

Zama fhEVM stack (Sepolia):
  ACL:            0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D
  FHEVMExecutor:  0x92C920834Ec8941d2C77D188936E1f7A6f49c127
  KMS Verifier:   0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A
  InputVerifier:  0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0

Uniswap CCA (Sepolia):
  CCA Factory:    0xcca1101C61cF5cb44C968947985300DF945C3565
```

---

## Contract: BlindPoolCCA.sol

**Source:** `scripts/src/BlindPoolCCA.sol` (303 lines)
**Solidity:** `^0.8.24`
**Inherits:** `ZamaEthereumConfig` (auto-configures Zama coprocessor addresses)
**Dependencies:** `@fhevm/solidity` (FHE.sol, EncryptedTypes.sol)

### State

```solidity
address public admin;                          // Deployer
ICCA public cca;                               // Real Uniswap CCA address
uint64 public blindBidDeadline;                // Block after which blind bids rejected
bool public revealed;                          // Whether requestReveal() has been called
uint256 public nextBlindBidId;                 // Counter (0-indexed)

mapping(uint256 => BlindBid) internal _blindBids;
mapping(uint256 => uint256) public ccaBidIds;  // blindBidId → real CCA bidId

// Encrypted aggregates (privacy-preserving stats)
euint64 internal _encHighestPrice;
euint64 internal _encTotalDemand;
```

### BlindBid Struct

```solidity
struct BlindBid {
    address bidder;          // PUBLIC — who placed the bid
    euint64 encMaxPrice;     // ENCRYPTED — max price (Q96 scaled to uint64)
    euint64 encAmount;       // ENCRYPTED — bid amount in wei
    uint256 ethDeposit;      // PUBLIC — actual ETH held in escrow
    bool forwarded;          // PUBLIC — whether forwarded to CCA
}
```

**Privacy guarantee:** During the auction, only `bidder`, `ethDeposit`, and `forwarded` are readable. The `encMaxPrice` and `encAmount` fields are opaque `euint64` handles — unreadable without Zama KMS decryption.

### Data Visibility

| Field | During Auction | After Reveal | After Forward |
|-------|---------------|-------------|---------------|
| bidder address | Public | Public | Public |
| ETH deposit | Public | Public | Public |
| maxPrice | Encrypted (euint64) | Decryptable via KMS | Public on CCA |
| amount | Encrypted (euint64) | Decryptable via KMS | Public on CCA |
| clearing price | N/A | N/A | Set by CCA |

---

## Phase 1: Blind Bidding

### `submitBlindBid()`

```solidity
function submitBlindBid(
    externalEuint64 _encMaxPrice,   // Encrypted max price from relayer SDK
    externalEuint64 _encAmount,     // Encrypted bid amount from relayer SDK
    bytes calldata _inputProof      // ZK proof of plaintext knowledge
) external payable
```

**Requirements:**
- `block.number < blindBidDeadline` — auction must be open
- `msg.value > 0` — must deposit ETH as escrow

**What happens:**
1. `FHE.fromExternal()` verifies the ZK proof and converts external ciphertext to internal `euint64` handles
2. Stores `BlindBid` with encrypted fields + plaintext ETH deposit
3. Updates encrypted aggregates:
   - `_encHighestPrice` = `FHE.select(FHE.lt(current, new), new, current)` — encrypted max
   - `_encTotalDemand` = `FHE.add(current, newAmount)` — encrypted sum
4. Sets FHE ACL permissions:
   - `FHE.allowThis()` — contract can operate on handles in future txs
   - `FHE.allow(handle, msg.sender)` — bidder can re-encrypt/view their own bid
5. Emits `BlindBidPlaced(bidId, bidder)`

**Frontend call:**

```typescript
// Encrypt bid client-side using Zama relayer SDK
const input = instance.createEncryptedInput(blindPoolAddress, userAddress);
input.add64(BigInt(maxPriceQ96));   // encrypted input 1
input.add64(BigInt(amountWei));     // encrypted input 2
const encrypted = await input.encrypt();

// Submit to BlindPoolCCA (NOT directly to CCA)
await writeContract({
  address: blindPoolAddress,
  abi: BlindPoolABI,
  functionName: 'submitBlindBid',
  args: [encrypted.handles[0], encrypted.handles[1], encrypted.inputProof],
  value: amountWei,  // ETH escrow
});
```

---

## Phase 2: Reveal

### `requestReveal()`

```solidity
function requestReveal() external
```

**Requirements:**
- `block.number >= blindBidDeadline` — deadline must have passed
- `!revealed` — can only call once

**What happens:**
1. Sets `revealed = true`
2. Loops through all blind bids and calls `FHE.makePubliclyDecryptable()` on each `encMaxPrice` and `encAmount`
3. Also reveals encrypted aggregates (`_encHighestPrice`, `_encTotalDemand`)
4. Emits `BidsRevealed(totalBids)`

**Who can call:** Anyone. No access control by default. If you want creator-only reveal, add `onlyAdmin` modifier.

**After this tx:** The Zama KMS will allow public decryption of all bid ciphertexts via the relayer SDK. The values are NOT automatically decrypted — an off-chain call to the relayer is needed.

---

## Phase 3: Forward to CCA

### `forwardBidToCCA()`

```solidity
function forwardBidToCCA(
    uint256 _blindBidId,
    uint64 _clearMaxPrice,      // Decrypted max price
    uint64 _clearAmount,        // Decrypted amount
    bytes calldata _decryptionProof  // KMS cryptographic proof
) external
```

**Requirements:**
- `revealed == true`
- Bid not already forwarded

**What happens:**
1. **Verifies KMS proof** — reconstructs the original ciphertext handles and calls:
   ```solidity
   bytes32[] memory handles = new bytes32[](2);
   handles[0] = FHE.toBytes32(bb.encMaxPrice);
   handles[1] = FHE.toBytes32(bb.encAmount);
   bytes memory encodedClear = abi.encode(_clearMaxPrice, _clearAmount);
   FHE.checkSignatures(handles, encodedClear, _decryptionProof);
   ```
   This cryptographically proves the decrypted values match the original ciphertexts.

2. **Calculates ETH to send** — `min(clearAmount, ethDeposit)`

3. **Forwards to real CCA:**
   ```solidity
   uint256 ccaBidId = cca.submitBid{value: toSend}(
       uint256(_clearMaxPrice),  // maxPrice (Q96)
       uint128(_clearAmount),    // amount
       bb.bidder,                // original bidder remains owner
       bytes("")                 // no hook data
   );
   ```

4. **Refunds excess ETH** — if `ethDeposit > clearAmount`, the difference is sent back to the bidder

5. Emits `BidForwarded(blindBidId, ccaBidId)` and optionally `EthRefunded(...)`

### `forwardBidsToCCA()` — Batch

```solidity
function forwardBidsToCCA(
    uint256[] calldata _blindBidIds,
    uint64[] calldata _clearMaxPrices,
    uint64[] calldata _clearAmounts,
    bytes[] calldata _decryptionProofs
) external
```

Calls `forwardBidToCCA` for each bid in a single tx. Arrays must all be the same length.

---

## View Functions

```solidity
// Public bid info (no encryption)
function getBlindBidInfo(uint256 _blindBidId)
    external view returns (address bidder, uint256 ethDeposit, bool forwarded);

// Encrypted handles (for re-encryption via relayer SDK)
function getEncMaxPrice(uint256 _blindBidId) external view returns (euint64);
function getEncAmount(uint256 _blindBidId) external view returns (euint64);

// Encrypted aggregates
function encHighestPrice() external view returns (euint64);
function encTotalDemand() external view returns (euint64);
```

---

## Events

```solidity
event BlindBidPlaced(uint256 indexed blindBidId, address indexed bidder);
event BidsRevealed(uint256 totalBids);
event BidForwarded(uint256 indexed blindBidId, uint256 indexed ccaBidId);
event EthRefunded(uint256 indexed blindBidId, address indexed bidder, uint256 amount);
```

---

## Errors

```solidity
error AuctionStillOpen();    // requestReveal() called before deadline
error AuctionClosed();       // submitBlindBid() called after deadline
error NotRevealed();         // forwardBidToCCA() called before reveal
error AlreadyRevealed();     // requestReveal() called twice
error AlreadyForwarded();    // forwardBidToCCA() called on same bid twice
error OnlyAdmin();           // reserved for access control extensions
error NoDeposit();           // submitBlindBid() called with msg.value == 0
```

---

## FHE Operations Used

| Operation | Where | Purpose |
|-----------|-------|---------|
| `FHE.fromExternal(handle, proof)` | submitBlindBid | Convert relayer SDK ciphertext to internal euint64 |
| `FHE.asEuint64(0)` | constructor | Initialize encrypted aggregates to zero |
| `FHE.lt(a, b)` | submitBlindBid | Encrypted comparison for highest price |
| `FHE.select(cond, a, b)` | submitBlindBid | Encrypted conditional assignment |
| `FHE.add(a, b)` | submitBlindBid | Encrypted sum for total demand |
| `FHE.allowThis(handle)` | submitBlindBid, constructor | Grant contract permission to use handle |
| `FHE.allow(handle, addr)` | submitBlindBid | Grant bidder permission to re-encrypt |
| `FHE.makePubliclyDecryptable(handle)` | requestReveal | Mark ciphertext for KMS decryption |
| `FHE.toBytes32(handle)` | forwardBidToCCA | Convert handle for proof verification |
| `FHE.checkSignatures(handles, clear, proof)` | forwardBidToCCA | Verify KMS decryption proof |
| `FHE.isInitialized(handle)` | tests | Check handle is valid (not null) |

---

## ICCA Interface

The minimal interface BlindPoolCCA uses to interact with the real Uniswap CCA:

```solidity
interface ICCA {
    function submitBid(uint256 maxPrice, uint128 amount, address owner, bytes calldata hookData)
        external payable returns (uint256 bidId);
    function exitBid(uint256 bidId) external;
    function claimTokens(uint256 bidId) external;
    function endBlock() external view returns (uint64);
    function startBlock() external view returns (uint64);
    function floorPrice() external view returns (uint256);
    function tickSpacing() external view returns (uint256);
    function clearingPrice() external view returns (uint256);
    function token() external view returns (address);
    function totalSupply() external view returns (uint128);
}
```

---

## Deployment

### 1. Deploy a CCA auction

**Script:** `scripts/script/DeployCCA.s.sol`

```bash
make deploy-cca
```

Deploys a mock ERC20 token + CCA auction via the Sepolia factory. Parameters:

```solidity
AuctionParameters({
    currency: address(0),                          // ETH
    tokensRecipient: deployer,
    fundsRecipient: deployer,
    startBlock: block.number + 10,
    endBlock: block.number + 110,                  // 100-block duration
    claimBlock: block.number + 110,
    tickSpacing: 79228162514264334008320,           // Q96 floor (1 ETH = 1M tokens)
    floorPrice: 79228162514264334008320,
    validationHook: address(0),
    requiredCurrencyRaised: 0,
    auctionStepsData: [100% linear over 100 blocks]
})
```

The script also mints 1B tokens to the auction and calls `onTokensReceived()` to activate it.

### 2. Deploy BlindPoolCCA wrapper

**Script:** `scripts/script/DeployBlindPool.s.sol`

```bash
make deploy-blindpool AUCTION_ADDRESS=0x...
```

- Reads the CCA's `endBlock`
- Sets `blindBidDeadline = endBlock - 20` (20 blocks of buffer for reveal + forward)
- Deploys `BlindPoolCCA(ccaAddress, blindDeadline)`

### 3. Check status

**Script:** `scripts/script/CheckBlindPool.s.sol`

```bash
make check BLIND_POOL_ADDRESS=0x...
```

Shows: addresses, timing, bid count, individual bid info (bidder, deposit, forwarded status).

### 4. Reveal bids

**Script:** `scripts/script/RevealBlindPool.s.sol`

```bash
make reveal BLIND_POOL_ADDRESS=0x...
```

Calls `requestReveal()`. Requires deadline to have passed.

### 5. Forward decrypted bids

**Script:** `scripts/script/ForwardBids.s.sol`

```bash
BLIND_POOL_ADDRESS=0x... \
FORWARD_BID_ID=0 \
FORWARD_CLEAR_MAX_PRICE=100000 \
FORWARD_CLEAR_AMOUNT=500000 \
FORWARD_PROOF=0xabcdef... \
forge script script/ForwardBids.s.sol:ForwardBids \
  --rpc-url $SEPOLIA_RPC_URL --private-key $PRIVATE_KEY --broadcast -vv
```

The decrypted values + KMS proof come from the Zama relayer SDK's `publicDecrypt()` call (off-chain).

---

## Testing

**File:** `scripts/anviltest/BlindPoolCCA.t.sol` (412 lines)

```bash
make test
# or: forge test --match-contract BlindPoolCCATest -vv
```

Uses a `TestBlindPoolCCA` wrapper with `mockSubmitBlindBid()` that uses `FHE.asEuint64()` (trivial encrypt) instead of `FHE.fromExternal()` (which requires the relayer SDK).

### Test Cases

| Test | What it verifies |
|------|-----------------|
| `test_DeploymentAddresses` | fhEVM stack, CCA, BlindPool all deployed correctly |
| `test_BlindBidsAreHidden` | Bid values are opaque euint64 handles; only bidder/deposit visible |
| `test_CannotBidAfterDeadline` | Reverts with `AuctionClosed` after deadline block |
| `test_CannotRevealBeforeDeadline` | Reverts with `AuctionStillOpen` before deadline |
| `test_RevealFlow` | 3 bids submitted, reveal succeeds, double-reveal blocked |
| `test_MustDepositEth` | Reverts with `NoDeposit` if `msg.value == 0` |
| `test_CannotForwardBeforeReveal` | Reverts with `NotRevealed` |
| `test_FullFlow` | E2E: submit 2 bids → verify privacy → reveal → verify state |

**Note:** `forwardBidToCCA` requires real KMS decryption proofs only available on Sepolia. Local Anvil tests verify everything up to the reveal phase.

---

## Reveal Options (Access Control)

### Option A: Creator-Only Reveal

Add access control to the contract:
- Add `onlyAdmin` modifier to `requestReveal()` — only creator can trigger reveal
- Optionally add `onlyAdmin` to `forwardBidToCCA()` — only creator can forward
- Creator runs the relayer and sees decrypted values first

### Option B: Automatic Reveal (current default)

- `requestReveal()` is public — any bot/user/keeper can call it after deadline
- A backend service or script:
  1. Calls `requestReveal()` once deadline passes
  2. For each bid: calls relayer `publicDecrypt([priceHandle, amountHandle])`
  3. Gets back clear values + KMS proof
  4. Calls `forwardBidToCCA(bidId, price, amount, proof)`
- After all bids forwarded, the CCA has full bid data and settlement proceeds normally

| Aspect | Creator-Only (A) | Automatic (B) |
|--------|------------------|---------------|
| `requestReveal()` | Admin only (needs contract change) | Anyone after deadline |
| Decryption | Creator runs relayer | Public relayer / backend |
| `forwardBidToCCA()` | Admin only (optional) | Anyone with valid proof |
| When amounts visible | When creator forwards | When bot/backend forwards |

---

## Security Properties

1. **Sealed bids** — `encMaxPrice` and `encAmount` are `euint64` handles, unreadable without KMS
2. **MEV resistance** — validators cannot read bid prices/amounts, preventing sandwich attacks and front-running
3. **KMS proof verification** — `FHE.checkSignatures()` cryptographically proves decrypted values match the original ciphertexts
4. **ETH escrow** — `msg.value` held in contract, excess refunded after forward
5. **ACL permissions** — encrypted handles only accessible by contract + original bidder
6. **Immutable forwarding** — once forwarded to CCA, a bid cannot be changed or replayed (`AlreadyForwarded` check)
7. **Deadline enforcement** — blind bids rejected after deadline, reveal rejected before deadline

---

## Price Encoding (Q96)

Prices in the CCA use **Q96 fixed-point** format (96-bit fractional precision):

```
price_Q96 = ethPrice * 2^96
```

The BlindPoolCCA stores encrypted prices as `euint64` — a scaled-down representation that fits in 64 bits. The `FloorPrice` in the deployment example:

```
79228162514264334008320 = (2^96) / 1_000_000 → 1 ETH buys 1,000,000 tokens
```

Frontend conversion helpers (in `lib/auction-contracts.ts`):

```typescript
const Q96 = BigInt(2) ** BigInt(96);
function ethToQ96(ethPrice: string): bigint { ... }
function q96ToEth(q96Price: bigint): string { ... }
```

---

## Frontend Integration (Place Bid Form)

The frontend needs to know whether an auction uses **plain CCA** or **BlindPoolCCA**:

- **Plain CCA:** Call `submitBid(maxPrice, amount, owner, prevTickPrice, hookData)` directly on the CCA with `msg.value = amount`
- **BlindPoolCCA:** Encrypt inputs with Zama relayer SDK, call `submitBlindBid(handle1, handle2, proof)` on BlindPoolCCA with `msg.value = amount`

```typescript
import { createInstance } from '@zama-fhe/relayer-sdk';

const instance = await createInstance({
  aclContractAddress: '0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D',
  kmsContractAddress: '0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A',
  chainId: 11155111,
  relayerUrl: 'https://relayer.testnet.zama.org',
});

// Encrypt the two bid inputs
const input = instance.createEncryptedInput(blindPoolAddress, userAddress);
input.add64(BigInt(maxPriceQ96));
input.add64(BigInt(amountWei));
const encrypted = await input.encrypt();

// Submit sealed bid
await writeContract({
  address: blindPoolAddress,
  abi: BlindPoolABI,
  functionName: 'submitBlindBid',
  args: [encrypted.handles[0], encrypted.handles[1], encrypted.inputProof],
  value: BigInt(amountWei),
});
```

---

## File Map

| File | Purpose |
|------|---------|
| `scripts/src/BlindPoolCCA.sol` | Main contract (303 lines) |
| `scripts/script/DeployCCA.s.sol` | Deploy CCA auction on Sepolia |
| `scripts/script/DeployBlindPool.s.sol` | Deploy BlindPoolCCA wrapper |
| `scripts/script/RevealBlindPool.s.sol` | Call requestReveal() |
| `scripts/script/ForwardBids.s.sol` | Forward decrypted bid to CCA |
| `scripts/script/CheckBlindPool.s.sol` | Read-only status check |
| `scripts/anviltest/BlindPoolCCA.t.sol` | Full test suite (412 lines) |
| `scripts/Makefile` | Build, test, deploy commands |
| `scripts/foundry.toml` | Foundry config (solc 0.8.26, optimizer) |

---

## References

- [Zama fhEVM Solidity Guides](https://docs.zama.org/protocol/solidity-guides)
- [Zama Relayer SDK](https://docs.zama.org/protocol/relayer-sdk-guides)
- [Uniswap CCA](https://github.com/Uniswap/continuous-clearing-auction)
