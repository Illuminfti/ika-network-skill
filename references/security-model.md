# Ika Network — Security Model Reference

> Official security properties, protocol guarantees, and threat analysis for dWallet integrations.
> Sources: IACR ePrint 2024/253 (V1), IACR ePrint 2025/297 (V2), docs.ika.xyz official pages.

---

## 1. Zero Trust Security — Official Definition

**Source:** https://docs.ika.xyz/docs/core-concepts/zero-trust-and-decentralization

> Zero Trust refers to the design and operation of systems in a way that requires **continuous verification and approval for any action**. In blockchain and Web3, this means ensuring that validators, miners, or any parties involved in the network **cannot steal user assets, even if they are compromised**.

In a specific blockchain, Zero Trust is achieved through digital signatures: even if all nodes on a network colluded, they can never sign a transaction on behalf of the user who holds the private key.

**dWallets extend this principle to cross-chain operations.** A dWallet is a non-collusive, massively decentralized, programmable, and transferable signing mechanism with an address on any blockchain.

### dWallet Attributes (Official)

| Attribute | Definition |
|-----------|-----------|
| **Non-collusive** | User ownership enforced cryptographically — signatures cannot be generated without user consent |
| **Massively Decentralized** | 2PC-MPC enables hundreds or thousands of permissionless nodes to participate in signing |
| **Programmable** | Builders define logic governing transaction signatures, enforced by Ika via Sui Move |
| **Transferable** | Ownership transfer is supported, enabling dWallet marketplace and future user claims |
| **Universal Signing** | ECDSA (SECP256K1, SECP256R1), EdDSA (ED25519), Schnorr (RISTRETTO) — covers virtually any blockchain |

---

## 2. 2PC-MPC — Protocol Properties

**Source:** https://docs.ika.xyz/docs/core-concepts/cryptography/2pc-mpc  
**Papers:** IACR ePrint 2024/253 (V1) and 2025/297 (V2)  
**Authors:** Marmor, Mutzari, Sadika, Scaly, Spiizer, Yanai (dWallet Labs)

### Protocol Architecture

The 2PC-MPC protocol is a "nested" MPC:
- **Outer layer (2PC)**: A user and a network are ALWAYS required together to generate a signature
- **Inner layer (MPC)**: The network's participation is managed by an MPC process among nodes, requiring a threshold equivalent to BFT consensus (2/3 honest)
- **Non-collusivity by construction**: The user is cryptographically required in every signature — the network cannot act autonomously

```
Key = UserShare ⊗ NetworkShare   (via DKG — Distributed Key Generation)

Signing requires:
  1. User computes partial signature from UserShare (client-side, never transmitted)
  2. Network threshold (≥2/3 of validators) computes from NetworkShare
  3. Combined: valid ECDSA / EdDSA / Schnorr signature on target chain
```

### Key Features vs Prior TSS Protocols (Official)

| Property | 2PC-MPC | Standard GG20/CMP | Lit Protocol | Fireblocks |
|----------|---------|-------------------|-------------|-----------|
| Non-collusive | ✅ Cryptographic | ❌ Trust-based | ❌ TEE trust | ❌ Policy-based |
| Node scale | 100–1000s | 4–30 | 30 (18-of-30) | 2 (vendor + user) |
| Communication complexity | O(n) broadcast | O(n²) unicast | O(n²) | N/A |
| User-side complexity | O(1) asymptotically | O(n) | O(n) | N/A |
| Identifiable abort | ✅ | Partial | ❌ | ❌ |
| Publicly verifiable | ✅ | ❌ | ❌ | ❌ |

### Performance (From Paper)

| Configuration | Sign Phase Latency |
|--------------|-------------------|
| 256 parties (V1 paper) | 1.23 seconds |
| 1024 parties (V1 paper) | 12.70 seconds |
| ~100 nodes (mainnet) | Sub-second (claimed; no independent benchmark yet) |

### 2PC-MPC V2 Enhancements (IACR 2025/297)

V2 significantly expands capabilities for real-world deployment:

- **Schnorr and EdDSA signatures** — extends beyond threshold ECDSA
- **Asynchronous broadcast network support** — operates under real network conditions
- **Dynamic participant quorums** — signers can change between rounds, aligning with permissionless validator sets
- **Non-interactive presign generation** — fully O(1) for the user, enabling reuse across signers
- **Reduced round complexity** for DKG and presign phases
- **Reconfiguration support** — participants can join or leave without full resharing
- **Weighted threshold structures** — optimized for Proof-of-Stake validator systems
- **HD wallet compatibility** (BIP32) and secure wallet transfer
- **Improved unforgeability assumptions** and proactive abort handling

---

## 3. What Network Validators CAN and CANNOT Do

### 2/3 BFT Threshold — Normal Operation

- ✅ Can: Participate in signing protocol when user requests
- ✅ Can: Refuse to participate (denial of service / griefing)
- ✅ Can: Detect and identify misbehaving nodes (identifiable abort)
- ❌ Cannot: Sign any message without user's cryptographic participation
- ❌ Cannot: Recover the user's secret key share (never transmitted)

### Compromised Validator Scenarios

| Compromise Level | Effect on Safety | Effect on Liveness |
|-----------------|-----------------|-------------------|
| Up to 1/3 validators malicious | Protocol continues safely (BFT) | Liveness maintained |
| 2/3 or more validators malicious | Protocol can stall | Liveness fails (DoS only) |
| 100% of validators colluding | **STILL CANNOT SIGN** without user | Full DoS |

**Critical property:** Even if 100% of validators collude, they cannot produce a valid signature for any message. The user's key share is a cryptographic prerequisite that was never transmitted to the network.

Colluding validators can:
- Refuse to co-sign (denial of service)
- Sign only messages explicitly approved by the user

Colluding validators cannot:
- Steal assets by signing unauthorized transactions
- Move funds without user participation
- Recover the user's secret key share

### Comparison vs Competitors

| Protocol | What full validator compromise enables |
|----------|---------------------------------------|
| **Ika** | DoS only — assets stay safe, cannot be stolen |
| Fireblocks | Fireblocks alone CAN sign (holds one of two shares) |
| Lit Protocol | 18-of-30 colluding = full signing control |
| THORChain | Small signing subset; has led to actual hacks |
| Wormhole | 10-of-19 guardians = $320M hack 2022 |
| Safe (Gnosis) | Depends on multisig signer compromise |

---

## 4. DKG and Key Share Security

### Distributed Key Generation (DKG) — Official

> In DKG, a public key is created through a ceremony involving secret shares. In the context of dWallets and 2PC-MPC, the DKG process constitutes the creation of a dWallet. It involves generating both a user share and a network share, with the latter encrypted by a network decryption key used as part of the 2PC-MPC protocol.

### User Secret Key Share Properties

- Generated during DKG via `prepareDKGAsync()` (TypeScript SDK)
- **Never transmitted to the Ika network** — remains in browser/device memory
- Encrypted copy stored on-chain via `EncryptedUserSecretKeyShare` (for zero-trust dWallets)
- Required for every signing operation in zero-trust mode
- If lost: dWallet is permanently unable to sign (network cannot recover it)

### dWallet Types — Security Implications

| Type | User Share | Network Can Sign Alone? | Use Case |
|------|-----------|------------------------|---------|
| **Zero-Trust** | Encrypted, user-controlled | ❌ Never | Personal wallets, max security |
| **Shared** | Public, on-chain | ✅ Yes (trusts network) | DAOs, automated contracts |
| **Imported Key** | Derived from existing key | Depends on mode | Key migration |

**Converting Zero-Trust → Shared is irreversible.** Once user share is made public via `request_make_dwallet_user_secret_key_shares_public()`, it cannot be made private again.

---

## 5. DWalletCap Security Implications

`DWalletCap` is the Move capability object that authorizes signing operations for a dWallet. Created during DKG. Controls who can call `approve_message()`.

### What DWalletCap Controls

- **Which smart contracts** can authorize signing (`approve_message()`)
- **Signing policy** — any logic embedded in the contract holding the cap
- **Message approval** — what messages can be signed (cap holder can approve anything)

### What DWalletCap Does NOT Control

- The user's secret key share (cryptographically separate)
- Whether the Ika network threshold participates (network has independent governance)
- Network-side signing behavior (governed by protocol, not cap)

### Compromise Scenarios

| Scenario | Impact |
|----------|--------|
| Attacker gains DWalletCap in a personal wallet | Can approve ANY message; full signing control if user share also compromised |
| Attacker steals DWalletCap from a Move contract | Depends on contract's access control — may require governance vote/multisig |
| DWalletCap lost / deleted | dWallet permanently frozen — no more signing. Assets may be locked forever. |
| DWalletCap transferred to wrong address | New owner has full signing authority |
| Server-side integration holds DWalletCap | If server also drives user-side: negates 2PC-MPC guarantee |

> **⚠️ Critical:** If your integration uses a server-side flow where the server holds both the DWalletCap and drives user-side inputs, then `DWalletCap` compromise = full wallet compromise. This is the same as traditional MPC custody.

### Secure DWalletCap Storage

```move
// Recommended: Lock cap inside a Move contract with access control
public struct SecureVault has key, store {
    id: UID,
    dwallet_cap: DWalletCap,       // Never exposed externally
    admin_multisig: address,        // Only this address can trigger signing
}

// Cap usage is controlled by contract logic — never transferred out
public fun sign_with_governance_approval(
    vault: &mut SecureVault,
    coordinator: &mut DWalletCoordinator,
    message: vector<u8>,
    _governance_proof: GovernancePassedCap,  // Proof that governance approved
    ctx: &mut TxContext,
): MessageApproval {
    // DWalletCap is only used here, inside the module
    coordinator.approve_message(&vault.dwallet_cap, TAPROOT, SHA256, message)
}
```

---

## 6. Threat Model

### Frontrunning

**Risk:** Observer sees a pending sign request and races to use it on target chain.  
**Ika mitigation:** `MessageApproval` is specific to an exact message hash and is consumed once. Presign caps are tied to the dWallet. No signature can be issued for a different message without a new `approve_message()` call.  
**Residual risk:** A valid signature on a predictable message could be raced on the target chain after broadcast — but this is target-chain replay, not an Ika issue.

### Replay Attacks

**Risk:** A valid signature reused on the target chain.  
**Ika mitigation:** None — Ika produces valid cryptographic signatures. Replay protection is the **target chain's responsibility** (nonces on ETH, UTXO model on BTC).  
**Builder requirement:** Include sequence numbers/nonces in every signed message. Design messages that cannot be replayed.

### Griefing / DoS

**Risk:** Validator set refuses to co-sign (liveness failure without asset theft).  
**Ika mitigation:** Slashing for non-participation, standard PoS mechanism. With 100+ validators, DoS requires ≥1/3 coordinated.  
**Residual risk:** No signing = no access to assets until liveness resumes. Plan for this in incident response.

### Identifiable Abort

**Feature:** If a validator behaves maliciously and aborts the protocol, they are **identifiably blamed**. This is a formal property of 2PC-MPC, critical for permissionless/trustless settings. Slashing applies to identified aborters.

### Compromised Network Encryption Key

**Risk:** The `NetworkEncryptionKey` (used to encrypt user shares to the network) is compromised.  
**Mitigation:** Ika supports mid-epoch reconfiguration via `request_network_encryption_key_mid_epoch_reconfiguration`. Old shares encrypted under the old key can be re-encrypted. This is handled at the protocol level.

---

## 7. What "Zero Trust" Does and Does NOT Mean

### What It MEANS in Ika's Context

✅ No single party (user, validator, operator) can unilaterally sign transactions  
✅ Ika validators cannot steal assets even if all collude — this is cryptographically enforced  
✅ Non-custodial: no third party holds keys or has emergency access  
✅ Cryptographic enforcement: policy violations are impossible, not merely forbidden  
✅ Identifiable abort: misbehaving nodes are publicly identified and can be slashed

### What It DOES NOT Mean

❌ Not immune to denial of service (validators can refuse to co-sign)  
❌ Not a guarantee that your Move contract logic is correct  
❌ Not protection against bugs in the Sui Move contract holding DWalletCap  
❌ Not protection against a compromised user device (local key share theft)  
❌ Not audited and battle-tested — Ika mainnet launched July 2025  
❌ Not trustless state verification of other chains (reading Bitcoin state requires an oracle)  
❌ Not protection against the user's own device being compromised

---

## 8. Formal Security Properties (V1 Paper)

From IACR ePrint 2024/253:

1. **UC-Secure threshold ECDSA** — proven in the Universal Composability framework
2. **Identifiable Abort** — if any party cheats, they are identified; honest parties can proceed
3. **Publicly verifiable** — all communication uses broadcast (no private P2P channels needed)
4. **Threshold additively homomorphic encryption** — enables MPC over public broadcast channel
5. **Novel ZK proofs** — for public broadcast MPC without private channels
6. **Batching/amortization** — reduces per-signature cost significantly at scale
7. **Formal 2PC notion** — defines user + network as a two-party system with provable non-collusion

---

## 9. Audit Checklist for dWallet Integrations

### Smart Contract (Move)

- [ ] `DWalletCap` stored in a shared object with access controls, not in an owned personal wallet
- [ ] `approve_message` called only after explicit governance / policy checks
- [ ] No unchecked external input passed directly to `approve_message` as the message
- [ ] Messages include a nonce/sequence number to prevent replay on target chain
- [ ] Emergency freeze: can `DWalletCap` signing be paused without destroying it?
- [ ] Upgrade path: if the Move package is upgradeable, what can change post-deploy?
- [ ] Presign pool: what happens when pool runs empty? (assert fails gracefully)
- [ ] Test that missing network quorum degrades gracefully — no asset loss, just blocked signing

### TypeScript / Application Layer

- [ ] User secret key share NEVER transmitted over the network or stored server-side
- [ ] `rootSeed` for `UserShareEncryptionKeys` derived from user-controlled secret (not server)
- [ ] Retry logic includes idempotency checks (don't double-submit DKG)
- [ ] Presign pool managed with proper concurrency controls (no two sign ops share a presign)
- [ ] Event subscription, not polling, for production sign result handling
- [ ] IKA and SUI balance checks before submitting transactions

### Operational

- [ ] DWalletCap key management: HSM or Move-contract custody (not a single hot wallet)
- [ ] Monitoring: alert on failed sign requests, unexpected state changes, 429 errors
- [ ] Incident plan: documented response if Ika network has an outage
- [ ] Key rotation plan: user share re-encryption procedure on key compromise

---

## 10. Known Limitations

| Limitation | Impact | Status |
|------------|--------|--------|
| Core 2pc-mpc library is closed source | Cannot run local node; limited external auditability | Ongoing |
| No independent performance benchmarks | "10,000 TPS" claim unverified externally | No ETA |
| SDK v0.2.x signing flow edge-case bugs | `userOutputSignature` undefined on some presign paths | Check GitHub |
| No on-chain Bitcoin/ETH state oracle | Cannot verify target chain state from Move natively | Ecosystem gap |
| Token economics: IKA required for all ops | Dynamic pricing unpredictable; cold-start cost | By design |
| Mainnet launched July 2025 | Limited battle-testing compared to older protocols | Time heals |

---

*Last verified: 2026-02-18 | Sources: IACR 2024/253, IACR 2025/297, docs.ika.xyz/docs/core-concepts/zero-trust-and-decentralization, docs.ika.xyz/docs/core-concepts/cryptography/2pc-mpc*
