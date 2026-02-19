# Ika Network — Move Integration Reference

> Comprehensive guide for integrating dWallets into Sui Move smart contracts.
> All code extracted from official Ika docs (docs.ika.xyz) and source repo.

---

## 1. Architecture Overview

```
Your Move Contract
  DWalletCap (stored)
  Presigns (pooled)
  Business Logic (governance, approvals)
         ▼          ▼          ▼
  DWalletCoordinator (shared Sui object)
    DKG Protocol | Presign Protocol | Sign Protocol | Future Sign Protocol
         ▼          ▼          ▼
  Ika Network (2PC-MPC Protocol Execution)
```

### Protocol Lifecycle

```
DKG → Create dWallet and receive DWalletCap (store permanently)
         ▼
PRESIGN → Pre-compute cryptographic material
        UnverifiedPresignCap (pool) → VerifiedPresignCap (ready to use)
         ▼
Signing Options:
  SIGN (Direct):       approve_message() → request_sign_and_return_id()
  FUTURE SIGN (Gov):   Phase 1: request_future_sign() → Phase 2: request_sign_with_partial...()
```

---

## 2. Move.toml Setup

```toml
[package]
name = "my_ika_project"
version = "0.0.1"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }
Ika = { local = "path/to/ika/packages/deployed_contracts/testnet/ika" }
IkaDWallet2pcMpc = { local = "path/to/ika/packages/deployed_contracts/testnet/ika_dwallet_2pc_mpc" }

[addresses]
my_ika_project = "0x0"
```

### Published Package Addresses

| Network  | Package                   | Address |
|----------|---------------------------|---------|
| Testnet  | `ika_dwallet_2pc_mpc` v2  | `0x6573a6c13daf26a64eb8a37d3c7a4391b353031e223072ca45b1ff9366f59293` |
| Testnet  | `ika_common`              | `0x96fc75633b6665cf84690587d1879858ff76f88c10c945e299f90bf4e0985eb0` |
| Testnet  | `ika_system` v2           | `0xde05f49e5f1ee13ed06c1e243c0a8e8fe858e1d8689476fdb7009af8ddc3c38b` |
| Mainnet  | `ika_dwallet_2pc_mpc` v2  | `0x23b5bd96051923f800c3a2150aacdcdd8d39e1df2dce4dac69a00d2d8c7f7e77` |
| Mainnet  | `ika_system` v2           | `0xd69f947d7ee6f224dd0dd31ec3ec30c0dd0f713a1de55d564e8e98910c4f9553` |

### Coordinator Shared Object ID

| Network  | DWalletCoordinator ID |
|----------|-----------------------|
| Testnet  | `0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc` |
| Mainnet  | `0x5ea59bce034008a006425df777da925633ef384ce25761657ea89e2a08ec75f3` |

---

## 3. Core Types and Imports

### Essential Imports

```move
use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{
    coordinator::DWalletCoordinator,
    coordinator_inner::{
        DWalletCap,
        UnverifiedPresignCap,
        VerifiedPresignCap,
        UnverifiedPartialUserSignatureCap,
        VerifiedPartialUserSignatureCap,
        MessageApproval,
        ImportedKeyDWalletCap,
        ImportedKeyMessageApproval
    },
    sessions_manager::SessionIdentifier
};
use sui::{balance::Balance, coin::Coin, sui::SUI};
```

### Type Summary

| Type | Abilities | Description |
|------|-----------|-------------|
| `DWalletCap` | `key, store` | Primary signing authority. Owns a dWallet. Never lose this. |
| `ImportedKeyDWalletCap` | `key, store` | Same for imported-key dWallets. |
| `UnverifiedPresignCap` | `key` | Presign awaiting network completion. Storable in pool. |
| `VerifiedPresignCap` | `drop` | Verified presign, consumed once during signing. |
| `UnverifiedPartialUserSignatureCap` | `key` | Partial signature stored during future sign Phase 1. |
| `VerifiedPartialUserSignatureCap` | `drop` | Verified partial signature, consumed in Phase 2. |
| `MessageApproval` | `drop` | Hot-potato auth to sign a specific message. Use or discard. |
| `ImportedKeyMessageApproval` | `drop` | Same for imported-key dWallets. |
| `SessionIdentifier` | — | Unique per-operation. Prevents replay attacks. |

### Standard Contract Structure

```move
public struct MyProtocol has key, store {
    id: UID,
    dwallet_cap: DWalletCap,
    presigns: vector<UnverifiedPresignCap>,
    ika_balance: Balance<IKA>,
    sui_balance: Balance<SUI>,
    dwallet_network_encryption_key_id: ID,
}
```

---

## 4. Cryptographic Constants

### Curves

```move
const SECP256K1: u32 = 0;  // Bitcoin, Ethereum
const SECP256R1: u32 = 1;  // WebAuthn, Apple Secure Enclave
const ED25519:   u32 = 2;  // Solana, Substrate
const RISTRETTO: u32 = 3;  // Privacy-preserving
```

### Signature Algorithms (relative to curve)

```move
// SECP256K1
const ECDSA_SECP256K1: u32 = 0;
const TAPROOT:         u32 = 1;
// SECP256R1
const ECDSA_SECP256R1: u32 = 0;
// ED25519
const ED_DSA: u32 = 0;
// RISTRETTO
const SCHNORRKEL_SUBSTRATE: u32 = 0;
```

### Hash Schemes (relative to curve + algorithm)

```move
// SECP256K1 + ECDSA
const KECCAK256:     u32 = 0;  // Ethereum
const SHA256:        u32 = 1;
const DOUBLE_SHA256: u32 = 2;  // Bitcoin

// SECP256K1 + Taproot
const SHA256: u32 = 0;

// ED25519
const SHA512: u32 = 0;
```

**Bitcoin Taproot**: `curve=0, algorithm=1, hash=0`  
**Ethereum ECDSA**: `curve=0, algorithm=0, hash=0`  
**Bitcoin ECDSA**: `curve=0, algorithm=0, hash=2`

---

## 5. Session Management

Every protocol operation requires a unique `SessionIdentifier`. Prevents replay attacks and correlates requests with network responses.

### Recommended Pattern

```move
// Uses Sui's built-in randomness — simplest and most reliable
let session = coordinator.register_session_identifier(
    ctx.fresh_object_address().to_bytes(),
    ctx,
);
```

### Helper Function (add to every contract)

```move
fun random_session(
    coordinator: &mut DWalletCoordinator,
    ctx: &mut TxContext,
): SessionIdentifier {
    coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(),
        ctx,
    )
}
```

### Function Signature

```move
public fun register_session_identifier(
    self: &mut DWalletCoordinator,
    bytes: vector<u8>,   // Must be globally unique
    ctx: &mut TxContext,
): SessionIdentifier
```

---

## 6. Payment Handling

All operations require dual fees: `Coin<IKA>` (protocol fee) + `Coin<SUI>` (gas).

### Standard Payment Pattern

Store fees as `Balance<T>` (not `Coin<T>`) to avoid ownership issues. Withdraw-all → use → return remainder:

```move
fun withdraw_payment_coins(
    self: &mut MyProtocol,
    ctx: &mut TxContext,
): (Coin<IKA>, Coin<SUI>) {
    let ika = self.ika_balance.withdraw_all().into_coin(ctx);
    let sui = self.sui_balance.withdraw_all().into_coin(ctx);
    (ika, sui)
}

fun return_payment_coins(self: &mut MyProtocol, ika: Coin<IKA>, sui: Coin<SUI>) {
    self.ika_balance.join(ika.into_balance());
    self.sui_balance.join(sui.into_balance());
}
```

### Complete Treasury Module (Official Payment Example)

```move
module my_protocol::treasury;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{
    coordinator::DWalletCoordinator,
    coordinator_inner::{DWalletCap, UnverifiedPresignCap},
    sessions_manager::SessionIdentifier
};
use sui::{balance::Balance, coin::Coin, sui::SUI};

public struct Treasury has key, store {
    id: UID,
    dwallet_cap: DWalletCap,
    presigns: vector<UnverifiedPresignCap>,
    ika_balance: Balance<IKA>,
    sui_balance: Balance<SUI>,
    dwallet_network_encryption_key_id: ID,
}

public fun add_ika_balance(self: &mut Treasury, coin: Coin<IKA>) {
    self.ika_balance.join(coin.into_balance());
}

public fun add_sui_balance(self: &mut Treasury, coin: Coin<SUI>) {
    self.sui_balance.join(coin.into_balance());
}

public fun ika_balance(self: &Treasury): u64 { self.ika_balance.value() }
public fun sui_balance(self: &Treasury): u64 { self.sui_balance.value() }

public fun add_presign(
    self: &mut Treasury,
    coordinator: &mut DWalletCoordinator,
    ctx: &mut TxContext,
) {
    let (mut ika, mut sui) = self.withdraw_payment_coins(ctx);
    let session = random_session(coordinator, ctx);

    self.presigns.push_back(coordinator.request_global_presign(
        self.dwallet_network_encryption_key_id,
        0, // SECP256K1
        1, // Taproot
        session,
        &mut ika,
        &mut sui,
        ctx,
    ));

    self.return_payment_coins(ika, sui);
}
```

---

## 7. DKG — Creating a dWallet

### Shared dWallet (recommended for Move contracts)

Public user share enables autonomous signing without user interaction.

```move
// From the official Bitcoin multisig example
public fun new_multisig(
    coordinator: &mut DWalletCoordinator,
    mut initial_ika: Coin<IKA>,
    mut initial_sui: Coin<SUI>,
    dwallet_network_encryption_key_id: ID,
    centralized_public_key_share_and_proof: vector<u8>,
    user_public_output: vector<u8>,
    public_user_secret_key_share: vector<u8>,
    session_identifier: vector<u8>,
    members: vector<address>,
    approval_threshold: u64,
    rejection_threshold: u64,
    ctx: &mut TxContext,
) {
    assert!(approval_threshold > 0 && approval_threshold <= members.length(), EInvalidThreshold);
    assert!(rejection_threshold > 0 && rejection_threshold <= members.length(), EInvalidThreshold);

    let members = vec_set::from_keys(members).into_keys(); // deduplicate

    let session = coordinator.register_session_identifier(session_identifier, ctx);

    let (dwallet_cap, _) = coordinator.request_dwallet_dkg_with_public_user_secret_key_share(
        dwallet_network_encryption_key_id,
        constants::curve!(),                    // 0 = SECP256K1
        centralized_public_key_share_and_proof,
        user_public_output,
        public_user_secret_key_share,
        option::none(),
        session,
        &mut initial_ika,
        &mut initial_sui,
        ctx,
    );

    let multisig = Multisig {
        id: object::new(ctx),
        dwallet_cap,
        members,
        approval_threshold,
        rejection_threshold,
        presigns: vector::empty(),
        ika_balance: initial_ika.into_balance(),
        sui_balance: initial_sui.into_balance(),
        dwallet_network_encryption_key_id,
    };

    transfer::public_share_object(multisig);
}
```

### DKG Variants

| Function | dWallet Type | User Share | Use For |
|----------|-------------|-----------|---------|
| `request_dwallet_dkg_with_public_user_secret_key_share()` | Shared | Public | DAOs, contracts, automated systems |
| `request_dwallet_dkg()` | Zero-trust | Encrypted | Personal wallets, max security |

---

## 8. Presigning

Each signature consumes one presign. Maintain a pool.

### Global Presigns (recommended — use for Taproot/Schnorr/EdDSA)

```move
let presign = coordinator.request_global_presign(
    dwallet_network_encryption_key_id,
    curve_id,          // e.g., 0 = SECP256K1
    signature_alg_id,  // e.g., 1 = TAPROOT
    session,
    &mut ika,
    &mut sui,
    ctx,
);
```

### dWallet-Specific Presigns (use for ECDSA with imported keys)

```move
let presign = coordinator.request_presign(
    dwallet_id,
    dwallet_network_encryption_key_id,
    curve_id,
    signature_alg_id,
    session,
    &mut ika,
    &mut sui,
    ctx,
);
```

### Verify Before Use

```move
// Check network has completed presign
if (coordinator.is_presign_valid(&unverified)) {
    let verified = coordinator.verify_presign_cap(unverified, ctx);
    // use verified...
}
```

### Pool Management with Auto-Replenishment

```move
module my_protocol::managed_signer;

const SECP256K1: u32 = 0;
const TAPROOT: u32 = 1;
const SHA256: u32 = 0;
const MIN_POOL_SIZE: u64 = 3;

public struct ManagedSigner has key, store {
    id: UID,
    dwallet_cap: DWalletCap,
    presigns: vector<UnverifiedPresignCap>,
    ika_balance: Balance<IKA>,
    sui_balance: Balance<SUI>,
    dwallet_network_encryption_key_id: ID,
}

public fun presign_count(self: &ManagedSigner): u64 { self.presigns.length() }

public fun add_presigns(
    self: &mut ManagedSigner,
    coordinator: &mut DWalletCoordinator,
    count: u64,
    ctx: &mut TxContext,
) {
    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);
    let mut i = 0;
    while (i < count) {
        let session = coordinator.register_session_identifier(
            ctx.fresh_object_address().to_bytes(), ctx,
        );
        self.presigns.push_back(coordinator.request_global_presign(
            self.dwallet_network_encryption_key_id,
            SECP256K1, TAPROOT, session,
            &mut ika, &mut sui, ctx,
        ));
        i = i + 1;
    };
    return_payment_coins(self, ika, sui);
}
```

---

## 9. Direct Signing

Single-phase signing — immediate, no governance.

### Approve Message

```move
public fun approve_message(
    self: &mut DWalletCoordinator,
    dwallet_cap: &DWalletCap,
    signature_algorithm: u32,
    hash_scheme: u32,
    message: vector<u8>,
): MessageApproval
```

### Complete Signing Module

```move
module my_protocol::signer;

const TAPROOT: u32 = 1;
const SHA256: u32 = 0;

/// Sign a message directly (single phase)
public fun sign_message(
    self: &mut Signer,
    coordinator: &mut DWalletCoordinator,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    ctx: &mut TxContext,
): ID {
    let (mut ika, mut sui) = self.withdraw_payment_coins(ctx);

    // 1. Pop and verify presign from pool
    let unverified_presign = self.presigns.swap_remove(0);
    let verified_presign = coordinator.verify_presign_cap(unverified_presign, ctx);

    // 2. Create message approval using DWalletCap
    let approval = coordinator.approve_message(
        &self.dwallet_cap,
        TAPROOT,
        SHA256,
        message,
    );

    // 3. Session identifier
    let session = coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(), ctx,
    );

    // 4. Submit sign request
    let sign_id = coordinator.request_sign_and_return_id(
        verified_presign,
        approval,
        message_centralized_signature,
        session,
        &mut ika,
        &mut sui,
        ctx,
    );

    // 5. Auto-replenish pool
    let replenish_session = coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(), ctx,
    );
    self.presigns.push_back(coordinator.request_global_presign(
        self.dwallet_network_encryption_key_id,
        0, TAPROOT, replenish_session,
        &mut ika, &mut sui, ctx,
    ));

    self.return_payment_coins(ika, sui);
    sign_id
}
```

### Sign with Auto-Replenish (Managed Signer Pattern)

```move
public fun sign(
    self: &mut ManagedSigner,
    coordinator: &mut DWalletCoordinator,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    ctx: &mut TxContext,
): ID {
    assert!(self.presigns.length() > 0, ENoPresigns);

    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);

    let unverified = self.presigns.swap_remove(0);
    let verified = coordinator.verify_presign_cap(unverified, ctx);

    let approval = coordinator.approve_message(
        &self.dwallet_cap, TAPROOT, SHA256, message,
    );

    let session = coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(), ctx,
    );

    let sign_id = coordinator.request_sign_and_return_id(
        verified, approval, message_centralized_signature,
        session, &mut ika, &mut sui, ctx,
    );

    // Auto-replenish if pool is low
    if (self.presigns.length() < MIN_POOL_SIZE) {
        let replenish_session = coordinator.register_session_identifier(
            ctx.fresh_object_address().to_bytes(), ctx,
        );
        self.presigns.push_back(coordinator.request_global_presign(
            self.dwallet_network_encryption_key_id,
            SECP256K1, TAPROOT, replenish_session,
            &mut ika, &mut sui, ctx,
        ));
    };

    return_payment_coins(self, ika, sui);
    sign_id
}
```

---

## 10. Future Signing (Two-Phase / Governance)

Separates commitment from execution. Ideal for DAOs and multisig.

### Phase Comparison

| Aspect | Direct Sign | Future Sign |
|--------|------------|-------------|
| Phases | 1 | 2 |
| Governance window | No | Yes (between phases) |
| Timing | Immediate | Delayed |
| Use case | Simple signing | DAO, multisig, timelocks |

### Phase 1 — Commit (Create Partial Signature)

```move
public fun create_sign_request(
    self: &mut Governance,
    coordinator: &mut DWalletCoordinator,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    ctx: &mut TxContext,
): u64 {
    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);

    // Pop and verify presign
    let unverified_presign = self.presigns.swap_remove(0);
    let verified_presign = coordinator.verify_presign_cap(unverified_presign, ctx);

    let session = coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(), ctx,
    );

    // Phase 1: create partial signature commitment
    let partial_cap = coordinator.request_future_sign(
        self.dwallet_cap.dwallet_id(),
        verified_presign,
        message,
        SHA256,
        message_centralized_signature,
        session,
        &mut ika, &mut sui, ctx,
    );

    // Store with request for governance window
    let request_id = self.next_request_id;
    self.next_request_id = request_id + 1;

    let request = SignRequest {
        id: request_id,
        message,
        partial_sig_cap: option::some(partial_cap),
        approvals: 0,
        required_approvals: self.required_approvals,
        voters: table::new(ctx),
        executed: false,
    };
    self.requests.add(request_id, request);

    // Replenish presign pool
    let replenish_session = coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(), ctx,
    );
    self.presigns.push_back(coordinator.request_global_presign(
        self.dwallet_network_encryption_key_id,
        0, TAPROOT, replenish_session,
        &mut ika, &mut sui, ctx,
    ));

    return_payment_coins(self, ika, sui);
    request_id
}
```

### Phase 2 — Execute (Complete After Approval)

```move
public fun execute_request(
    self: &mut Governance,
    coordinator: &mut DWalletCoordinator,
    request_id: u64,
    ctx: &mut TxContext,
): ID {
    let request = self.requests.borrow_mut(request_id);
    assert!(request.approvals >= self.required_approvals, EInsufficientApprovals);
    assert!(!request.executed, EAlreadyExecuted);

    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);

    // Extract and verify partial signature
    let partial_cap = request.partial_sig_cap.extract();
    let verified_partial = coordinator.verify_partial_user_signature_cap(partial_cap, ctx);

    // Create message approval
    let approval = coordinator.approve_message(
        &self.dwallet_cap, TAPROOT, SHA256, request.message,
    );

    let session = coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(), ctx,
    );

    // Complete signature with stored partial
    let sign_id = coordinator.request_sign_with_partial_user_signature_and_return_id(
        verified_partial, approval, session, &mut ika, &mut sui, ctx,
    );

    request.executed = true;
    return_payment_coins(self, ika, sui);
    sign_id
}
```

---

## 11. Key Importing

Import an existing private key (Bitcoin, ETH, etc.) into Ika.

### Import Flow

```
1. PREPARE (TypeScript SDK)
   prepareImportedKeyDWalletVerification()
   → encrypted_user_share_and_proof, user_public_output
         ▼
2. VERIFY ON-CHAIN (Move)
   coordinator.request_imported_key_dwallet_verification()
   → ImportedKeyDWalletCap
         ▼
3. SIGN (different function variants)
   approve_imported_key_message() + request_imported_key_sign_and_return_id()
```

### Import Function

```move
public fun import_key(
    coordinator: &mut DWalletCoordinator,
    dwallet_network_encryption_key_id: ID,
    encrypted_user_share_and_proof: vector<u8>,
    user_public_output: vector<u8>,
    session_identifier: vector<u8>,
    mut ika: Coin<IKA>,
    mut sui: Coin<SUI>,
    ctx: &mut TxContext,
) {
    let session = coordinator.register_session_identifier(session_identifier, ctx);

    let imported_key_cap = coordinator.request_imported_key_dwallet_verification(
        dwallet_network_encryption_key_id,
        0, // SECP256K1
        encrypted_user_share_and_proof,
        user_public_output,
        session,
        &mut ika,
        &mut sui,
        ctx,
    );

    let wallet = ImportedKeyWallet {
        id: object::new(ctx),
        imported_key_cap,
        presigns: vector::empty(),
        ika_balance: ika.into_balance(),
        sui_balance: sui.into_balance(),
        dwallet_network_encryption_key_id,
    };
    transfer::public_share_object(wallet);
}
```

### Imported Key Signing Variants

```move
// Approval — use instead of approve_message()
let approval = coordinator.approve_imported_key_message(
    &self.imported_key_cap,
    signature_algorithm_id,
    hash_scheme_id,
    message,
);

// Sign — use instead of request_sign_and_return_id()
let sign_id = coordinator.request_imported_key_sign_and_return_id(
    verified_presign, approval, message_centralized_signature,
    session, &mut ika, &mut sui, ctx,
);
```

| Operation | DKG dWallet | Imported Key dWallet |
|-----------|-------------|---------------------|
| Cap type | `DWalletCap` | `ImportedKeyDWalletCap` |
| Approval fn | `approve_message()` | `approve_imported_key_message()` |
| Sign fn | `request_sign_and_return_id()` | `request_imported_key_sign_and_return_id()` |
| Presign type | Global (Taproot/EdDSA) | dWallet-specific (ECDSA) |

---

## 12. Converting Zero-Trust → Shared dWallet

Makes user secret key share public. **Irreversible.**

```move
public fun convert_to_shared(
    coordinator: &mut DWalletCoordinator,
    dwallet_id: ID,
    user_secret_key_share: vector<u8>,
    mut ika: Coin<IKA>,
    mut sui: Coin<SUI>,
    ctx: &mut TxContext,
) {
    let session = coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(), ctx,
    );

    coordinator.request_make_dwallet_user_secret_key_shares_public(
        dwallet_id,
        user_secret_key_share,
        session,
        &mut ika,
        &mut sui,
        ctx,
    );

    transfer::public_transfer(ika, ctx.sender());
    transfer::public_transfer(sui, ctx.sender());
}
```

> **Best practice**: If you know you'll need shared mode, use `request_dwallet_dkg_with_public_user_secret_key_share()` from the start.

---

## 13. Bitcoin Multisig — Full Example

Official example from `examples/multisig-bitcoin/contract/` (source: https://github.com/dwallet-labs/ika).

### Data Types

```move
module ika_btc_multisig::multisig;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{
    coordinator::DWalletCoordinator,
    coordinator_inner::{DWalletCap, UnverifiedPresignCap, UnverifiedPartialUserSignatureCap}
};
use sui::{balance::Balance, coin::Coin, sui::SUI, vec_set, table::{Self, Table}};

public struct Multisig has key, store {
    id: UID,
    dwallet_cap: DWalletCap,
    members: vector<address>,
    approval_threshold: u64,
    rejection_threshold: u64,
    presigns: vector<UnverifiedPresignCap>,
    ika_balance: Balance<IKA>,
    sui_balance: Balance<SUI>,
    dwallet_network_encryption_key_id: ID,
}

public struct SignRequest has store {
    id: u64,
    message: vector<u8>,                                        // Bitcoin tx bytes
    partial_sig_cap: Option<UnverifiedPartialUserSignatureCap>, // stored for Phase 2
    approvals: u64,
    rejections: u64,
    voters: Table<address, bool>,                               // irrevocable votes
    executed: bool,
    expires_at: u64,
}
```

### Create Request (Phase 1)

```move
// future sign creates partial signature commitment
let partial_cap = coordinator.request_future_sign(
    self.dwallet_cap.dwallet_id(),
    verified_presign,
    message,
    SHA256,
    message_centralized_signature,
    session,
    &mut ika, &mut sui, ctx,
);
```

### Vote (Irrevocable)

```move
public fun vote(
    self: &mut Multisig,
    request_id: u64,
    approve: bool,
    ctx: &TxContext,
) {
    assert!(self.members.contains(&ctx.sender()), ENotMember);
    let request = self.requests.borrow_mut(request_id);
    assert!(!request.voters.contains(ctx.sender()), EAlreadyVoted);
    // Table ensures votes cannot be modified
    request.voters.add(ctx.sender(), approve);
    if (approve) { request.approvals = request.approvals + 1; }
    else { request.rejections = request.rejections + 1; };
}
```

### Execute Approved Request (Phase 2)

```move
let partial_cap = request.partial_sig_cap.extract();
let verified = coordinator.verify_partial_user_signature_cap(partial_cap, ctx);
let approval = coordinator.approve_message(&self.dwallet_cap, TAPROOT, SHA256, message);
let sign_id = coordinator.request_sign_with_partial_user_signature_and_return_id(
    verified, approval, session, &mut ika, &mut sui, ctx,
);
```

### Security Features
- **Irrevocable votes**: `Table<address, bool>` prevents vote modification
- **Request expiration**: `expires_at` field prevents stale states
- **Threshold validation**: both approval_threshold and rejection_threshold checked at creation
- **Member deduplication**: `vec_set::from_keys(members).into_keys()`
- **Shared ownership**: `transfer::public_share_object(multisig)` — contract holds `DWalletCap`

---

## 14. Coordinator Architecture

`DWalletCoordinator` is a **shared Sui object**. All dWallet operations route through it.

```
SDK → IkaTransaction → Sui Tx → DWalletCoordinator (shared)
                                        │ emits events
                               Ika validators observe → run 2PC-MPC
                                        │ post results back
                               process_checkpoint_message_by_quorum()
```

### Key Files
- `coordinator.move` (27KB) — public entry point
- `coordinator_inner.move` (210KB) — all state and logic
- `sessions_manager.move` (24KB) — session tracking and replay prevention

### Mutable vs Immutable Reference

```move
// Most operations: mutable (modifies coordinator state)
public fun my_operation(coordinator: &mut DWalletCoordinator, ...) { ... }

// Read-only queries
coordinator.has_dwallet(dwallet_id)
coordinator.get_pricing()
coordinator.is_presign_valid(&unverified)
```

### TypeScript: Getting Coordinator ID

```typescript
const coordinatorId = ikaClient.config.objects.dwalletCoordinatorId;
// Pass as tx.object(coordinatorId) to Move functions
```

---

## 15. DAO Treasury Pattern (Full Governance Example)

```move
module my_protocol::dao_treasury;

public struct DAOTreasury has key, store {
    id: UID,
    dwallet_cap: DWalletCap,
    presigns: vector<UnverifiedPresignCap>,
    members: vector<address>,
    voting_threshold: u64,
    proposals: Table<u64, Proposal>,
    next_proposal_id: u64,
    ika_balance: Balance<IKA>,
    sui_balance: Balance<SUI>,
    dwallet_network_encryption_key_id: ID,
}

public struct Proposal has store {
    id: u64,
    message: vector<u8>,
    description: vector<u8>,
    partial_sig_cap: Option<UnverifiedPartialUserSignatureCap>,
    votes_for: u64,
    votes_against: u64,
    voters: Table<address, bool>,
    executed: bool,
}

// Execute a passed proposal
public fun execute_proposal(
    self: &mut DAOTreasury,
    coordinator: &mut DWalletCoordinator,
    proposal_id: u64,
    ctx: &mut TxContext,
): ID {
    let proposal = self.proposals.borrow_mut(proposal_id);
    assert!(proposal.votes_for >= self.voting_threshold, EInsufficientVotes);
    assert!(!proposal.executed, EAlreadyExecuted);

    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);

    let partial_cap = proposal.partial_sig_cap.extract();
    let verified = coordinator.verify_partial_user_signature_cap(partial_cap, ctx);

    let approval = coordinator.approve_message(
        &self.dwallet_cap, TAPROOT, SHA256, proposal.message,
    );

    let session = random_session(coordinator, ctx);

    let sign_id = coordinator.request_sign_with_partial_user_signature_and_return_id(
        verified, approval, session, &mut ika, &mut sui, ctx,
    );

    proposal.executed = true;
    return_payment_coins(self, ika, sui);
    sign_id
}
```

---

## 16. Quick Reference

### Function Index

| Operation | Function |
|-----------|----------|
| DKG (shared) | `coordinator.request_dwallet_dkg_with_public_user_secret_key_share(...)` |
| DKG (zero-trust) | `coordinator.request_dwallet_dkg(...)` |
| Global presign | `coordinator.request_global_presign(...)` |
| Specific presign | `coordinator.request_presign(...)` |
| Verify presign | `coordinator.verify_presign_cap(unverified, ctx)` |
| Check presign ready | `coordinator.is_presign_valid(&unverified)` |
| Approve message | `coordinator.approve_message(&cap, algo, hash, msg)` |
| Sign | `coordinator.request_sign_and_return_id(verified, approval, sig, session, ika, sui, ctx)` |
| Future sign Phase 1 | `coordinator.request_future_sign(dwallet_id, verified, msg, hash, sig, session, ika, sui, ctx)` |
| Verify partial sig | `coordinator.verify_partial_user_signature_cap(partial, ctx)` |
| Sign Phase 2 | `coordinator.request_sign_with_partial_user_signature_and_return_id(...)` |
| Session identifier | `coordinator.register_session_identifier(bytes, ctx)` |
| Import key | `coordinator.request_imported_key_dwallet_verification(...)` |
| Approve imported | `coordinator.approve_imported_key_message(&cap, algo, hash, msg)` |
| Sign imported | `coordinator.request_imported_key_sign_and_return_id(...)` |
| Convert to shared | `coordinator.request_make_dwallet_user_secret_key_shares_public(...)` |

### IKA Token Address (Testnet)
`0x8f66bb433ad1c4f45da565a49199e8bc29787e3c02d60906e07bbd1612acacb6`

---

*Last verified: 2026-02-18 | Source: docs.ika.xyz + github.com/dwallet-labs/ika | SDK: @ika.xyz/sdk v0.2.7*
