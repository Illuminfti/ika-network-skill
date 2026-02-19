# Ika Network — Core Concepts Reference
*Mental models for building with dWallets. Source: IACR ePrint 2024/253, IACR ePrint 2025/297, docs.ika.xyz/docs/core-concepts, github.com/dwallet-labs/ika*

---

## 1. The Core Analogy

**A dWallet is a joint bank account where "the bank" is hundreds of anonymous validators who mathematically cannot move your money without you.**

Traditional joint accounts: the bank CAN move money if they collude (or get hacked). MPC wallets (Lit, Fireblocks): the validator set COULD collude — it's prevented by policy and legal risk, not math.

Ika's innovation: the protocol is structured so that producing a valid signature is *computationally impossible* without the user's participation. Not "hard" — impossible. The validators collectively hold one key share. The user holds the other. Neither alone produces anything useful.

The "bank" (Ika network) is decentralized — 100+ nodes at mainnet, designed to scale to thousands — so there's no single vault to rob.

---

## 2. What is a dWallet (Official Definition)

> *"dWallets are Web3 building blocks designed for multi-chain interoperability. They are non-collusive, massively decentralized, programmable and transferable signing mechanisms with an address on any other blockchain, that can sign transactions to those networks."*
> — docs.ika.xyz/docs/core-concepts/dwallets

### Official Attributes

| Attribute | What It Means |
|---|---|
| **Non-collusive** | User ownership is enforced — no signature without user consent. Achieved via the 2PC-MPC protocol. |
| **Massively Decentralized** | Hundreds or thousands of permissionless nodes participate in every signature. |
| **Programmable** | Builders on other networks can define logic (in Sui Move) that governs when signatures are created, enforced by Ika. |
| **Transferable** | Ownership can be transferred, enabling custody handoffs, escrow, and dWallet marketplaces. |
| **Universal Signing** | Signs for virtually any blockchain via ECDSA, EdDSA, and Schnorr. |

### What a dWallet Object Contains

- A public key that has valid addresses on target chains (Bitcoin, Ethereum, Solana, etc.)
- The *network's* key share (held distributed across Ika validators)
- The *user's* encrypted key share (on-chain, decryptable only by the user)
- Metadata: curve, signature algorithm, creation epoch

**The key insight:** A dWallet is not an address — it *derives* addresses on other chains. One dWallet object → one Bitcoin address, one Ethereum address, one Solana address. Same underlying key material, different encoding.

**Why a Sui object (not just a keypair):**
- Transferable atomically — enables custody handoffs, escrow, and signing authority marketplaces
- Composable — embed in DeFi protocols, DAOs, or AI agent guardrails via Move smart contracts
- Programmable — signing policy (who can authorize what) is expressed in Move, not hardcoded

---

## 3. DWalletCap — The Admin Key (CRITICAL)

`DWalletCap` is a Sui capability object that controls who can authorize message signing on a dWallet. Think of it as the manager's key card for the joint account. Without it, no one can initiate a signature — not even the network validators with full cooperation.

**What it does:**
- `coordinator.approve_message(dwalletCap, algorithm, hash, message)` → `MessageApproval`
- Without a `MessageApproval`, the signing protocol cannot proceed
- Ownership of `DWalletCap` = control over the signing policy

**Why it's critical:**

```
DWalletCap LOST → dWallet FROZEN FOREVER
```

The dWallet still exists on-chain. The funds at its addresses still exist on Bitcoin/Ethereum. But nobody can ever sign a transaction from it again. There is no recovery path. No admin override.

**DWalletCap is a transferable Sui object.** It can be:
- Held by an EOA (standard user custody)
- Locked in a multisig contract (committee control)
- Embedded in a Move module (programmatic policy)
- Transferred to another owner (custody handoff)

**Builder rule:** Never transfer or destroy `DWalletCap` without a recovery plan. Store it at least as carefully as a seed phrase.

---

## 4. The 2PC-MPC Protocol

**Papers:**
- V1: "2PC-MPC: Emulating Two Party ECDSA in Large-Scale MPC" — IACR ePrint 2024/253
- V2: "Practical Zero-Trust Threshold Signatures in Large-Scale Dynamic Asynchronous Networks" — IACR ePrint 2025/297
- **Authors:** Marmor, Mutzari, Sadika, Scaly, Spiizer, Yanai (dWallet Labs)
- **Implementation:** Pure-Rust at github.com/dwallet-labs/2pc-mpc

### The Problem with Standard MPC

Classic threshold ECDSA (GG20, CMP, Lindell17) uses **unicast P2P messaging** — every node talks to every other node. That's O(n²) messages. With 20 nodes, one signature takes minutes. With 100 nodes, it's infeasible. This is why every existing Web3 MPC solution runs on 4–30 nodes, which means the network *can* collude.

### What 2PC-MPC Changes

> *"The 2PC-MPC protocol can be thought of as a 'nested' MPC, where a user and a network are always required to generate a signature (2PC — 2 party computation), and the network participation is managed by an MPC process between the nodes, requiring a threshold on par with the consensus threshold. This structure creates non-collusivity, as the user is always required to generate a signature, but also allows the network to be completely autonomous and flexible."*
> — docs.ika.xyz/docs/core-concepts/cryptography/2pc-mpc

**Key breakthroughs:**

| Property | Old MPC | 2PC-MPC |
|---|---|---|
| Communication | O(n²) unicast | O(n) broadcast |
| Computation per party | O(n) | O(1) amortized |
| User-side complexity | Scales with n | Asymptotically O(1) |
| Max practical nodes | ~30 | Hundreds / thousands |
| Collusion risk | Possible (threshold) | Cryptographically impossible |

**Broadcast instead of unicast:** Ika uses Mysticeti DAG consensus (Sui's consensus engine) as the broadcast layer. Validators broadcast to a shared log — no direct P2P channels needed.

### 2PC-MPC V2 Key Enhancements

- **Schnorr and EdDSA** in addition to threshold ECDSA
- **Asynchronous broadcast networks** — works under real blockchain conditions
- **Dynamic participant quorums** — signers can change between rounds (permissionless validator sets)
- **Non-interactive presign generation** — fully O(1) for the user, reusable across signer sets
- **Reconfiguration support** — participants join/leave without resharing
- **Weighted threshold structures** optimized for PoS systems
- **HD wallet compatibility** (BIP32) and secure wallet transfer

### Performance from the V1 Paper

- 256 parties, sign phase: **1.23 seconds**
- 1024 parties, sign phase: **12.70 seconds**
- Mainnet (~100 nodes): sub-second claimed (independent benchmarks not yet public)

**Goal:** *"millions of users, and tens of thousands of signatures per second, with thousands of validators"* — docs.ika.xyz

### UC-Security with Identifiable Abort

If any node cheats, the protocol identifies *which* node. This enables slashing. Publicly verifiable — no private channels needed.

### The User's Role in Every Signature

The user doesn't just "approve" — they *cryptographically participate*:
1. Decrypt the user's key share locally (WASM, never leaves client)
2. Compute a partial signature contribution
3. Submit alongside the network's contribution

Network validators can vote unanimously to sign — it doesn't matter. Without step 2, no valid signature emerges.

---

## 5. Multi-Chain vs Cross-Chain — The Key Distinction

### Official Definitions

> *"In multi-chain architectures, each blockchain operates independently with its own set of governance and security protocols. This setup is vital for the network's stability and autonomy, allowing each to evolve and specialize based on its unique strengths and use cases."*

> *"Cross-chain technology like bridges, messaging or federated MPC, aims to enable interoperability between disparate blockchain networks... While promising... this approach involves security risks and trust challenges, moving away from the fundamental principles of Web3 — user ownership and decentralization."*
> — docs.ika.xyz/docs/core-concepts/multi-chain-vs-cross-chain

### Zones of Sovereignty

The official concept of **"Zones of Sovereignty"** highlights that each blockchain has its own independent governance and security. Cross-chain solutions risk compromising these sovereign zones by exposing assets to the varying security protocols of other networks. Preserving a blockchain's sovereignty is crucial for maintaining the integrity and safety of assets.

### The Practical Distinction

**Cross-chain** (bridges, messaging): Move an asset or message *between* chains.
→ Lock ETH on Ethereum, mint wETH on Sui. The ETH left Ethereum. Bridge risk exists.

**Multi-chain** (dWallets): Control native assets *on* any chain from one place.
→ Your Bitcoin stays on Bitcoin. You sign a Bitcoin transaction from a Sui smart contract. The BTC never moves to Sui.

**The analogy:** Cross-chain is like wiring money overseas. Multi-chain is like having a debit card that works in 30 countries — the bank account stays home.

### How dWallets Solve This

At the heart of dWallet technology is the 2PC-MPC protocol's **dual-share system**: a user share and an Ika Network share. The network share is managed by validators requiring a **2/3 threshold** for signature generation — analogous to BFT consensus. This ensures user control of assets while enabling interoperability without exposing them to cross-chain risk.

**Why this matters:**
- No bridge = no bridge hack risk ($320M Wormhole, $625M Ronin)
- Native BTC means real BTC collateral, not wrapped BTC with smart contract risk
- Atomic execution: sign on chain A and chain B in the same Sui transaction

---

## 6. Zero-Trust and Decentralization

### Official Definitions

> *"Zero Trust refers to the design and operation of systems in a way that requires continuous verification and approval for any action. In the context of blockchain and Web3 technologies, this means ensuring that validators, miners, or any parties involved in the network cannot steal user assets, even if they are compromised."*

> *"In the context of a specific blockchain, Zero Trust is achieved through digital signatures. Even if all nodes on a specific network colluded, they can never sign a transaction on behalf of the user who holds the private key."*
> — docs.ika.xyz/docs/core-concepts/zero-trust-and-decentralization

**Decentralization** disperses power away from a central authority among many independent nodes. Whatever the consensus mechanism, decentralization protects users from double-spending and similar attacks.

### Why Competitors Can Collude

In Lit Protocol (18-of-30 threshold), THORChain, Zetachain: validators collectively hold the full private key. The threshold means ≥18 validators cooperating can sign anything. If an attacker controls 18 nodes, they sign arbitrary transactions. Prevented by incentives and legal structures — not cryptography.

### Why Ika Can't Collude

The 2PC structure: `(user key share) + (network key share) = valid signature`. The user's key share is:
- Generated client-side in WASM
- Encrypted under the user's public encryption key
- Stored on-chain only in encrypted form
- Never transmitted to any validator in plaintext

Validators hold the *network share* — different material. `network_share + network_share = nothing`. Only `user_share + network_share = valid signature`.

**Formal guarantee:** UC-secure (Universal Composability). In adversarial environments with arbitrary concurrent protocols, security holds. Not a heuristic — a formal proof.

### The Attack Surface

| System | What an attacker controlling 2/3 of nodes gets |
|---|---|
| Lit Protocol | Full signing power over all wallets |
| THORChain | Full signing power over all vaults |
| Fireblocks | Nothing (but Fireblocks itself could sign) |
| **Ika** | **Nothing. Signing requires user participation.** |

---

## 7. What Ika Is NOT

| Not This | Why People Confuse It | What It Actually Is |
|---|---|---|
| A wallet app | Has "wallet" in dWallet | A protocol for programmable signing |
| A bridge | Moves assets cross-chain | Signs natively, no asset movement |
| A DEX | Used in DeFi | Infrastructure enabling native-asset DEXes |
| An L1 for apps | Fork of Sui | **Smart contract execution is DISABLED** |
| A messaging protocol | Like Axelar/LayerZero | Controls assets, not messages |
| A chain abstraction layer | Marketed that way | Signing layer; abstraction built on top |
| EVM-compatible | Axelar/LayerZero are | Sui/Move native; requires adapters for EVM devs |

**What Ika IS:** A decentralized MPC signing service where user participation is cryptographically enforced, programmable via Sui Move, and capable of producing valid native signatures for any ECDSA, EdDSA, or Schnorr chain.

---

## 8. Object & Protocol Lifecycle

### Architecture

```
Your Move Contract
  DWalletCap (stored)
  Presigns (pooled)
  Business Logic (governance, approvals)
         ▼          ▼          ▼
  DWalletCoordinator
    DKG Protocol | Presign Protocol | Sign Protocol | Future Sign Protocol
         ▼          ▼          ▼
  Ika Network (2PC-MPC Protocol Execution)
```

### Protocol Stages

```
DKG  → Create dWallet, receive DWalletCap (store permanently)
            ↓
PRESIGN → Pre-compute signing material (pool of UnverifiedPresignCap)
            ↓ (network processes async → VerifiedPresignCap)
SIGN OPTIONS:
  Direct Sign:     approve_message() → request_sign()      (immediate)
  Future Sign:     Phase 1: Commit → Phase 2: Execute      (governance/multisig)
```

### User-Facing dWallet Creation Flow (SDK)

```
createClassGroupsKeypair()      ← user generates encryption keypair (client WASM)
       ↓
registerEncryptionKey()         ← publish user's public encryption key on-chain
       ↓
prepareDKG()                    ← compute DKG inputs (client WASM)
       ↓
requestDWalletDKG()             ← submit to chain → Ika network runs distributed keygen
       ↓ [state: AwaitingKeyHolderSignature]
acceptEncryptedUserShare()      ← user accepts & signs their encrypted key share
       ↓ [state: Active]
approveMessage(dWalletCap, ...)  ← policy check: is this message authorized?
       ↓
requestSign()                   ← user contributes partial sig + network completes
       ↓ [state: Completed]
parseSignatureFromSignOutput()  ← extract raw bytes
       ↓
Broadcast to target chain       ← submit Bitcoin tx, Ethereum tx, etc.
```

**Presign is optional but important for latency.** Presigning precomputes part of the signing protocol in advance. When you need to sign urgently (e.g., liquidation), the presign is already done — you just provide the message.

### dWallet Modes

| Mode | User Share | Who Can Sign | Best For |
|---|---|---|---|
| **Zero-Trust** | Encrypted, user only | User must participate each time | Personal wallets, max security |
| **Shared** | Public (made available) | Network can sign autonomously | DAOs, treasuries, Move contract integration |

Conversion from zero-trust → shared is **irreversible**. If creating for a contract, use `request_dwallet_dkg_with_public_user_secret_key_share()` from the start.

---

## 9. Supported Curves and Chains

| Curve | Algorithm | Hash Options | Target Chains |
|---|---|---|---|
| secp256k1 | ECDSASecp256k1 | KECCAK256, SHA256, DoubleSHA256 | Bitcoin, Ethereum, BSC, all EVM |
| secp256k1 | Taproot | SHA256 | Bitcoin (Taproot outputs) |
| secp256r1 | ECDSASecp256r1 | SHA256 | P-256 chains, passkeys, WebAuthn |
| Ed25519 | EdDSA | SHA512 | Solana, Near, Stellar, Cardano, Zcash |
| Ristretto | SchnorrkelSubstrate | Merlin | Polkadot, Substrate chains |

**EdDSA added December 2025** — opens Solana, Near, Stellar, Cardano, Zcash.

**Coverage rule of thumb:** If a chain uses ECDSA or EdDSA for transaction signing, a dWallet can control an account on it. That covers ~95% of chains by TVL.

---

## 10. Competitive Positioning

Honest comparison. Sourced from ecosystem analysis 2026-02-18.

| Protocol | Node Count | Trust Model | Latency | Key Differentiator | Fatal Weakness |
|---|---|---|---|---|---|
| **Ika** | 100+ (→ thousands) | Non-collusive (2PC-MPC) | Sub-second (claimed) | Non-collusion is math, not policy | Sui-centric, early SDK, private core library |
| **Lit Protocol** | 30 (18-of-30 threshold) | TEE + threshold | ~1–2 sec | Mature JS/TS SDK, EVM ecosystem | 18-of-30 can collude; TEE trust assumption |
| **THORChain** | ~100 Thorns | Federated MPC (small subset) | Minutes | Real cross-chain DEX volume | Collusion possible, multiple hacks |
| **Zetachain** | ~100 validators | Federated MPC | Seconds | EVM-compatible smart contracts | Collusion possible, limited programmability |
| **Wormhole** | 19 Guardians | Multi-sig (19-of-19) | Minutes | High TVL, battle-tested | 19 guardians = coludable, $320M hack 2022 |
| **Safe (Gnosis)** | N/A | Smart contract multisig | Per-chain | 5M+ deployments, EVM depth | EVM only, no native BTC |
| **ICP Chain Key** | ~20k nodes | Threshold BLS + NiDKG | 2–5 sec | Most decentralized, integrated with canisters | Locked to ICP ecosystem |
| **Fireblocks MPC** | N/A (centralized) | 2-of-2 (Fireblocks + client) | Near-instant | Enterprise, compliance | Fully centralized — Fireblocks can sign |

### Where Ika Fits in the Stack

```
Application Layer   DeFi protocols, wallets, AI agents (Native, Human.tech, Aeon)
        ↓
Ika (signing layer) dWallets — programmable, multi-chain, zero-trust signing
        ↓
Sui (policy layer)  Move smart contracts controlling when/how signing is authorized
        ↓
Target chains       Bitcoin, Ethereum, Solana, etc. — where signed txs are broadcast
```

### Honest Assessment

**Ika wins on:**
- Non-collusion is mathematically proven (unique in the field)
- Scales to hundreds/thousands of nodes (competitors cap at 4–30 for MPC)
- Programmability via Sui Move (DWalletCap as composable object)
- Native asset control (not messaging/wrapping)
- Peer-reviewed cryptography (IACR 2024/253, IACR 2025/297)

**Ika loses on:**
- SDK maturity (v0.2.x, known signing bugs, private core library gated)
- EVM reach (Axelar, LayerZero work without Move knowledge)
- Ecosystem depth (most projects still building, not live)
- No liquidity/TVL to back DeFi use cases
- No independent performance benchmarks

---

## Quick Reference Card

```
dWallet        = Sui object with addresses on many chains. User + network key shares. Non-collusive.
DWalletCap     = Admin capability. Controls signing authorization. NEVER LOSE IT.
DWalletCoord   = Shared Sui object. Central entry point for all dWallet operations.
2PC-MPC        = Two-party MPC. User + network = sig. Neither alone = nothing. O(n) broadcast.
DKG            = Distributed Key Generation. Creates the split key material. = creating a dWallet.
Presign        = Precomputed partial signature material. Reduces sign latency. Pool + replenish.
Sign (Direct)  = Immediate: verify presign → approve message → request sign → done.
Future Sign    = Two-phase: Phase 1 commits partial sig, Phase 2 executes after governance.
Multi-chain    = Sign natively on target chains. No bridges. Assets stay on their chain.
Zero-trust     = Even 100% compromised network cannot sign. Math, not policy.
Shared mode    = Public user share. Contract can sign without user. For DAOs/treasuries.
Zones of Sov.  = Each chain's independent governance must not be compromised by cross-chain.
IACR 2024/253  = V1 paper. "2PC-MPC: Emulating Two Party ECDSA in Large-Scale MPC."
IACR 2025/297  = V2 paper. Adds Schnorr, EdDSA, async networks, dynamic quorums.
```

---

*Sources: IACR ePrint 2024/253 | IACR ePrint 2025/297 | docs.ika.xyz/docs/core-concepts | github.com/dwallet-labs/ika | Ecosystem analysis 2026-02-18*
