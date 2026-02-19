# Ika Network — Use Case Gallery

> What you can build with dWallets. Each use case includes a concept summary, why Ika enables it uniquely, and verified API code stubs from official docs.
> **SDK version:** `@ika.xyz/sdk` v0.2.7+ | **Move imports verified against:** docs.ika.xyz/docs/move-integration

---

## 1. Bitcoin Multisig Wallet (Official Example)

**Source:** https://docs.ika.xyz/docs/move-integration/examples/multisig-bitcoin

The official Ika reference implementation. Members collectively approve Bitcoin transactions using future signing (governance pattern). Features configurable thresholds, irrevocable voting, and auto-replenishing presign pools.

### Flow
```
1. Create Request → request_future_sign() → stores PartialSigCap with request
2. Voting        → members approve/reject (irrevocable, Table-based)
3. Execute       → threshold reached → verify_partial_user_signature_cap() → complete sig
```

### Move Contract

```move
module ika_btc_multisig::multisig;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{
    coordinator::DWalletCoordinator,
    coordinator_inner::{
        DWalletCap, UnverifiedPresignCap, UnverifiedPartialUserSignatureCap
    }
};
use sui::{balance::Balance, coin::Coin, sui::SUI, table::{Self, Table}, vec_set};

const SECP256K1: u32 = 0;
const TAPROOT: u32 = 1;
const SHA256: u32 = 0;

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
    message: vector<u8>,
    partial_sig_cap: Option<UnverifiedPartialUserSignatureCap>,
    approvals: u64,
    rejections: u64,
    voters: Table<address, bool>,
    executed: bool,
    expires_at: u64,
}

// Create multisig using shared dWallet (public user share = autonomous signing)
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
    let members = vec_set::from_keys(members).into_keys(); // deduplicate

    let session = coordinator.register_session_identifier(session_identifier, ctx);
    let (dwallet_cap, _) = coordinator.request_dwallet_dkg_with_public_user_secret_key_share(
        dwallet_network_encryption_key_id,
        SECP256K1,
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

// Phase 1: Propose a Bitcoin transaction (creates partial signature)
public fun create_request(
    self: &mut Multisig,
    coordinator: &mut DWalletCoordinator,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    ctx: &mut TxContext,
): u64 {
    assert!(self.members.contains(&ctx.sender()), ENotMember);
    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);

    let unverified = self.presigns.swap_remove(0);
    let verified = coordinator.verify_presign_cap(unverified, ctx);
    let session = random_session(coordinator, ctx);

    let partial_cap = coordinator.request_future_sign(
        self.dwallet_cap.dwallet_id(),
        verified,
        message,
        SHA256,
        message_centralized_signature,
        session,
        &mut ika, &mut sui, ctx,
    );

    // Auto-replenish presign pool
    let rs = random_session(coordinator, ctx);
    self.presigns.push_back(coordinator.request_global_presign(
        self.dwallet_network_encryption_key_id,
        SECP256K1, TAPROOT, rs, &mut ika, &mut sui, ctx,
    ));

    return_payment_coins(self, ika, sui);
    // ... store request with partial_cap, return request_id
}

// Phase 2: Execute after threshold reached
public fun execute_request(
    self: &mut Multisig, coordinator: &mut DWalletCoordinator,
    request_id: u64, ctx: &mut TxContext,
): ID {
    let request = self.requests.borrow_mut(request_id);
    assert!(request.approvals >= self.approval_threshold, EInsufficientApprovals);
    assert!(!request.executed, EAlreadyExecuted);

    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);
    let partial_cap = request.partial_sig_cap.extract();
    let verified_partial = coordinator.verify_partial_user_signature_cap(partial_cap, ctx);
    let approval = coordinator.approve_message(&self.dwallet_cap, TAPROOT, SHA256, request.message);
    let session = random_session(coordinator, ctx);

    let sign_id = coordinator.request_sign_with_partial_user_signature_and_return_id(
        verified_partial, approval, session, &mut ika, &mut sui, ctx,
    );
    request.executed = true;
    return_payment_coins(self, ika, sui);
    sign_id
}
```

---

## 2. Shared dWallet — DAO Treasury

**Use case:** DAO controls BTC/ETH/SOL assets from Sui. Single governance vote authorizes cross-chain transactions.

Shared dWallets have a **public user share** — the network can sign without user interaction. Perfect for autonomous contract signing.

### TypeScript: Create Shared dWallet

```typescript
import {
  IkaClient, IkaTransaction, UserShareEncryptionKeys,
  prepareDKGAsync, createRandomSessionIdentifier, Curve, Hash, SignatureAlgorithm
} from '@ika.xyz/sdk';
import { Transaction } from '@mysten/sui/transactions';

async function createSharedDWallet(ikaClient: IkaClient, userKeys: UserShareEncryptionKeys) {
  const tx = new Transaction();
  const ikaTx = new IkaTransaction({ ikaClient, transaction: tx, userShareEncryptionKeys: userKeys });

  const identifier = createRandomSessionIdentifier();
  const dkgRequestInput = await prepareDKGAsync(ikaClient, Curve.SECP256K1, userKeys, identifier, signerAddress);
  const encKey = await ikaClient.getLatestNetworkEncryptionKey();

  // requestDWalletDKGWithPublicUserShare → public user share → network can sign autonomously
  const [dwalletCap] = await ikaTx.requestDWalletDKGWithPublicUserShare({
    publicKeyShareAndProof: dkgRequestInput.userDKGMessage,
    publicUserSecretKeyShare: dkgRequestInput.userSecretKeyShare,  // public, not encrypted
    userPublicOutput: dkgRequestInput.userPublicOutput,
    curve: Curve.SECP256K1,
    dwalletNetworkEncryptionKeyId: encKey.id,
    ikaCoin: userIkaCoin,
    suiCoin: tx.splitCoins(tx.gas, [1_000_000]),
    sessionIdentifier: ikaTx.registerSessionIdentifier(identifier),
  });

  tx.transferObjects([dwalletCap], signerAddress);
  await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });

  // Wait for Active state — no user confirmation step needed (unlike zero-trust)
  const active = await ikaClient.getDWalletInParticularState(dwalletId, 'Active', {
    timeout: 30_000, interval: 1_000,
  });
  return active;
}
```

### TypeScript: Sign with Shared dWallet (no user share needed)

```typescript
async function signWithSharedDWallet(ikaClient, dWallet, message: Uint8Array) {
  const presign = await ikaClient.getPresignInParticularState(presignId, 'Completed');
  const tx = new Transaction();
  const ikaTx = new IkaTransaction({ ikaClient, transaction: tx });

  const messageApproval = ikaTx.approveMessage({
    dWalletCap: dWallet.dwallet_cap_id,
    curve: Curve.SECP256K1,
    signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
    hashScheme: Hash.KECCAK256,
    message,
  });

  // Note: no encryptedUserSecretKeyShare needed — network uses public share
  await ikaTx.requestSign({
    dWallet,
    messageApproval,
    hashScheme: Hash.KECCAK256,
    verifiedPresignCap: ikaTx.verifyPresignCap({ presign }),
    presign,
    message,
    signatureScheme: SignatureAlgorithm.ECDSASecp256k1,
    ikaCoin: userIkaCoin,
    suiCoin: tx.splitCoins(tx.gas, [500_000]),
  });

  await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });
  const sig = await ikaClient.getSignInParticularState(signId, Curve.SECP256K1, SignatureAlgorithm.ECDSASecp256k1, 'Completed');
  return Uint8Array.from(sig.state.Completed.signature);
}
```

---

## 3. Zero-Trust dWallet — Personal / Custody

**Use case:** User-controlled signing. User's share is encrypted; they must participate in every signature. Ideal for personal wallets, custody without honeypot risk.

### TypeScript: Full Zero-Trust Flow

```typescript
async function createZeroTrustDWallet(ikaClient: IkaClient) {
  const curve = Curve.SECP256K1;
  const userKeys = await UserShareEncryptionKeys.fromRootSeedKey(rootSeed, curve);

  const tx = new Transaction();
  const ikaTx = new IkaTransaction({ ikaClient, transaction: tx, userShareEncryptionKeys: userKeys });

  await ikaTx.registerEncryptionKey({ curve }); // Register once per user

  const identifier = createRandomSessionIdentifier();
  const dkgInput = await prepareDKGAsync(ikaClient, curve, userKeys, identifier, signerAddress);
  const encKey = await ikaClient.getLatestNetworkEncryptionKey();

  // requestDWalletDKG → encrypted user share → user must participate in signing
  const [dwalletCap] = await ikaTx.requestDWalletDKG({
    curve,
    dkgRequestInput: dkgInput,
    sessionIdentifier: ikaTx.registerSessionIdentifier(identifier),
    dwalletNetworkEncryptionKeyId: encKey.id,
    ikaCoin: userIkaCoin,
    suiCoin: tx.splitCoins(tx.gas, [1_000_000]),
  });

  tx.transferObjects([dwalletCap], signerAddress);
  await suiClient.signAndExecuteTransaction({ transaction: tx, signer: keypair });

  // MUST activate: accept encrypted user share
  const dWallet = await ikaClient.getDWalletInParticularState(dwalletId, 'AwaitingKeyHolderSignature');
  const acceptTx = new Transaction();
  const acceptIkaTx = new IkaTransaction({ ikaClient, transaction: acceptTx, userShareEncryptionKeys: userKeys });
  await acceptIkaTx.acceptEncryptedUserShare({
    dWallet,
    encryptedUserSecretKeyShareId: encryptedShareId,
    userPublicOutput: new Uint8Array(dWallet.state.AwaitingKeyHolderSignature?.public_output),
  });
  await suiClient.signAndExecuteTransaction({ transaction: acceptTx, signer: keypair });
}
```

---

## 4. Future Signing — Governance Workflow

**Use case:** Governance must approve a transaction before the signature is completed. Separates "commit to message" (Phase 1) from "execute" (Phase 2).

When to use:
- DAO proposals require voting before execution
- Multi-party approval workflows
- Delayed / timelocked execution

### Move: Complete Governance Contract

```move
module my_protocol::governance;

use ika_dwallet_2pc_mpc::{
    coordinator::DWalletCoordinator,
    coordinator_inner::{
        DWalletCap, UnverifiedPresignCap,
        UnverifiedPartialUserSignatureCap, MessageApproval
    }
};

const TAPROOT: u32 = 1;
const SHA256: u32 = 0;

public struct Governance has key, store {
    id: UID,
    dwallet_cap: DWalletCap,
    presigns: vector<UnverifiedPresignCap>,
    requests: Table<u64, SignRequest>,
    next_request_id: u64,
    required_approvals: u64,
    ika_balance: Balance<IKA>,
    sui_balance: Balance<SUI>,
    dwallet_network_encryption_key_id: ID,
}

public struct SignRequest has store {
    message: vector<u8>,
    partial_sig_cap: Option<UnverifiedPartialUserSignatureCap>,
    approvals: u64,
    executed: bool,
}

// Phase 1: Commit — creates partial signature tied to the exact message
public fun create_sign_request(
    self: &mut Governance,
    coordinator: &mut DWalletCoordinator,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    ctx: &mut TxContext,
): u64 {
    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);
    let unverified = self.presigns.swap_remove(0);
    let verified = coordinator.verify_presign_cap(unverified, ctx);
    let session = random_session(coordinator, ctx);

    // request_future_sign: creates PartialSigCap without completing the signature
    let partial_cap = coordinator.request_future_sign(
        self.dwallet_cap.dwallet_id(),
        verified, message, SHA256,
        message_centralized_signature,
        session, &mut ika, &mut sui, ctx,
    );

    let request_id = self.next_request_id;
    self.next_request_id = request_id + 1;
    self.requests.add(request_id, SignRequest {
        message, partial_sig_cap: option::some(partial_cap), approvals: 0, executed: false,
    });
    return_payment_coins(self, ika, sui);
    request_id
}

// Phase 2: Execute — only after sufficient approvals
public fun execute_request(
    self: &mut Governance, coordinator: &mut DWalletCoordinator,
    request_id: u64, ctx: &mut TxContext,
): ID {
    let request = self.requests.borrow_mut(request_id);
    assert!(request.approvals >= self.required_approvals, EInsufficientApprovals);
    assert!(!request.executed, EAlreadyExecuted);

    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);
    let partial_cap = request.partial_sig_cap.extract();
    let verified_partial = coordinator.verify_partial_user_signature_cap(partial_cap, ctx);
    let approval = coordinator.approve_message(&self.dwallet_cap, TAPROOT, SHA256, request.message);
    let session = random_session(coordinator, ctx);

    let sign_id = coordinator.request_sign_with_partial_user_signature_and_return_id(
        verified_partial, approval, session, &mut ika, &mut sui, ctx,
    );
    request.executed = true;
    return_payment_coins(self, ika, sui);
    sign_id
}
```

---

## 5. Key Import — Existing Private Key Migration

**Use case:** Bring an existing private key (Bitcoin, Ethereum, etc.) into the dWallet system without generating a new address.

```typescript
import { prepareImportedKeyDWalletVerification, createRandomSessionIdentifier } from '@ika.xyz/sdk';

// Step 1: Prepare import from existing 32-byte private key
const privateKey = Uint8Array.from(Buffer.from('20255a...', 'hex'));
const sessionId = createRandomSessionIdentifier();
const importInput = await prepareImportedKeyDWalletVerification(
  ikaClient, Curve.SECP256K1, sessionId, signerAddress, userKeys, privateKey,
);

// Step 2: Request verification on-chain
const importedKeyCap = await ikaTx.requestImportedKeyDWalletVerification({
  importDWalletVerificationRequestInput: importInput,
  curve: Curve.SECP256K1,
  signerPublicKey: userKeys.getSigningPublicKeyBytes(),
  sessionIdentifier: createRandomSessionIdentifier(),
  ikaCoin: userIkaCoin,
  suiCoin: tx.splitCoins(tx.gas, [1_000_000]),
});

// Step 3: Accept encrypted share (activates the dWallet)
// Then sign using requestSignWithImportedKey + approveImportedKeyMessage
// Note: Use requestPresign (dWallet-specific) for ECDSA with imported keys
```

**Security caveat:** The original private key still exists outside the dWallet system. If it was previously compromised, that risk persists. DKG-generated dWallets do not have this issue.

---

## 6. Conditional Signing (On-Chain Logic Gates Approval)

**Use case:** Move contract enforces conditions (price threshold, timelock, oracle check) before `approve_message` is called. Condition is evaluated atomically in the same transaction.

```move
module conditional::price_gate;

use ika_dwallet_2pc_mpc::coordinator::{DWalletCoordinator, MessageApproval};

public struct PriceGatedVault has key {
    id: UID,
    dwallet_cap: DWalletCap,
    min_price_usd: u64,
    oracle_feed: ID,
}

public fun conditional_sign(
    coordinator: &mut DWalletCoordinator,
    vault: &mut PriceGatedVault,
    oracle: &PriceOracle,
    message: vector<u8>,
    _ctx: &mut TxContext,
): MessageApproval {
    let current_price = oracle::get_price(oracle, vault.oracle_feed);
    assert!(current_price >= vault.min_price_usd, EPriceNotMet);
    // Approval only issued if condition holds — atomically in same tx
    coordinator.approve_message(&vault.dwallet_cap, 1, 1, message)
}
```

**Other conditions you can encode:** timelock (`tx_context::epoch`), collateral ratio, whitelist check, DAO quorum proof, NFT ownership.

---

## 7. Chain Abstraction — Multi-Chain Wallet

**Use case:** One Sui smart contract controls accounts on every supported chain.

```typescript
async function createUniversalWallet(ikaClient: IkaClient, userKeys: UserShareEncryptionKeys) {
  // SECP256K1: Bitcoin + Ethereum (ECDSA)
  const btcEthWallet = await createSharedDWallet(ikaClient, Curve.SECP256K1);

  // Bitcoin Taproot: SECP256K1 + Taproot algorithm (id=1) + SHA256 (id=0)
  const taprootWallet = await createSharedDWallet(ikaClient, Curve.SECP256K1, SignatureAlgorithm.Taproot);

  // EdDSA: Solana, Cardano, Zcash, Near, Stellar (added Dec 2025)
  const solanaWallet = await createSharedDWallet(ikaClient, Curve.ED25519);

  // Substrate/Polkadot: Schnorrkel
  const dotWallet = await createSharedDWallet(ikaClient, Curve.RISTRETTO);

  return { btcEth: btcEthWallet, taproot: taprootWallet, solana: solanaWallet, dot: dotWallet };
}
```

**Supported curves and algorithms:**

| Curve | Algorithm | Hash | Use Case |
|-------|-----------|------|---------|
| SECP256K1 (0) | ECDSASecp256k1 (0) | KECCAK256 (0) | Ethereum |
| SECP256K1 (0) | ECDSASecp256k1 (0) | DoubleSHA256 (2) | Bitcoin |
| SECP256K1 (0) | Taproot (1) | SHA256 (0) | Bitcoin Taproot |
| SECP256R1 (1) | ECDSASecp256r1 (0) | SHA256 (0) | WebAuthn, Apple SE |
| ED25519 (2) | EdDSA (0) | SHA512 (0) | Solana, Cardano, Near |
| RISTRETTO (3) | SchnorrkelSubstrate (0) | Merlin (0) | Polkadot, Substrate |

---

## 8. Native Bitcoin DeFi (AMM / Lending)

**Use case:** AMM holds `DWalletCap` for a dWallet that controls real BTC UTXOs. LP redemption signs a Bitcoin withdrawal transaction on Sui. No wBTC, no bridge.

```move
module btc_amm::pool;

public fun redeem_lp(
    coordinator: &mut DWalletCoordinator,
    pool: &mut BtcPool,
    lp_token: LPToken,
    recipient_btc_addr: vector<u8>,
    ctx: &mut TxContext,
): ID {
    let amount = calculate_btc_out(&pool, &lp_token);
    burn_lp(lp_token);
    let btc_tx = build_btc_output_tx(pool.utxo_set, recipient_btc_addr, amount);

    // SECP256K1 (0) + Taproot (1) + SHA256 (0) — Bitcoin native signing
    let (mut ika, mut sui) = withdraw_payment_coins(pool, ctx);
    let unverified = pool.presigns.swap_remove(0);
    let verified = coordinator.verify_presign_cap(unverified, ctx);
    let approval = coordinator.approve_message(&pool.dwallet_cap, 1, 0, btc_tx);
    let session = random_session(coordinator, ctx);
    coordinator.request_sign_and_return_id(verified, approval, pool.user_sig, session, &mut ika, &mut sui, ctx)
}
```

**Ecosystem building this:** Native (gonative.cc), Nativerse (nativerse.xyz) for BTC-backed stablecoin.

---

## Quick Reference

| I want to... | Use Case | dWallet Type | Key Pattern |
|--------------|----------|-------------|-------------|
| DAO controls BTC/ETH/SOL | Multi-Chain Treasury (#1/#2) | Shared | Future signing + governance |
| Personal wallet, no custodian | Zero-Trust Personal (#3) | Zero-Trust | User participates in every sig |
| Governance before signing | Future Signing Governance (#4) | Shared | Phase 1 commit, Phase 2 execute |
| Bring existing key into Ika | Key Import (#5) | Imported Key | prepareImportedKeyDWalletVerification |
| Condition-gated signing | Conditional Gate (#6) | Either | Move assert before approve_message |
| One wallet → every chain | Chain Abstraction (#7) | Shared | Multi-curve DWallet creation |
| Native BTC in DeFi | Bitcoin AMM/Lending (#8) | Shared | Taproot signing from AMM contract |

---

*Last verified: 2026-02-18 | SDK: @ika.xyz/sdk v0.2.7+ | EdDSA mainnet: live Dec 2025*
