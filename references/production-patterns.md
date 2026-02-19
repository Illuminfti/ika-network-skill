# Production Patterns — Ika Network

**SDK version:** `@ika.xyz/sdk` v0.2.7+  
**Last verified:** 2026-02-18  
**Source:** docs.ika.xyz/docs/move-integration/integration-patterns/

---

## 1. DWalletCap Key Management

`DWalletCap` controls the dWallet's signing policy. **Losing it freezes the dWallet. Exposing it lets an attacker approve any signing.**

**Option A — Lock in a Move contract (recommended):**
```move
public struct SecureVault has key, store {
    id: UID,
    dwallet_cap: DWalletCap,    // Never leaves this module
    admin: address,
}

// Only callable with governance proof — cap never exposed
public fun sign_with_approval(
    vault: &mut SecureVault,
    coordinator: &mut DWalletCoordinator,
    message: vector<u8>,
    _governance_cap: GovernanceApprovalCap,
    ctx: &mut TxContext,
): MessageApproval {
    coordinator.approve_message(&vault.dwallet_cap, TAPROOT, SHA256, message)
}
```

**Option B — Multisig ownership (TypeScript):**
```typescript
import { MultiSigPublicKey } from '@mysten/sui/multisig';
const multiSigPubKey = MultiSigPublicKey.fromPublicKeys({
  threshold: 2,
  publicKeys: [
    { publicKey: key1.getPublicKey(), weight: 1 },
    { publicKey: key2.getPublicKey(), weight: 1 },
    { publicKey: key3.getPublicKey(), weight: 1 },
  ],
});
// Transfer DWalletCap to multiSigPubKey.toSuiAddress() → requires 2-of-3
```

**Option C — HSM-backed hot wallet:** Move DWalletCap to an address secured by AWS KMS or GCP HSM. Single key but hardware-protected.

---

## 2. Payment Handling Pattern (Treasury Module)

**Source:** docs.ika.xyz/docs/move-integration/core-concepts/payment-handling

All dWallet operations require fees in both IKA and SUI. The correct pattern: store as `Balance<T>`, withdraw-all before ops, return remainder after.

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
    ika_balance: Balance<IKA>,    // Store as Balance, not Coin
    sui_balance: Balance<SUI>,
    dwallet_network_encryption_key_id: ID,
}

// Top-up functions (called by admin/users)
public fun add_ika_balance(self: &mut Treasury, coin: Coin<IKA>) {
    self.ika_balance.join(coin.into_balance());
}
public fun add_sui_balance(self: &mut Treasury, coin: Coin<SUI>) {
    self.sui_balance.join(coin.into_balance());
}

// Query balances
public fun ika_balance(self: &Treasury): u64 { self.ika_balance.value() }
public fun sui_balance(self: &Treasury): u64 { self.sui_balance.value() }

// Internal: withdraw-all before operations
fun withdraw_payment_coins(self: &mut Treasury, ctx: &mut TxContext): (Coin<IKA>, Coin<SUI>) {
    let ika = self.ika_balance.withdraw_all().into_coin(ctx);
    let sui = self.sui_balance.withdraw_all().into_coin(ctx);
    (ika, sui)
}

// Internal: return remainder after operations (prevents burning)
fun return_payment_coins(self: &mut Treasury, ika: Coin<IKA>, sui: Coin<SUI>) {
    self.ika_balance.join(ika.into_balance());
    self.sui_balance.join(sui.into_balance());
}
```

**Key rules:**
1. Store balances as `Balance<T>` — not as `Coin<T>` — to avoid ownership conflicts
2. Always withdraw all → pass as `&mut Coin<T>` → return remainder
3. Never discard unused coins — always `return_payment_coins` after every op
4. Fund via explicit `add_ika_balance` / `add_sui_balance` admin functions

**Fee structure (approximate):**
| Operation | SUI gas | IKA protocol fee |
|-----------|---------|-----------------|
| `requestDWalletDKG` | ~0.05–0.2 SUI | Required (varies) |
| `requestGlobalPresign` | ~0.01–0.05 SUI | Required (varies) |
| `requestSign` | ~0.02–0.08 SUI | Required (varies) |
| Object transfers | ~0.005 SUI | None |

IKA fees are dynamically priced by operation type (ECDSA vs EdDSA vs Schnorr). Dry-run to estimate before submitting.

---

## 3. Session Management Pattern

**Source:** docs.ika.xyz/docs/move-integration/core-concepts/session-management

Every protocol operation (DKG, presign, sign, future sign) requires a unique `SessionIdentifier`. Prevents duplicate operations and replay attacks.

### Recommended Pattern: Fresh Object Address

```move
// Create reusable helper in every contract
fun random_session(
    coordinator: &mut DWalletCoordinator,
    ctx: &mut TxContext,
): SessionIdentifier {
    coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(),  // Guaranteed unique per tx
        ctx,
    )
}

// Usage in any operation:
public fun add_presign(self: &mut MyContract, coordinator: &mut DWalletCoordinator, ctx: &mut TxContext) {
    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);
    let session = random_session(coordinator, ctx);    // ← Create just before use
    self.presigns.push_back(coordinator.request_global_presign(
        self.dwallet_network_encryption_key_id,
        SECP256K1, TAPROOT, session, &mut ika, &mut sui, ctx,
    ));
    return_payment_coins(self, ika, sui);
}
```

### TypeScript: Pass Session Bytes from Client

```typescript
import { createRandomSessionIdentifier } from '@ika.xyz/sdk';

// Generate unique session bytes on client side
const sessionBytes = createRandomSessionIdentifier();  // 32 random bytes

const tx = new Transaction();
const ikaTx = new IkaTransaction({ ikaClient, transaction: tx });
const sessionId = ikaTx.registerSessionIdentifier(sessionBytes);

// Pass to Move function
tx.moveCall({
  target: `${packageId}::my_module::my_operation`,
  arguments: [tx.object(coordinatorId), sessionId, /* ... */],
});
```

### Session Error Reference

| Error | Cause | Fix |
|-------|-------|-----|
| Session already exists | Reusing session bytes | Generate fresh bytes each call |
| Invalid session | Session not registered | Call `register_session_identifier` first |

**Rules:**
- Create session identifier **immediately before** the operation that uses it
- Each operation requires its own session — never reuse
- Use `ctx.fresh_object_address().to_bytes()` in Move for simplicity
- If passing from TypeScript, use `createRandomSessionIdentifier()`

---

## 4. Presign Pool Management

**Source:** docs.ika.xyz/docs/move-integration/integration-patterns/presign-pool-management

Presigns are consumed on signing — one presign per signature. Maintain a pool for continuous operation.

### Complete ManagedSigner Module

```move
module my_protocol::managed_signer;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{
    coordinator::DWalletCoordinator,
    coordinator_inner::{DWalletCap, UnverifiedPresignCap}
};
use sui::{balance::Balance, coin::Coin, sui::SUI};

const SECP256K1: u32 = 0;
const TAPROOT: u32 = 1;
const SHA256: u32 = 0;
const MIN_POOL_SIZE: u64 = 3;

public struct ManagedSigner has key, store {
    id: UID,
    dwallet_cap: DWalletCap,
    presigns: vector<UnverifiedPresignCap>,  // The pool
    ika_balance: Balance<IKA>,
    sui_balance: Balance<SUI>,
    dwallet_network_encryption_key_id: ID,
}

// === Pool Management ===

public fun presign_count(self: &ManagedSigner): u64 { self.presigns.length() }

/// Add N presigns to the pool (call this proactively)
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
            SECP256K1, TAPROOT, session, &mut ika, &mut sui, ctx,
        ));
        i = i + 1;
    };
    return_payment_coins(self, ika, sui);
}

/// Sign a message + auto-replenish pool if below MIN_POOL_SIZE
public fun sign(
    self: &mut ManagedSigner,
    coordinator: &mut DWalletCoordinator,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    ctx: &mut TxContext,
): ID {
    assert!(self.presigns.length() > 0, ENoPresigns);
    let (mut ika, mut sui) = withdraw_payment_coins(self, ctx);

    // 1. Pop presign from pool
    let unverified = self.presigns.swap_remove(0);
    let verified = coordinator.verify_presign_cap(unverified, ctx);

    // 2. Approve message + create session
    let approval = coordinator.approve_message(&self.dwallet_cap, TAPROOT, SHA256, message);
    let session = coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(), ctx,
    );

    // 3. Request signature
    let sign_id = coordinator.request_sign_and_return_id(
        verified, approval, message_centralized_signature, session, &mut ika, &mut sui, ctx,
    );

    // 4. Auto-replenish if pool is low
    if (self.presigns.length() < MIN_POOL_SIZE) {
        let rs = coordinator.register_session_identifier(
            ctx.fresh_object_address().to_bytes(), ctx,
        );
        self.presigns.push_back(coordinator.request_global_presign(
            self.dwallet_network_encryption_key_id,
            SECP256K1, TAPROOT, rs, &mut ika, &mut sui, ctx,
        ));
    };

    return_payment_coins(self, ika, sui);
    sign_id
}
```

### Presign Type Selection

| Signature Algorithm | Presign Function | Curve |
|--------------------|--------------------|-------|
| Taproot (BTC) | `request_global_presign` | SECP256K1 |
| Schnorr | `request_global_presign` | SECP256K1 |
| EdDSA (Solana) | `request_global_presign` | ED25519 |
| SchnorrkelSubstrate | `request_global_presign` | RISTRETTO |
| ECDSASecp256k1 | `request_global_presign` | SECP256K1 |
| ECDSASecp256k1 (imported key) | `request_presign` (dWallet-specific) | SECP256K1 |

### Pool Management Rules

- **Verify before use:** Call `coordinator.is_presign_valid(&unverified)` or `verify_presign_cap()` — network processes presigns async, fails if not ready
- **Don't overconsume:** Each presign is consumed once, can't be reused
- **Pool size:** Keep `MIN_POOL_SIZE >= 3` for burst tolerance
- **Replenish timing:** Replenish inline (after each sign) and via batch `add_presigns()` calls from TypeScript

---

## 5. Retry and Idempotency

| Operation | Safe to Retry? | Notes |
|-----------|----------------|-------|
| `ikaClient.initialize()` | ✅ Yes | Read-only |
| `ikaClient.getLatestNetworkEncryptionKey()` | ✅ Yes | Read-only |
| `prepareDKGAsync()` | ✅ Yes | Pure WASM crypto |
| DKG transaction | ⚠️ Check first | Query owned objects — dWallet may already exist |
| `requestSign` transaction | ⚠️ Check first | Duplicate requests produce duplicate outputs |
| `requestReEncryptUserShareFor` | ❌ Wait | Don't retry until previous confirmed failed |

```typescript
// Safe DKG — check before submitting
async function createDWalletIdempotent(ikaClient: IkaClient, owner: string): Promise<string> {
  const existing = await ikaClient.getOwnedDWalletCaps(owner);
  if (existing.dWalletCaps.length > 0) {
    return existing.dWalletCaps[0].id;
  }
  return submitDKGTransaction(ikaClient);
}
```

---

## 6. Event-Driven Architecture

**Don't poll. Subscribe.** Protocol completion signalled via Sui events.

```typescript
// Wait for sign completion via event subscription
async function waitForSignature(
  suiClient: SuiClient, packageId: string, sessionId: string, timeoutMs = 90_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const sub = suiClient.subscribeEvent({
      filter: { MoveEventType: `${packageId}::coordinator_inner::SignOutputEvent` },
      onMessage: async (event) => {
        if (Date.now() > deadline) { (await sub)(); reject(new Error('Sign timed out')); return; }
        const d = event.parsedJson as { session_id: string; signature: number[] };
        if (d.session_id === sessionId) {
          (await sub)();
          resolve(Buffer.from(d.signature).toString('hex'));
        }
      },
    });
  });
}

// Alternative: SDK polling helper (for simpler cases)
const sign = await ikaClient.getSignInParticularState(
  signId, Curve.SECP256K1, SignatureAlgorithm.ECDSASecp256k1, 'Completed',
  { timeout: 60_000, interval: 2_000 },
);
```

---

## 7. Gas Estimation and Rate Limiting

```typescript
// Dry-run before submitting to get exact gas
const dryRun = await suiClient.dryRunTransactionBlock({
  transactionBlock: await tx.build({ client: suiClient }),
});
console.log('Gas needed:', dryRun.effects.gasUsed);
tx.setGasBudget(200_000_000);  // 0.2 SUI — generous for DKG
```

**RPC endpoints (don't use default rate-limited Sui RPC):**
```typescript
const RPC = {
  testnet: 'https://sui-testnet-rpc.publicnode.com',
  mainnet: 'https://ikafn-on-sui-2-mainnet.ika-network.net/',
  localnet: 'http://127.0.0.1:9000',
};
```

**Rate limit mitigation:** If submitting >10 signing requests/min, use a concurrency-limited queue (max 3 parallel). Add 500ms sleep between retries on 429 responses.

---

## 8. Monitoring

| Metric | Alert Condition |
|--------|----------------|
| DKG success rate | <95% over 10 min |
| DKG p95 completion | >60 seconds |
| Sign p95 completion | >30 seconds |
| Sign event missing | After 90s timeout |
| RPC 429 rate | >5% of calls in 5 min |
| IKA balance on fee account | <10 IKA |
| SUI gas balance | <0.5 SUI |
| Presign pool size | <MIN_POOL_SIZE (alert to replenish) |
| DWalletCap owner | Alert if not expected address |

```typescript
const start = Date.now();
try {
  const result = await signWithPresign(ikaClient, request);
  metrics.histogram('dwallet.sign.duration_ms', Date.now() - start);
  metrics.increment('dwallet.sign.success');
} catch (err) {
  metrics.increment('dwallet.sign.failure', { error: err.constructor.name });
  throw err;
}
```

---

## 9. Failsafe Patterns

**If DKG hangs:** Race with 120s timeout. On timeout, **check if the dWallet was created on-chain before retrying** — tx may have succeeded but event listener failed.

**If signing hangs:** Query sign object before declaring failure:

```typescript
async function robustSign(ikaClient: IkaClient, sessionId: string, signId: string) {
  try {
    return await signWithTimeout(ikaClient, signId, 90_000);
  } catch (err) {
    if (!err.message.includes('timed out')) throw err;
    // Check if signature was already produced
    try {
      const sign = await ikaClient.getSign(signId, 'SECP256K1', 'ECDSASecp256k1');
      if (sign.state.$kind === 'Completed') return sign.state.Completed.signature;
    } catch (_) { /* not found */ }
    throw err;  // Genuinely failed
  }
}
```

**Presign pool exhausted:** Fail fast at the Move level (`assert!(presigns.length() > 0, ENoPresigns)`) and surface a clear error to the TypeScript caller. Schedule a `add_presigns()` batch call to replenish.

---

## 10. Key Share Backup and Recovery

The `userSecretKeyShare` is generated client-side during DKG. **The Ika network cannot recover it.** If lost, the zero-trust dWallet cannot sign.

```typescript
// Recover from backup (derive from same root seed):
const keys = await UserShareEncryptionKeys.fromRootSeedKey(savedRootSeed, Curve.SECP256K1);

// Or from raw share bytes:
const keys = await UserShareEncryptionKeys.fromShareEncryptionKeysBytes(keyShareBytes, Curve.SECP256K1);
```

**Storage options:**
| Option | Security | Notes |
|--------|----------|-------|
| Derived from user's wallet key | High | No separate backup needed if wallet key is backed up |
| Encrypted database column | Medium | User-specific encryption key required |
| E2E encrypted cloud storage | Medium | Zero-knowledge to provider |
| Shamir secret sharing | High | Split across recovery contacts |
| Plaintext / server logs | ❌ Never | Immediate compromise |

**Transfer / social recovery:** `requestReEncryptUserShareFor` re-encrypts the share to a new key without exposing the plaintext share to the network. Enable this for account recovery flows.

---

## 11. Upgrade Paths

**Deprecated v1 API — never use:**
```typescript
// ❌ Deprecated — will throw confusing errors:
ikaTx.requestDWalletDKGFirstRoundAsync(...)
ikaTx.requestDWalletDKGFirstRound(...)
ikaTx.requestDWalletDKGSecondRound(...)

// ✅ Current v2 API:
await prepareDKGAsync(ikaClient, curve, userKeys, identifier, signerAddress);
await ikaTx.requestDWalletDKG({ dkgRequestInput, sessionIdentifier, ... });
```

**SDK update checklist:**
1. Check release notes for breaking changes in `@ika.xyz/sdk`
2. `pnpm update @ika.xyz/sdk`
3. Verify `getNetworkConfig()` returns correct package IDs (change on network upgrades)
4. Smoke test against testnet before promoting to mainnet
5. Check that coordinator object IDs haven't changed

---

## 12. Localnet / Testnet / Mainnet Config

| | Localnet | Testnet | Mainnet |
|--|----------|---------|---------|
| RPC | `http://127.0.0.1:9000` | `https://sui-testnet-rpc.publicnode.com` | `https://ikafn-on-sui-2-mainnet.ika-network.net/` |
| Config | `ika_config.json` (local file) | `getNetworkConfig('testnet')` | `getNetworkConfig('mainnet')` |
| IKA tokens | Auto in tests | `https://faucet.ika.xyz/` (swap SUI→IKA) | Real tokens |
| DKG speed | ~5s | ~30–90s | ~30–90s |
| Network resets | Never | Possible | No |

```typescript
import { getNetworkConfig } from '@ika.xyz/sdk';
import * as fs from 'fs';

export function getConfig(network: 'localnet' | 'testnet' | 'mainnet') {
  if (network === 'localnet') return JSON.parse(fs.readFileSync('ika_config.json', 'utf8'));
  return getNetworkConfig(network);
}
```

**Localnet setup** (requires cloning dwallet-labs/ika repo — core 2pc-mpc library is private):
```bash
# Terminal 1: Sui localnet
RUST_LOG="off,sui_node=info" sui start --with-faucet --force-regenesis --epoch-duration-ms 1000000000000000

# Terminal 2: Ika localnet
cargo run --bin ika --release --no-default-features -- start
```

---

*Update this file when the SDK version changes. Note the version at the top.*
