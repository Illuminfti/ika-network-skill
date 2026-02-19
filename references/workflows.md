# Ika Network — Developer Workflows

> Step-by-step GPS guides. Follow each step, arrive at working code.  
> SDK: `@ika.xyz/sdk` v0.2.7 | Updated: 2026-02-18 | Verified against ground-truth API introspection + DevEx report.

---

## ⚠️ Read First — Critical Gotchas

1. **Wrong RPC = instant 429.** `getFullnodeUrl('testnet')` rate-limits immediately under SDK's multi-call patterns. Always use `https://sui-testnet-rpc.publicnode.com`.
2. **Deprecated API throws.** `requestDWalletDKGFirstRound`, `requestDWalletDKGSecondRound` — deprecated and throw. Use `requestDWalletDKG` + `prepareDKGAsync`.
3. **Two fees required.** Every protocol tx costs SUI (gas) + IKA (protocol fee). You need both.
4. **`UserShareEncryptionKeys.create()` doesn't exist.** Use `UserShareEncryptionKeys.fromRootSeedKey(seed, curve)`.
5. **No `.toBytes()` method.** To serialize encryption keys use `toShareEncryptionKeysBytes()`. To restore: `fromShareEncryptionKeysBytes(bytes)`.
6. **`requestDWalletDKG` returns a tuple.** `const [dWalletCap, signId] = await ikaTx.requestDWalletDKG(...)`. Always destructure.
7. **Zero-Trust dWallets require activation.** After DKG tx completes, dWallet enters `AwaitingKeyHolderSignature`. You must call `acceptEncryptedUserShare` to reach `Active`.
8. **Session identifier flow is 3 steps.** `createRandomSessionIdentifier()` → pass bytes to `prepareDKGAsync` → `ikaTx.registerSessionIdentifier(identifier)` → pass result to `requestDWalletDKG`.
9. **No `IkaNetworkConfig` type export.** Just pass `getNetworkConfig('testnet')` directly — don't type-annotate it.
10. **`Curve` enum has exactly 4 values:** `SECP256K1`, `RISTRETTO`, `ED25519`, `SECP256R1`.
11. **`getSignInParticularState` takes strings, not enums.** Pass `'SECP256K1'` and `'ECDSASecp256k1'`, not `Curve.SECP256K1`.
12. **Save your `rootSeed`.** Lose it = lose dWallet access forever.

---

## Workflow D: Get Testnet Tokens (Do This First)

### Step 1 — Get SUI
```bash
sui client faucet
# or: https://faucet.triangleplatform.com/sui/testnet
```

### Step 2 — Get IKA
Visit **https://faucet.ika.xyz/** to swap testnet SUI for IKA tokens.  
Connect your Sui wallet → swap testnet SUI → IKA.

### Step 3 — Find Your IKA Coin Object ID
```typescript
import { SuiClient } from '@mysten/sui/client';

const suiClient = new SuiClient({ url: 'https://sui-testnet-rpc.publicnode.com' });

// IKA coin type uses the original package address (doesn't change with upgrades).
// Cross-check: run getNetworkConfig('testnet') and look at ikaSystemOriginalPackage.
const IKA_COIN_TYPE =
  '0x8f66bb433ad1c4f45da565a49199e8bc29787e3c02d60906e07bbd1612acacb6::ika::IKA';

const coins = await suiClient.getCoins({
  owner: '0xYOUR_ADDRESS',
  coinType: IKA_COIN_TYPE,
});
// Set as IKA_COIN_ID env var:
console.log('IKA coin ID:', coins.data[0].coinObjectId);
```

---

## Workflow A: Zero-Trust dWallet — Create + Activate

Zero-Trust = user share (encrypted, only yours) + network share both required. Network cannot sign alone.

```bash
npm install @ika.xyz/sdk @mysten/sui @noble/hashes
```

```typescript
import {
  getNetworkConfig, IkaClient, IkaTransaction, UserShareEncryptionKeys,
  Curve, prepareDKGAsync, createRandomSessionIdentifier,
} from '@ika.xyz/sdk';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { randomBytes } from '@noble/hashes/utils';

// ── 1. Connect — MUST use publicnode, not default Sui RPC ──────────────────
const suiClient = new SuiClient({ url: 'https://sui-testnet-rpc.publicnode.com' });
const ikaClient = new IkaClient({
  suiClient,
  config: getNetworkConfig('testnet'),  // no IkaNetworkConfig type — just pass directly
});
await ikaClient.initialize();
console.log('✅ Connected. Epoch:', await ikaClient.getEpoch());

const keypair = Ed25519Keypair.fromSecretKey(
  Uint8Array.from(Buffer.from(process.env.SUI_PRIVATE_KEY!, 'base64'))
);
const signerAddress = keypair.getPublicKey().toSuiAddress();

// ── 2. Create encryption keys — SAVE rootSeed (losing it = losing dWallet) ─
const rootSeed = randomBytes(32);
console.log('Save rootSeed:', Buffer.from(rootSeed).toString('hex'));

const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(
  rootSeed, Curve.SECP256K1,
);
// Serialize: userShareEncryptionKeys.toShareEncryptionKeysBytes()  ← NOT .toBytes()
// Restore:   UserShareEncryptionKeys.fromShareEncryptionKeysBytes(bytes)

// ── 3. Prepare DKG cryptography (pure WASM crypto, no fees yet) ────────────
const networkEncryptionKey = await ikaClient.getLatestNetworkEncryptionKey();

// Session identifier: createRandomSessionIdentifier() returns Uint8Array bytes.
// These same bytes go into prepareDKGAsync AND ikaTx.registerSessionIdentifier().
const identifier = createRandomSessionIdentifier();

const dkgRequestInput = await prepareDKGAsync(
  ikaClient,
  Curve.SECP256K1,
  userShareEncryptionKeys,
  identifier,       // bytesToHash — the session identifier bytes
  signerAddress,
);
// dkgRequestInput: { userDKGMessage, userPublicOutput, encryptedUserShareAndProof, userSecretKeyShare }

// ── 4. Build and submit DKG transaction ────────────────────────────────────
const tx = new Transaction();
const ikaTx = new IkaTransaction({ ikaClient, transaction: tx, userShareEncryptionKeys });

// Register encryption key with the network (first time only; safe to re-run)
await ikaTx.registerEncryptionKey({ curve: Curve.SECP256K1 });

// requestDWalletDKG returns [dWalletCap, optSignId] TUPLE — always destructure
const [dWalletCap, _signId] = await ikaTx.requestDWalletDKG({
  curve: Curve.SECP256K1,
  dkgRequestInput,
  sessionIdentifier: ikaTx.registerSessionIdentifier(identifier),   // register the bytes
  dwalletNetworkEncryptionKeyId: networkEncryptionKey.id,
  ikaCoin: tx.object(process.env.IKA_COIN_ID!),
  suiCoin: tx.splitCoins(tx.gas, [5_000_000]),
});
tx.transferObjects([dWalletCap], signerAddress);

const result = await suiClient.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showObjectChanges: true, showEvents: true },
});
if (result.effects?.status?.status !== 'success') {
  throw new Error(`DKG tx failed: ${JSON.stringify(result.effects?.status)}`);
}

// ── 5. Extract dWalletCapId → dWalletId ────────────────────────────────────
const capChange = result.objectChanges?.find(
  (c) => c.type === 'created' && c.objectType.includes('DWalletCap'),
);
if (!capChange || capChange.type !== 'created') throw new Error('DWalletCap not found');
const dWalletCapId = capChange.objectId;

const capObj = await suiClient.getObject({ id: dWalletCapId, options: { showContent: true } });
const dWalletId = (capObj.data?.content as any)?.fields?.dwallet_id as string;

// ── 6. Wait for AwaitingKeyHolderSignature ─────────────────────────────────
// Zero-Trust only: Ika network runs DKG then waits for user to accept their share.
// NOTE: interval (not pollingInterval)
console.log('⏳ Waiting for Ika DKG confirmation (~30-90s)...');
const pendingDWallet = await ikaClient.getDWalletInParticularState(
  dWalletId,
  'AwaitingKeyHolderSignature',
  { timeout: 120_000, interval: 3_000 },
);

// Get encrypted share ID from DKG event
const dkgEvent = result.events?.find((e) => e.type.includes('DWalletSessionEvent'));
const encryptedUserSecretKeyShareId =
  (dkgEvent?.parsedJson as any)?.encrypted_user_secret_key_share_id as string;

// ── 7. Activate: accept encrypted user share ────────────────────────────────
const activationTx = new Transaction();
const activationIkaTx = new IkaTransaction({
  ikaClient,
  transaction: activationTx,
  userShareEncryptionKeys,
});

await activationIkaTx.acceptEncryptedUserShare({
  dWallet: pendingDWallet as any,  // ZeroTrustDWallet
  encryptedUserSecretKeyShareId,
  userPublicOutput: new Uint8Array(
    (pendingDWallet.state as any).AwaitingKeyHolderSignature?.public_output,
  ),
});

await suiClient.signAndExecuteTransaction({
  signer: keypair,
  transaction: activationTx,
  options: { showEffects: true },
});

// ── 8. Wait for Active state ────────────────────────────────────────────────
const activeDWallet = await ikaClient.getDWalletInParticularState(
  dWalletId, 'Active', { timeout: 60_000, interval: 2_000 },
);

console.log('\n🎉 Zero-Trust dWallet active!');
console.log('dWalletId:    ', dWalletId);
console.log('dWalletCapId: ', dWalletCapId);
console.log('encShareId:   ', encryptedUserSecretKeyShareId);
// Store: dWalletId, dWalletCapId, rootSeed, encryptedUserSecretKeyShareId
```

---

## Workflow B: Shared dWallet — Create

Shared = user share is **public** on-chain. Network can sign autonomously.  
Use for: DAOs, smart contract treasuries, automated trading bots.

```typescript
// Same setup as Workflow A (connect, userShareEncryptionKeys, prepareDKGAsync, identifier)...
// The crypto preparation is identical — only the DKG request call differs.

const tx = new Transaction();
const ikaTx = new IkaTransaction({ ikaClient, transaction: tx, userShareEncryptionKeys });

// requestDWalletDKGWithPublicUserShare — uses fields from dkgRequestInput
// publicUserSecretKeyShare is intentionally made public (not encrypted)
const [dWalletCap] = await ikaTx.requestDWalletDKGWithPublicUserShare({
  publicKeyShareAndProof: dkgRequestInput.userDKGMessage,
  publicUserSecretKeyShare: dkgRequestInput.userSecretKeyShare,   // public, not encrypted
  userPublicOutput: dkgRequestInput.userPublicOutput,
  curve: Curve.SECP256K1,
  dwalletNetworkEncryptionKeyId: networkEncryptionKey.id,
  ikaCoin: tx.object(process.env.IKA_COIN_ID!),
  suiCoin: tx.splitCoins(tx.gas, [5_000_000]),
  sessionIdentifier: ikaTx.registerSessionIdentifier(identifier),
});
tx.transferObjects([dWalletCap], signerAddress);

await suiClient.signAndExecuteTransaction({
  signer: keypair, transaction: tx, options: { showObjectChanges: true },
});

// Shared dWallet activates DIRECTLY — no acceptEncryptedUserShare step needed
const activeDWallet = await ikaClient.getDWalletInParticularState(
  dWalletId, 'Active', { timeout: 60_000, interval: 2_000 },
);
console.log('🎉 Shared dWallet active!');
```

---

## Workflow P: Presigning

Presigns pre-compute the network's cryptographic contribution, so signing is fast.

**Global Presign** — use for new Zero-Trust/Shared dWallets, and for Schnorr/EdDSA/Taproot.  
**dWallet-Specific Presign** — required for ECDSA with imported-key dWallets, or pre-v2 dWallets.

### Global Presign (recommended for new dWallets)
```typescript
const presignTx = new Transaction();
const presignIkaTx = new IkaTransaction({ ikaClient, transaction: presignTx });

const networkEncKey = await ikaClient.getLatestNetworkEncryptionKey();

// requestGlobalPresign is SYNC — returns TransactionObjectArgument (not a Promise)
const unverifiedPresignCap = presignIkaTx.requestGlobalPresign({
  dwalletNetworkEncryptionKeyId: networkEncKey.id,
  curve: Curve.SECP256K1,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  ikaCoin: presignTx.object(process.env.IKA_COIN_ID!),
  suiCoin: presignTx.splitCoins(presignTx.gas, [5_000_000]),
});
presignTx.transferObjects([unverifiedPresignCap], signerAddress);

const presignResult = await suiClient.signAndExecuteTransaction({
  signer: keypair, transaction: presignTx, options: { showObjectChanges: true },
});
const presignCapId = presignResult.objectChanges?.find(
  (c) => c.type === 'created' && c.objectType.includes('Presign'),
)!.objectId;

// Wait for Completed (not Active — presign final state is Completed)
const presign = await ikaClient.getPresignInParticularState(
  presignCapId, 'Completed', { timeout: 90_000, interval: 2_000 },
);
console.log('✅ Global presign ready');
```

### dWallet-Specific Presign (imported key / legacy)
```typescript
const presignTx = new Transaction();
const presignIkaTx = new IkaTransaction({ ikaClient, transaction: presignTx });

// requestPresign takes the dWallet OBJECT (not dWalletCapId)
const unverifiedPresignCap = presignIkaTx.requestPresign({
  dWallet: activeDWallet,                         // the dWallet object (not the cap)
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  ikaCoin: presignTx.object(process.env.IKA_COIN_ID!),
  suiCoin: presignTx.splitCoins(presignTx.gas, [5_000_000]),
});
presignTx.transferObjects([unverifiedPresignCap], signerAddress);

await suiClient.signAndExecuteTransaction({ signer: keypair, transaction: presignTx, options: { showObjectChanges: true } });

const presign = await ikaClient.getPresignInParticularState(
  presignCapId, 'Completed', { timeout: 90_000, interval: 2_000 },
);
```

---

## Workflow C: Sign a Message

### Zero-Trust dWallet Signing
Requires: active dWallet (Workflow A) + completed presign (Workflow P) + encrypted share ID.

```typescript
import { Hash, SignatureAlgorithm } from '@ika.xyz/sdk';

const message = new TextEncoder().encode('Hello, Ika!');

// Fetch the encrypted user share
const encryptedUserSecretKeyShare = await ikaClient.getEncryptedUserSecretKeyShare(
  encryptedUserSecretKeyShareId,
);

const signTx = new Transaction();
const signIkaTx = new IkaTransaction({ ikaClient, transaction: signTx, userShareEncryptionKeys });

// Step 1: Approve the message (authorises this specific message)
const messageApproval = signIkaTx.approveMessage({
  message,
  curve: Curve.SECP256K1,
  dWalletCap: activeDWallet.dwallet_cap_id,   // .dwallet_cap_id field on the dWallet object
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  hashScheme: Hash.KECCAK256,
});

// Step 2: Verify the presign cap (in-PTB verification)
const verifiedPresignCap = signIkaTx.verifyPresignCap({ presign });

// Step 3: Request sign — all params required for Zero-Trust
await signIkaTx.requestSign({
  dWallet: activeDWallet,                      // the dWallet object (not cap)
  messageApproval,
  hashScheme: Hash.KECCAK256,
  verifiedPresignCap,
  presign,
  encryptedUserSecretKeyShare,                 // required: SDK decrypts user share client-side
  message,
  signatureScheme: SignatureAlgorithm.ECDSASecp256k1,
  ikaCoin: signTx.object(process.env.IKA_COIN_ID!),
  suiCoin: signTx.splitCoins(signTx.gas, [5_000_000]),
});

const signResult = await suiClient.signAndExecuteTransaction({
  signer: keypair, transaction: signTx, options: { showEvents: true },
});

// Extract sign session ID from events
const signEvent = signResult.events?.find((e) => e.type.includes('SignSessionEvent'));
const signSessionId = (signEvent?.parsedJson as any)?.sign_id as string;

// Step 4: Wait for completed signature
// NOTE: getSignInParticularState takes STRINGS for curve/algorithm (not enum values)
const sign = await ikaClient.getSignInParticularState(
  signSessionId,
  'SECP256K1',          // ← string, not Curve.SECP256K1
  'ECDSASecp256k1',     // ← string, not SignatureAlgorithm.ECDSASecp256k1
  'Completed',
  { timeout: 60_000, interval: 2_000 },
);
const signature = Uint8Array.from(sign.state.Completed.signature);
console.log('✅ Signature:', Buffer.from(signature).toString('hex'));
```

### Shared dWallet Signing (simpler)
```typescript
// Same flow but NO encryptedUserSecretKeyShare needed
// Use approveMessage the same way; network uses public share automatically
await signIkaTx.requestSign({
  dWallet: sharedDWallet,   // SharedDWallet type
  messageApproval,
  hashScheme: Hash.KECCAK256,
  verifiedPresignCap,
  presign,
  // ← no encryptedUserSecretKeyShare
  message,
  signatureScheme: SignatureAlgorithm.ECDSASecp256k1,
  ikaCoin: signTx.object(process.env.IKA_COIN_ID!),
  suiCoin: signTx.splitCoins(signTx.gas, [5_000_000]),
});
```

---

## Workflow K: Imported Key dWallet

Import an existing private key into Ika. Useful for migrating existing ETH/BTC keys.  
⚠️ The original private key still exists — if it was ever compromised, the dWallet is too.

```typescript
import {
  prepareImportedKeyDWalletVerification, createRandomSessionIdentifier,
  IkaTransaction, UserShareEncryptionKeys, Curve, Hash, SignatureAlgorithm,
} from '@ika.xyz/sdk';

// ── 1. Prepare import verification (pure crypto) ───────────────────────────
const privateKey = Uint8Array.from(Buffer.from('YOUR_EXISTING_PRIVATE_KEY_HEX', 'hex'));
const sessionIdentifier = createRandomSessionIdentifier();

const importVerificationInput = await prepareImportedKeyDWalletVerification(
  ikaClient,
  Curve.SECP256K1,
  sessionIdentifier,
  signerAddress,
  userShareEncryptionKeys,
  privateKey,
);

// ── 2. Submit verification transaction ────────────────────────────────────
const importTx = new Transaction();
const importIkaTx = new IkaTransaction({
  ikaClient, transaction: importTx, userShareEncryptionKeys,
});
await importIkaTx.registerEncryptionKey({ curve: Curve.SECP256K1 });

const importedKeyDWalletCap = await importIkaTx.requestImportedKeyDWalletVerification({
  importDWalletVerificationRequestInput: importVerificationInput,
  curve: Curve.SECP256K1,
  signerPublicKey: userShareEncryptionKeys.getSigningPublicKeyBytes(),
  sessionIdentifier: importIkaTx.registerSessionIdentifier(sessionIdentifier),
  ikaCoin: importTx.object(process.env.IKA_COIN_ID!),
  suiCoin: importTx.splitCoins(importTx.gas, [5_000_000]),
});
importTx.transferObjects([importedKeyDWalletCap], signerAddress);

await suiClient.signAndExecuteTransaction({
  signer: keypair, transaction: importTx, options: { showEvents: true },
});

// ── 3. Wait for AwaitingKeyHolderSignature, then accept share ─────────────
const pendingImported = await ikaClient.getDWalletInParticularState(
  dWalletId, 'AwaitingKeyHolderSignature', { timeout: 60_000, interval: 2_000 },
);

const acceptTx = new Transaction();
const acceptIkaTx = new IkaTransaction({
  ikaClient, transaction: acceptTx, userShareEncryptionKeys,
});
await acceptIkaTx.acceptEncryptedUserShare({
  dWallet: pendingImported as any,
  encryptedUserSecretKeyShareId,
  userPublicOutput: importVerificationInput.userPublicOutput,
});
await suiClient.signAndExecuteTransaction({ signer: keypair, transaction: acceptTx });

const activeImported = await ikaClient.getDWalletInParticularState(
  dWalletId, 'Active', { timeout: 30_000, interval: 2_000 },
);

// ── 4. Sign with imported key dWallet ─────────────────────────────────────
// Use approveImportedKeyMessage (not approveMessage) and requestSignWithImportedKey

const signIkaTx = new IkaTransaction({ ikaClient, transaction: signTx, userShareEncryptionKeys });

const importedKeyMessageApproval = signIkaTx.approveImportedKeyMessage({
  dWalletCap: activeImported.dwallet_cap_id,
  curve: Curve.SECP256K1,
  signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
  hashScheme: Hash.KECCAK256,
  message,
});

await signIkaTx.requestSignWithImportedKey({
  dWallet: activeImported,
  importedKeyMessageApproval,
  verifiedPresignCap: signIkaTx.verifyPresignCap({ presign }),
  presign,
  hashScheme: Hash.KECCAK256,
  message,
  encryptedUserSecretKeyShare,   // required for zero-trust mode
  signatureScheme: SignatureAlgorithm.ECDSASecp256k1,
  ikaCoin: signTx.object(process.env.IKA_COIN_ID!),
  suiCoin: signTx.splitCoins(signTx.gas, [5_000_000]),
});
```

---

## Workflow L: Localnet Setup

```bash
# Prerequisites: Rust (rustup), Sui CLI (brew install sui)

# 1. Clone Ika
git clone https://github.com/dwallet-labs/ika.git && cd ika

# 2. Terminal 1 — Sui localnet (very long epoch so it doesn't rotate during testing)
RUST_LOG="off,sui_node=info" sui start \
  --with-faucet \
  --force-regenesis \
  --epoch-duration-ms 1000000000000000

# 3. Terminal 2 — Ika node (connects to the Sui localnet above)
cargo run --bin ika --release --no-default-features -- start
# --no-default-features disables the 16-core minimum requirement
```

```typescript
// Testnet:  use getNetworkConfig('testnet') — no config file needed.
// Localnet: use the ika_config.json emitted by Ika node startup.
//           SDK tests read this file; adapt getNetworkConfig to load it.
```

---

## Workflow X: Bitcoin Multi-Chain Signing

```bash
npm install bitcoinjs-lib tiny-secp256k1
```

```typescript
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { Hash, SignatureAlgorithm, Curve } from '@ika.xyz/sdk';

bitcoin.initEccLib(ecc);
const BTC_NETWORK = bitcoin.networks.testnet;

// Use SECP256K1 Zero-Trust dWallet (Workflow A)
const pubkey = Buffer.from(activeDWallet.publicKey);
const { address: btcAddress } = bitcoin.payments.p2wpkh({ pubkey, network: BTC_NETWORK });
console.log('Bitcoin testnet address:', btcAddress);
// Fund this at a testnet faucet before continuing

// Build PSBT
const utxoScript = bitcoin.payments.p2wpkh({ pubkey, network: BTC_NETWORK }).output!;
const psbt = new bitcoin.Psbt({ network: BTC_NETWORK });
psbt.addInput({
  hash: process.env.BTC_UTXO_TXID!,
  index: parseInt(process.env.BTC_UTXO_VOUT ?? '0'),
  witnessUtxo: { script: utxoScript, value: parseInt(process.env.BTC_UTXO_VALUE!) },
});
psbt.addOutput({ address: process.env.BTC_RECIPIENT!, value: 5_000 });
psbt.addOutput({
  address: btcAddress!,
  value: parseInt(process.env.BTC_UTXO_VALUE!) - 5_000 - 1_000, // change
});

// SegWit sighash (what Ika actually signs — already double-SHA256 internally by PSBT)
const sighash = (psbt as any).__CACHE.__TX.hashForWitnessV0(
  0, utxoScript, parseInt(process.env.BTC_UTXO_VALUE!), bitcoin.Transaction.SIGHASH_ALL,
);

// Use dWallet-specific presign for ECDSA (not global presign)
// Sign with Hash.SHA256 — SegWit sighashes are already pre-hashed by PSBT
await signIkaTx.requestSign({
  dWallet: activeDWallet,
  messageApproval: signIkaTx.approveMessage({
    message: sighash, curve: Curve.SECP256K1,
    dWalletCap: activeDWallet.dwallet_cap_id,
    signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
    hashScheme: Hash.SHA256,
  }),
  hashScheme: Hash.SHA256,
  verifiedPresignCap: signIkaTx.verifyPresignCap({ presign }),
  presign,
  encryptedUserSecretKeyShare,
  message: sighash,
  signatureScheme: SignatureAlgorithm.ECDSASecp256k1,
  ikaCoin: signTx.object(process.env.IKA_COIN_ID!),
  suiCoin: signTx.splitCoins(signTx.gas, [5_000_000]),
});

// After polling for signature...
const scriptSig = Buffer.concat([
  Buffer.from(ecdsaSig),
  Buffer.from([bitcoin.Transaction.SIGHASH_ALL]),
]);
psbt.updateInput(0, { partialSig: [{ pubkey, signature: scriptSig }] });
psbt.finalizeAllInputs();
const rawTx = psbt.extractTransaction().toHex();

const resp = await fetch('https://blockstream.info/testnet/api/tx', { method: 'POST', body: rawTx });
console.log('✅ Bitcoin tx:', await resp.text());
```

---

## Quick Reference

### Curve / Algorithm / Hash — Valid Combinations

| Curve | Algorithm | Valid Hashes | Use Case |
|-------|-----------|-------------|----------|
| SECP256K1 | ECDSASecp256k1 | KECCAK256, SHA256, DoubleSHA256 | Ethereum, Bitcoin |
| SECP256K1 | Taproot | SHA256 | Bitcoin Taproot (BIP-340) |
| SECP256R1 | ECDSASecp256r1 | SHA256 | Passkeys, WebAuthn, Apple |
| ED25519 | EdDSA | SHA512 | Solana, Cosmos |
| RISTRETTO | SchnorrkelSubstrate | Merlin | Polkadot, Substrate |

### Presign Type Selection

| dWallet Type | Signature Algorithm | Presign to Use |
|-------------|---------------------|---------------|
| Zero-Trust (new, post-v2) | Any | `requestGlobalPresign` |
| Shared | Any | `requestGlobalPresign` |
| Imported Key | ECDSA | `requestPresign` (dWallet-specific) |
| Imported Key | EdDSA / Taproot / Schnorr | `requestGlobalPresign` |

### dWallet State Machine

| dWallet Type | After DKG tx | After acceptEncryptedUserShare |
|-------------|-------------|-------------------------------|
| Zero-Trust | `AwaitingKeyHolderSignature` | `Active` |
| Shared | `Active` (direct) | — (no activation needed) |
| Imported Key | `AwaitingKeyHolderSignature` | `Active` |

### Key API Signatures (ground-truth verified)

```typescript
// prepareDKGAsync — NOT prepareDKG, NOT prepareDKGSecondRound
prepareDKGAsync(ikaClient, curve, userShareEncryptionKeys, bytesToHash, senderAddress)
// → { userDKGMessage, userPublicOutput, encryptedUserShareAndProof, userSecretKeyShare }

// requestDWalletDKG — returns TUPLE
const [dWalletCap, optSignId] = await ikaTx.requestDWalletDKG({...})

// requestGlobalPresign — SYNC (not async)
const unverifiedCap = ikaTx.requestGlobalPresign({...})  // no await

// requestPresign — SYNC, takes dWallet object (not cap)
const unverifiedCap = ikaTx.requestPresign({ dWallet, signatureAlgorithm, ikaCoin, suiCoin })

// verifyPresignCap — SYNC, in-PTB
const verified = ikaTx.verifyPresignCap({ presign })     // or { unverifiedPresignCap }

// getSignInParticularState — strings not enums for curve/algorithm
ikaClient.getSignInParticularState(id, 'SECP256K1', 'ECDSASecp256k1', 'Completed', opts)

// UserShareEncryptionKeys serialization
keys.toShareEncryptionKeysBytes()                        // ← NOT .toBytes()
UserShareEncryptionKeys.fromShareEncryptionKeysBytes(b)  // restore
```

### Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `429 Too Many Requests` | Default Sui RPC | Use `https://sui-testnet-rpc.publicnode.com` |
| `EDeprecatedFunction` | Old DKG methods | Use `requestDWalletDKG` + `prepareDKGAsync` |
| `undefined is not a function` on `.toBytes()` | Wrong method name | Use `.toShareEncryptionKeysBytes()` |
| `Cannot destructure property` on DKG result | Forgot tuple | `const [cap, signId] = await ikaTx.requestDWalletDKG(...)` |
| `IkaNetworkConfig is not exported` | Type annotation | Remove the type; pass `getNetworkConfig('testnet')` directly |
| Tx fails on `payment_ika` | No IKA token | Get from `https://faucet.ika.xyz/` |
| dWallet stuck at `AwaitingKeyHolderSignature` | Missing activation | Call `acceptEncryptedUserShare` then poll for `Active` |
| Type error on `getSignInParticularState` | Passing enum | Pass strings: `'SECP256K1'`, `'ECDSASecp256k1'` |
| `dWalletId` not found in changes | Wrong field | Get cap ID from objectChanges → fetch cap object → `.fields.dwallet_id` |

### Testnet Constants (from `getNetworkConfig('testnet')` — ground truth verified)

```typescript
// IKA coin type for getCoins queries
const IKA_COIN_TYPE =
  '0x8f66bb433ad1c4f45da565a49199e8bc29787e3c02d60906e07bbd1612acacb6::ika::IKA';

// Shared objects — initialSharedVersion required for PTB construction
const COORDINATOR_ID = '0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc';
const COORDINATOR_VERSION = 510819272;
const IKA_SYSTEM_ID      = '0x2172c6483ccd24930834e30102e33548b201d0607fb1fdc336ba3267d910dec6';
const IKA_SYSTEM_VERSION = 508060325;

// Packages (current upgrade tip — always prefer getNetworkConfig() at runtime)
// ikaPackage:              0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a
// ikaDwallet2pcMpcPackage: 0x6573a6c13daf26a64eb8a37d3c7a4391b353031e223072ca45b1ff9366f59293
// Original packages (used for coin types — stable, don't change with upgrades):
// ikaSystemOriginalPackage:       0xae71e386fd4cff3a080001c4b74a9e485cd6a209fa98fb272ab922be68869148
// ikaDwallet2pcMpcOriginalPackage: 0xf02f5960c94fce1899a3795b5d11fd076bc70a8d0e20a2b19923d990ed490730
```
