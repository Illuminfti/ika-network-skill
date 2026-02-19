# Ika Network SDK — Error Catalogue

> SDK: `@ika.xyz/sdk` v0.2.7 | Verified: 2026-02-18  
> Sources: DevEx audit (06-devex-report.md), SDK source (errors.ts), Move contracts, live testnet

---

## SDK Error Class Hierarchy

From `sdk/typescript/src/client/errors.ts` (verified via ground-truth-api.md introspection):

```typescript
class NetworkError extends Error { }        // RPC / network failures
class ObjectNotFoundError extends Error { } // Object missing on-chain
class InvalidObjectError extends Error { }  // Object found but invalid type/state
```

These are the **only three** custom error classes. All others are generic `Error` or native.

---

## VERIFIED ERRORS (DevEx Audit — Real, Reproduced)

### Error 1: `NetworkError: Failed to fetch encryption keys / CAUSE: Unexpected status code: 429`

**Class:** `NetworkError`  
**Trigger:** Default testnet RPC (`https://fullnode.testnet.sui.io`) rate-limits the burst of sequential
calls fired by `getLatestNetworkEncryptionKey()`. The SDK makes 5–10+ sequential calls:
`getDynamicFields(encryption_keys_table)` → `getObject(keyId)` per key → paginated reconfig outputs.

**Functions affected:**
- `IkaClient.getLatestNetworkEncryptionKey()`
- `IkaClient.getAllNetworkEncryptionKeys()`
- `IkaClient.getProtocolPublicParameters()`
- Any `IkaClient.getDWalletInParticularState()` during polling

**Fix:**
```typescript
// ❌ Default — hits 429 within seconds on multi-call ops
const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });

// ✅ Use publicnode — rate-limit tolerant for SDK burst patterns
const suiClient = new SuiClient({ url: 'https://sui-testnet-rpc.publicnode.com' });
const ikaClient = new IkaClient({
  suiClient,
  config: getNetworkConfig('testnet'),
  cache: true,  // ← reduces repeat RPC calls
});
```

**Prevention:** Never use bare `getFullnodeUrl('testnet')` for SDK operations. Always `cache: true`.

---

### Error 2: `UserShareEncryptionKeys.create is not a function`

**Class:** Native `TypeError`  
**Trigger:** No `.create()` method exists. Constructor is private. Factory method is `fromRootSeedKey`.

**Functions affected:** `UserShareEncryptionKeys` construction

**Fix:**
```typescript
import { randomBytes } from '@noble/hashes/utils';

// ❌ Wrong — method doesn't exist
const keys = await UserShareEncryptionKeys.create({ keypair, curve: Curve.SECP256K1 });
// ❌ Wrong — constructor is private
const keys = new UserShareEncryptionKeys({ keypair, curve: Curve.SECP256K1 });

// ✅ Correct — only public creation path
const rootSeed = randomBytes(32);  // 32-byte seed — SAVE THIS
const keys = await UserShareEncryptionKeys.fromRootSeedKey(rootSeed, Curve.SECP256K1);

// ✅ Serialize/restore across sessions
const bytes = keys.toShareEncryptionKeysBytes();
const restored = UserShareEncryptionKeys.fromShareEncryptionKeysBytes(bytes);
```

**Prevention:** `fromRootSeedKey(seed, curve)` is the entry point. Persist `rootSeed` — it's the user's secret material. Losing it means losing access to the dWallet.

---

### Error 3: `requestDWalletDKGFirstRoundAsync is deprecated. Use requestDWalletDKGFirstRound instead.`

**Class:** Native `Error` (thrown at runtime, not compile time)  
**Trigger:** All v1 DKG methods are deprecated and now throw at runtime. The error message itself references another deprecated method — a dead end.

**Deprecated methods (all throw):**
- `requestDWalletDKGFirstRoundAsync()` — throws with message pointing to another deprecated fn
- `requestDWalletDKGFirstRound()` — deprecated
- `requestDWalletDKGSecondRound()` — deprecated  
- `prepareDKGSecondRound()` — deprecated
- `prepareDKGSecondRoundAsync()` — deprecated

**Fix:**
```typescript
// ❌ All of these abort:
await ikaTx.requestDWalletDKGFirstRoundAsync(...);
ikaTx.requestDWalletDKGFirstRound(...);

// ✅ Single-call v2 API (current):
const sessionIdentifier = createRandomSessionIdentifier();
const dkgInput = await prepareDKGAsync(
  ikaClient,
  Curve.SECP256K1,
  userShareEncryptionKeys,
  sessionIdentifier,    // ← bytesToHash, NOT the registered object
  signerAddress,
);
const [dWalletCap] = await ikaTx.requestDWalletDKG({
  dkgRequestInput: dkgInput,
  curve: Curve.SECP256K1,
  dwalletNetworkEncryptionKeyId: networkKey.id,
  ikaCoin,
  suiCoin: tx.gas,
  sessionIdentifier: ikaTx.registerSessionIdentifier(sessionIdentifier),
});
```

**Prevention:** Only use `requestDWalletDKG` + `prepareDKGAsync`. No `FirstRound`/`SecondRound` variants.

---

### Error 4: `Too many requests from this client have been sent to the faucet`

**Class:** HTTP 429 from faucet server  
**Trigger:** Sui testnet faucet rate-limits by IP. One address per day per IP.

**Fix:**
```typescript
// Programmatic SUI faucet request:
await fetch('https://faucet.testnet.sui.io/v2/gas', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
});

// If rate-limited: use Sui Discord #faucet channel (higher limits)
// URL: discord.gg/sui → #testnet-faucet channel
```

---

## DKG / STATE MACHINE ERRORS

### Error: `ObjectNotFoundError` — dWallet / DWalletCap not found

**Class:** `ObjectNotFoundError`  
**Trigger:** `DWalletCap` not transferred to user in the DKG tx; consumed in a prior tx; object ID parsed from wrong source; dWallet polled before it reaches required state.

**Fix:**
```typescript
// ✅ Always transfer DWalletCap in the same DKG tx:
const [dWalletCap] = await ikaTx.requestDWalletDKG({ ... });
tx.transferObjects([dWalletCap], signerAddress);  // ← REQUIRED or cap is lost

// ✅ Parse dWalletID from events (not from TransactionResult.objectChanges):
const dkgEvent = result.events?.find(e =>
  e.type.includes('DWalletSessionEvent') && e.type.includes('DWalletDKGRequestEvent')
);
const parsed = SessionsManagerModule.DWalletSessionEvent(
  CoordinatorInnerModule.DWalletDKGRequestEvent
).fromBase64(dkgEvent?.bcs);
const dWalletID = parsed.event_data.dwallet_id;
const encryptedShareId =
  parsed.event_data.user_secret_key_share.Encrypted?.encrypted_user_secret_key_share_id;

// ✅ Poll with state check, not getDWallet():
const dWallet = await ikaClient.getDWalletInParticularState(
  dWalletID, 'AwaitingKeyHolderSignature', { timeout: 300_000, interval: 2000 }
);
```

---

### Error: DKG Timeout — `getDWalletInParticularState` polling timeout

**Class:** Native `Error` (timeout after polling)  
**Trigger:** Ika validators haven't processed the DKG session; session identifier not registered before DKG; invalid network encryption key ID; testnet congestion.

**Fix:**
```typescript
// ✅ Verify tx succeeded before polling:
if (result.effects?.status?.status !== 'success') {
  throw new Error(`DKG tx failed: ${JSON.stringify(result.effects?.status)}`);
}

// ✅ Use generous timeout with backoff (testnet can be slow):
const dWallet = await ikaClient.getDWalletInParticularState(
  dWalletID, 'AwaitingKeyHolderSignature',
  { timeout: 600_000, interval: 3000, maxInterval: 10_000, backoffMultiplier: 1.5 }
);

// ✅ Session identifier — use registerSessionIdentifier(bytes), not createSessionIdentifier():
const sessionId = createRandomSessionIdentifier();
const sessionIdentifier = ikaTx.registerSessionIdentifier(sessionId);
// Pass sessionIdentifier (the Move object) to requestDWalletDKG
// Pass sessionId (the bytes) to prepareDKGAsync as bytesToHash
```

**Polling options type:**
```typescript
interface PollingOptions {
  timeout?: number;           // ms, default 30000
  interval?: number;          // ms, default 1000
  maxInterval?: number;       // ms, default 5000
  backoffMultiplier?: number; // default 1.5
  signal?: AbortSignal;
}
```

---

### Error: `acceptEncryptedUserShare` timing — `user_output_signature undefined`

**Class:** Native `Error` from WASM (`getUserOutputSignature` fails)  
**Trigger:** SDK bug in early v0.2.x builds: `getUserOutputSignature()` called before `AwaitingKeyHolderSignature` state is fully on-chain, OR the dWallet was fetched via `getDWallet()` not `getDWalletInParticularState()`.

**Fix:**
```typescript
// ✅ Always await specific state first:
const awaitingDWallet = await ikaClient.getDWalletInParticularState(
  dWalletID,
  'AwaitingKeyHolderSignature',
  { timeout: 600_000, interval: 2000 }
);

// ✅ Get share ID from DKG event, not from dWallet object fields:
const shareId = parsed.event_data.user_secret_key_share.Encrypted?.encrypted_user_secret_key_share_id;
const userPublicOutput = new Uint8Array(parsed.event_data.user_public_output);

await acceptIkaTx.acceptEncryptedUserShare({
  dWallet: awaitingDWallet,          // ← must be state-polled object
  encryptedUserSecretKeyShareId: shareId,
  userPublicOutput,
});
```

---

## PAYMENT / FEE ERRORS

### Error: `MoveAbort: EInsufficientPayment` / IKA token required

**Class:** Move abort (surfaces as `SuiExecutionError` in TypeScript)  
**Trigger:** Every MPC operation requires `Coin<IKA>` for protocol fees. The coin doesn't need real value on testnet (empty coin works for most ops), but must be the correct type.

**IKA coin type (full format):**
```
Testnet: 0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a::ika::IKA
Mainnet: 0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA
```

**Fix — Testnet (empty coin pattern):**
```typescript
const config = ikaClient.ikaConfig;
const ikaType = `${config.packages.ikaPackage}::ika::IKA`;

// Create zero-value IKA coin (testnet accepts this for most ops)
const ikaCoin = tx.moveCall({
  target: '0x2::coin::zero',
  typeArguments: [ikaType],
  arguments: [],
});

// After operation, destroy the zero coin
tx.moveCall({
  target: '0x2::coin::destroy_zero',
  typeArguments: [ikaType],
  arguments: [ikaCoin],
});
```

**Fix — Mainnet (real IKA):**
```typescript
// 1. Get faucet: https://faucet.ika.xyz/ → swap SUI → IKA
// 2. Fetch coin object:
const coins = await suiClient.getCoins({ owner: address, coinType: ikaType });
const ikaCoin = tx.object(coins.data[0].coinObjectId);
```

---

### Error: `InsufficientGas` / Gas budget too low

**Class:** Sui execution error  
**Trigger:** IKA protocol ops are gas-heavy: large shared object writes + BCS payloads. DKG typically needs ≥100M MIST; presign/sign ≥50M.

**Fix:**
```typescript
// ✅ Dry-run first:
const dryRun = await suiClient.dryRunTransactionBlock({
  transactionBlock: await tx.build({ client: suiClient }),
});
// budget = computationCost + storageCost * 1.2 (20% buffer)

// ✅ Or set manual budget:
tx.setGasBudget(100_000_000);  // 0.1 SUI — covers DKG
// Presign / Sign: 50_000_000 usually sufficient
```

---

## MOVE ABORT CODES

### `EDeprecatedFunction` (coordinator.move)

Thrown by the Move coordinator when calling deprecated entry points. In TypeScript, surfaces as `SuiExecutionError` with `MoveAbort` in the message.

**Deprecated Move entry points (abort with `EDeprecatedFunction`):**
```move
// These functions have been removed from coordinator.move:
public fun request_dwallet_dkg_first_round(...)   // Use request_dwallet_dkg instead
public fun request_dwallet_dkg_second_round(...)  // Use request_dwallet_dkg instead
```

**Detection in TypeScript:**
```typescript
try {
  await suiClient.signAndExecuteTransaction({ transaction: tx, ... });
} catch (e) {
  if (e.message?.includes('MoveAbort') && e.message?.includes('EDeprecatedFunction')) {
    // Calling old two-round DKG API — switch to requestDWalletDKG (single tx)
  }
}
```

---

### Session Already Exists (coordinator_inner.move)

**Trigger:** Duplicate `SessionIdentifier` bytes passed to `register_session_identifier`. Each session must be globally unique.

**Move-side:** Abort with duplicate session error  
**TypeScript surface:** `SuiExecutionError: MoveAbort`

**Fix:**
```typescript
// ✅ Always generate fresh session bytes:
const sessionId = createRandomSessionIdentifier(); // 32 random bytes
// Never reuse sessionId across transactions
```

---

### Presign Verification Failure (coordinator_inner.move)

**Trigger:** `verify_presign_cap()` called before Ika network completes the presign session. Network processes presigns asynchronously after the request tx.

**Fix:**
```typescript
// ✅ Wait for 'Completed' state before verifying:
const presign = await ikaClient.getPresignInParticularState(
  presignId,
  'Completed',
  { timeout: 120_000, interval: 2000 }
);
// Now safe to call verifyPresignCap or use in signing

// Or in Move, guard with is_presign_valid():
// if (coordinator.is_presign_valid(&unverified)) { let verified = coordinator.verify_presign_cap(unverified, ctx); }
```

---

## SIGNING ERRORS

### Error: Wrong signature bytes / format mismatch

**Trigger:** `sign.output` from `getSignInParticularState()` is raw MPC protocol output, not a standard ECDSA/EdDSA signature. Also: passing wrong `Hash` for a `SignatureAlgorithm`.

**Fix:**
```typescript
import { parseSignatureFromSignOutput } from '@ika.xyz/sdk';

// ❌ Raw output is NOT the final signature — do NOT use directly
const rawBytes = sign.state.Completed.signature;

// ✅ Parse to standard DER/compact format:
const signatureBytes = await parseSignatureFromSignOutput(
  Curve.SECP256K1,
  SignatureAlgorithm.ECDSASecp256k1,
  sign.state.Completed.signature,
);
```

**Valid curve / algorithm / hash combinations:**

| Curve | Algorithm | Valid Hashes |
|-------|-----------|-------------|
| SECP256K1 | ECDSASecp256k1 | KECCAK256, SHA256, DoubleSHA256 |
| SECP256K1 | Taproot | SHA256 **only** |
| SECP256R1 | ECDSASecp256r1 | SHA256, DoubleSHA256 |
| ED25519 | EdDSA | SHA512 **only** |
| RISTRETTO | SchnorrkelSubstrate | Merlin **only** |

Any other combination → Move abort or WASM panic.

---

## WASM ERRORS

### Error: WASM build failure / `wasm-bindgen` version mismatch

**Trigger:** Building `@ika.xyz/ika-wasm` from source with wrong `wasm-bindgen-cli` version.

**Fix:**
```bash
# ✅ Exact version required — no substitutes:
cargo install wasm-bindgen-cli --version 0.2.100
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
rustup target add wasm32-unknown-unknown
```

**Avoid entirely** — use the published npm package which includes pre-built WASM:
```bash
npm install @ika.xyz/ika-wasm  # pre-built, no Rust required
```

**ESM/bundler issue in Vite:**
```typescript
// vite.config.ts
export default {
  optimizeDeps: { exclude: ['@ika.xyz/ika-wasm'] }
};
```

---

## QUICK REFERENCE

| Error | Class | Cause | Fix |
|-------|-------|-------|-----|
| `429 Failed to fetch encryption keys` | `NetworkError` | Default RPC rate-limited | Use `sui-testnet-rpc.publicnode.com` |
| `create is not a function` | `TypeError` | Wrong constructor pattern | Use `fromRootSeedKey(seed, curve)` |
| `deprecated. Use … instead` | `Error` | Old v1 DKG API | Use `requestDWalletDKG` + `prepareDKGAsync` |
| `ObjectNotFoundError` | `ObjectNotFoundError` | Cap not transferred / wrong ID | Transfer cap; parse IDs from events |
| `getDWalletInParticularState timeout` | `Error` | Testnet slow / bad session ID | 600s timeout; verify tx effects first |
| `user_output_signature undefined` | WASM `Error` | dWallet fetched before state ready | Always use state-polled dWallet object |
| `MoveAbort: EInsufficientPayment` | Sui exec error | Missing IKA coin | Use `coin::zero` pattern on testnet |
| `InsufficientGas` | Sui exec error | Budget too low | ≥100M MIST for DKG, ≥50M for sign |
| `MoveAbort: EDeprecatedFunction` | Sui exec error | Old Move entry point | Use `request_dwallet_dkg` (single tx) |
| Presign verify abort | Sui exec error | Network not done yet | Poll for `Completed` presign state first |
| Wrong signature bytes | `Error` | Raw MPC output used as sig | Call `parseSignatureFromSignOutput()` |
| WASM build failure | build error | Wrong wasm-bindgen version | Use `--version 0.2.100` exactly |

---

*Sources: SDK source errors.ts (Section 15, github-deep-dive.md), DevEx audit (06-devex-report.md),*  
*Move contracts coordinator.move / coordinator_inner.move, live testnet testing (Ika Tensei project)*
