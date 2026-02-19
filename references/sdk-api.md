# @ika.xyz/sdk — API Reference

> v0.2.7 · Verified: ground-truth introspection + crawled docs + source analysis 2026-02-18

**Node ≥ 18.** Key deps auto-installed: `@ika.xyz/ika-wasm` (WASM MPC), `@mysten/sui@^1.44.0`.

```bash
pnpm add @ika.xyz/sdk
```

---

## getNetworkConfig()

```typescript
function getNetworkConfig(network: 'testnet' | 'mainnet'): IkaConfig
// No exported type "IkaNetworkConfig" — use ReturnType<typeof getNetworkConfig>

interface IkaConfig {
  packages: {
    ikaPackage: string;
    ikaCommonPackage: string;
    ikaSystemOriginalPackage: string;
    ikaSystemPackage: string;                 // use this (may be upgraded)
    ikaDwallet2pcMpcOriginalPackage: string;
    ikaDwallet2pcMpcPackage: string;          // use this (may be upgraded)
  };
  objects: {
    ikaSystemObject:       { objectID: string; initialSharedVersion: number };
    ikaDWalletCoordinator: { objectID: string; initialSharedVersion: number };
  };
}
```

**Testnet (current):**
- `ikaDwallet2pcMpcPackage`:  `0x6573a6c13daf26a64eb8a37d3c7a4391b353031e223072ca45b1ff9366f59293`
- `ikaDWalletCoordinator`:    `0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc`
- `ikaSystemObject`:          `0x2172c6483ccd24930834e30102e33548b201d0607fb1fdc336ba3267d910dec6`

---

## Enums

```typescript
const Curve = {
  SECP256K1: 'SECP256K1',   // Bitcoin, Ethereum → ECDSASecp256k1, Taproot
  SECP256R1: 'SECP256R1',   // P-256 / WebAuthn  → ECDSASecp256r1
  ED25519:   'ED25519',     // Solana             → EdDSA
  RISTRETTO: 'RISTRETTO',   // Polkadot/Substrate → SchnorrkelSubstrate
} as const;

const SignatureAlgorithm = {
  ECDSASecp256k1: 'ECDSASecp256k1', Taproot: 'Taproot',
  ECDSASecp256r1: 'ECDSASecp256r1', EdDSA: 'EdDSA',
  SchnorrkelSubstrate: 'SchnorrkelSubstrate',
} as const;

const Hash = {
  KECCAK256: 'KECCAK256', SHA256: 'SHA256', DoubleSHA256: 'DoubleSHA256',
  SHA512: 'SHA512',   // EdDSA only
  Merlin: 'Merlin',   // SchnorrkelSubstrate only
} as const;

const DWalletKind = {
  ZeroTrust: 'zero-trust', ImportedKey: 'imported-key',
  ImportedKeyShared: 'imported-key-shared', Shared: 'shared',
} as const;
```

### Valid Combinations

| Curve | Algorithm | Valid Hashes |
|-------|-----------|--------------|
| SECP256K1 | ECDSASecp256k1 | KECCAK256, SHA256, DoubleSHA256 |
| SECP256K1 | Taproot | SHA256 |
| SECP256R1 | ECDSASecp256r1 | SHA256, DoubleSHA256 |
| ED25519 | EdDSA | SHA512 |
| RISTRETTO | SchnorrkelSubstrate | Merlin |

---

## dWallet Types

Three trust models:

| Kind | User Share | Who can sign |
|------|-----------|-------------|
| **ZeroTrust** | Encrypted, user-controlled | User + network (both required) |
| **Shared** | Public, on-chain | Network alone (DAOs, automation) |
| **ImportedKey** | Encrypted (default) or public | Same as ZeroTrust or Shared |

```typescript
type DWallet = ZeroTrustDWallet | ImportedKeyDWallet | ImportedSharedDWallet | SharedDWallet;
type ZeroTrustDWallet      = DWalletInternal & { kind: 'zero-trust' };
type ImportedKeyDWallet    = DWalletInternal & { kind: 'imported-key' };
type ImportedSharedDWallet = DWalletInternal & { kind: 'imported-key-shared' };
type SharedDWallet         = DWalletInternal & { kind: 'shared' };
// kind is computed by client from on-chain flags, not stored directly on-chain

interface DKGRequestInput {
  userDKGMessage: Uint8Array;             // public key share + ZK proof → on-chain
  userPublicOutput: Uint8Array;           // DKG public output → on-chain
  encryptedUserShareAndProof: Uint8Array; // encrypted share + proof → on-chain
  userSecretKeyShare: Uint8Array;         // ⚠️ SECRET — never send/store raw
}

interface ImportDWalletVerificationRequestInput {
  userPublicOutput: Uint8Array;
  userMessage: Uint8Array;
  encryptedUserShareAndProof: Uint8Array;
}

interface NetworkEncryptionKey {
  id: string; epoch: number;
  networkDKGOutputID: string;
  reconfigurationOutputID: string | undefined;
}

// Polling options (all methods that take state polling)
interface PollingOptions {
  timeout?: number;           // ms, default 30000
  interval?: number;          // initial poll interval ms
  maxInterval?: number;       // backoff cap ms
  backoffMultiplier?: number; // default 1.5
  signal?: AbortSignal;
}
```

### State Machine

```
requestDWalletDKG() → AwaitingKeyHolderSignature → acceptEncryptedUserShare() → Active
requestDWalletDKGWithPublicUserShare() → Active  (Shared dWallet, no accept step)

Active → requestPresign/requestGlobalPresign → Presign.Completed
       → requestSign/requestSignWithImportedKey → Sign.Completed
```

---

## IkaClient

```typescript
class IkaClient {
  ikaConfig: IkaConfig;
  constructor(options: { suiClient: SuiClient; config: IkaConfig; cache?: boolean; timeout?: number; encryptionKeyOptions?: EncryptionKeyOptions });
  async initialize(): Promise<void>;  // call before anything else

  // Network encryption keys
  async getLatestNetworkEncryptionKey(): Promise<NetworkEncryptionKey>;
  async getAllNetworkEncryptionKeys(): Promise<NetworkEncryptionKey[]>;
  async getNetworkEncryptionKey(encryptionKeyID: string): Promise<NetworkEncryptionKey>;
  async getDWalletNetworkEncryptionKey(dwalletID: string): Promise<NetworkEncryptionKey>;
  async getConfiguredNetworkEncryptionKey(): Promise<NetworkEncryptionKey>;

  // dWallet queries
  async getDWallet(dwalletID: string): Promise<DWallet>;
  async getMultipleDWallets(dwalletIDs: string[]): Promise<DWallet[]>;
  async getDWalletInParticularState<S extends DWalletState>(dwalletID: string, state: S, options?: PollingOptions): Promise<DWalletWithState<S>>;
  async getOwnedDWalletCaps(address: string, cursor?: string | null, limit?: number): Promise<{ dWalletCaps: DWalletCap[]; cursor: string | null | undefined; hasNextPage: boolean }>;

  // Presign / Sign queries
  async getPresign(presignID: string): Promise<Presign>;
  async getPresignInParticularState<S extends PresignState>(presignID: string, state: S, options?: PollingOptions): Promise<PresignWithState<S>>;

  // NOTE: getSign requires curve + signatureAlgorithm (auto-parses sig bytes)
  async getSign<C extends Curve>(signID: string, curve: C, signatureAlgorithm: ValidSignatureAlgorithmForCurve<C>): Promise<Sign>;
  async getSignInParticularState<S extends SignState>(signID: string, curve: Curve, signatureAlgorithm: SignatureAlgorithm, state: S, options?: PollingOptions): Promise<SignWithState<S>>;

  // Encrypted shares / partial signatures
  async getEncryptedUserSecretKeyShare(id: string): Promise<EncryptedUserSecretKeyShare>;
  async getEncryptedUserSecretKeyShareInParticularState<S extends EncryptedUserSecretKeyShareState>(id: string, state: S, options?: PollingOptions): Promise<EncryptedUserSecretKeyShareWithState<S>>;
  async getPartialUserSignature(id: string): Promise<PartialUserSignature>;
  async getPartialUserSignatureInParticularState<S extends PartialUserSignatureState>(id: string, state: S, options?: PollingOptions): Promise<PartialUserSignatureWithState<S>>;

  // Encryption keys & protocol parameters
  async getActiveEncryptionKey(address: string): Promise<EncryptionKey>;
  // dWallet = auto-detect curve+key; curve alone = use configured key; no args = SECP256K1 + latest
  async getProtocolPublicParameters(dWallet?: DWallet, curve?: Curve): Promise<Uint8Array>;
  async getEpoch(): Promise<number>;

  // Encryption key options
  getEncryptionKeyOptions(): EncryptionKeyOptions;
  setEncryptionKeyOptions(options: EncryptionKeyOptions): void;
  setEncryptionKeyID(encryptionKeyID: string): void;

  // Cache management
  invalidateCache(): void;
  invalidateObjectCache(): void;
  invalidateEncryptionKeyCache(): void;
  invalidateProtocolPublicParametersCache(encryptionKeyID?: string, curve?: Curve): void;
  isProtocolPublicParametersCached(encryptionKeyID: string, curve: Curve): boolean;
  getCachedProtocolPublicParameters(encryptionKeyID: string, curve: Curve): Uint8Array | undefined;
}
```

---

## UserShareEncryptionKeys

```typescript
class UserShareEncryptionKeys {
  encryptionKey: Uint8Array;   // public — registered on-chain
  decryptionKey: Uint8Array;   // ⚠️ private — decrypt user shares
  curve: Curve;

  // Create from 32-byte seed (deterministic)
  static async fromRootSeedKey(rootSeedKey: Uint8Array, curve: Curve): Promise<UserShareEncryptionKeys>;
  // Restore from serialized bytes
  static fromShareEncryptionKeysBytes(bytes: Uint8Array): UserShareEncryptionKeys;

  toShareEncryptionKeysBytes(): Uint8Array;
  getPublicKey(): Ed25519PublicKey;
  getSuiAddress(): string;
  getSigningPublicKeyBytes(): Uint8Array;

  async getEncryptionKeySignature(): Promise<Uint8Array>;
  async getUserOutputSignature(dWallet: DWallet, userPublicOutput: Uint8Array): Promise<Uint8Array>;
  async getUserOutputSignatureForTransferredDWallet(dWallet: DWallet, sourceEncryptedUserSecretKeyShare: EncryptedUserSecretKeyShare, sourceEncryptionKey: EncryptionKey): Promise<Uint8Array>;
  async verifySignature(message: Uint8Array, signature: Uint8Array): Promise<boolean>;

  // Decrypt user's secret share (required for signing with ZeroTrust dWallet)
  async decryptUserShare(dWallet: DWallet, encryptedUserSecretKeyShare: EncryptedUserSecretKeyShare, protocolPublicParameters: Uint8Array): Promise<{ verifiedPublicOutput: Uint8Array; secretShare: Uint8Array }>;
}
```

⚠️ Curve must match the dWallet curve. Store the 32-byte seed, not the serialized key bytes.

---

## DKG Helper Functions

```typescript
// Fetch params + compute DKG crypto via WASM. No on-chain mutation.
async function prepareDKGAsync(
  ikaClient: IkaClient, curve: Curve,
  userShareEncryptionKeys: UserShareEncryptionKeys,
  bytesToHash: Uint8Array,  // use createRandomSessionIdentifier()
  senderAddress: string     // Sui address of tx signer
): Promise<DKGRequestInput>;

// Lower-level: bring your own protocol public parameters
async function prepareDKG(
  protocolPublicParameters: Uint8Array, curve: Curve,
  encryptionKey: Uint8Array,  // userShareEncryptionKeys.encryptionKey
  bytesToHash: Uint8Array, senderAddress: string
): Promise<DKGRequestInput>;

// Prepare verification data for importing an existing private key
async function prepareImportedKeyDWalletVerification(
  ikaClient: IkaClient, curve: Curve, bytesToHash: Uint8Array,
  senderAddress: string, userShareEncryptionKeys: UserShareEncryptionKeys,
  privateKey: Uint8Array  // existing 32-byte private key
): Promise<ImportDWalletVerificationRequestInput>;

function createRandomSessionIdentifier(): Uint8Array;  // 32 random bytes
```

---

## IkaTransaction

Wraps Sui `Transaction`. All methods mutate the internal transaction. Requires `ikaCoin: Coin<IKA>` + `suiCoin: Coin<SUI>` on every MPC operation (IKA coin can be empty).

```typescript
class IkaTransaction {
  constructor(params: { ikaClient: IkaClient; transaction: Transaction; userShareEncryptionKeys?: UserShareEncryptionKeys });

  // Session identifiers
  createSessionIdentifier(): TransactionObjectArgument;  // random, registers on-chain
  registerSessionIdentifier(bytes: Uint8Array): TransactionObjectArgument;

  // One-time: register encryption key on-chain per address+curve
  async registerEncryptionKey(params: { curve: Curve }): Promise<IkaTransaction>;

  // DKG — create new ZeroTrust or Imported Key dWallet
  async requestDWalletDKG<S extends SignatureAlgorithm = never>(params: {
    dkgRequestInput: DKGRequestInput;
    sessionIdentifier: TransactionObjectArgument;
    dwalletNetworkEncryptionKeyId: string;
    curve: Curve;
    ikaCoin: TransactionObjectArgument;
    suiCoin: TransactionObjectArgument;
    signDuringDKGRequest?: {  // optional: atomic DKG + first sign
      message: Uint8Array; presign: Presign;
      verifiedPresignCap: TransactionObjectArgument;
      hashScheme: ValidHashForSignature<S>; signatureAlgorithm: S;
    };
  }): Promise<TransactionResult>;  // [0] = DWalletCap, [1] = Option<signID>

  // DKG — create Shared dWallet (public user share; no acceptEncryptedUserShare needed)
  async requestDWalletDKGWithPublicUserShare<S extends SignatureAlgorithm = never>(params: {
    sessionIdentifier: TransactionObjectArgument;
    dwalletNetworkEncryptionKeyId: string;
    curve: Curve;
    publicKeyShareAndProof: Uint8Array;   // dkgInput.userDKGMessage
    publicUserSecretKeyShare: Uint8Array; // dkgInput.userSecretKeyShare (becomes public!)
    userPublicOutput: Uint8Array;
    ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument;
    signDuringDKGRequest?: { message: Uint8Array; presign: Presign; verifiedPresignCap: TransactionObjectArgument; hashScheme: ValidHashForSignature<S>; signatureAlgorithm: S };
  }): Promise<TransactionResult>;  // [0] = DWalletCap, [1] = Option<signID>

  // Accept encrypted user share — activates ZeroTrust/ImportedKey dWallet
  // Overload 1: newly created dWallet
  async acceptEncryptedUserShare(params: { dWallet: ZeroTrustDWallet | ImportedKeyDWallet; userPublicOutput: Uint8Array; encryptedUserSecretKeyShareId: string }): Promise<IkaTransaction>;
  // Overload 2: transferred (re-encrypted) dWallet
  async acceptEncryptedUserShare(params: { dWallet: ZeroTrustDWallet | ImportedKeyDWallet; sourceEncryptionKey: EncryptionKey; sourceEncryptedUserSecretKeyShare: EncryptedUserSecretKeyShare; destinationEncryptedUserSecretKeyShare: EncryptedUserSecretKeyShare }): Promise<IkaTransaction>;

  // Imported key dWallet creation
  async requestImportedKeyDWalletVerification(params: {
    importDWalletVerificationRequestInput: ImportDWalletVerificationRequestInput;
    curve: Curve; signerPublicKey: Uint8Array;  // getSigningPublicKeyBytes()
    sessionIdentifier: TransactionObjectArgument;
    ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument;
  }): Promise<TransactionObjectArgument>;  // ImportedKeyDWalletCap

  // Presign
  // Use requestPresign for: ECDSA with imported key dWallets (or pre-v2 dWallets)
  requestPresign(params: { dWallet: DWallet; signatureAlgorithm: SignatureAlgorithm; ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument }): TransactionObjectArgument;

  // Use requestGlobalPresign for: EdDSA, Taproot, SchnorrkelSubstrate, and standard ECDSA dWallets
  requestGlobalPresign(params: { dwalletNetworkEncryptionKeyId: string; curve: Curve; signatureAlgorithm: SignatureAlgorithm; ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument }): TransactionObjectArgument;

  verifyPresignCap(params: { presign: Presign }): TransactionObjectArgument;

  // Message approval
  approveMessage(params: { dWalletCap: DWalletCap | TransactionObjectArgument; curve: Curve; signatureAlgorithm: SignatureAlgorithm; hashScheme: Hash; message: Uint8Array }): TransactionObjectArgument;
  approveImportedKeyMessage(params: { dWalletCap: DWalletCap | TransactionObjectArgument; curve: Curve; signatureAlgorithm: SignatureAlgorithm; hashScheme: Hash; message: Uint8Array }): TransactionObjectArgument;

  // Sign — ZeroTrust or Shared dWallet
  // ZeroTrust: provide encryptedUserSecretKeyShare OR (secretShare + publicOutput)
  // Shared: omit all share params (network uses public share)
  async requestSign(params: {
    dWallet: ZeroTrustDWallet | SharedDWallet;
    messageApproval: TransactionObjectArgument;
    hashScheme: Hash; verifiedPresignCap: TransactionObjectArgument; presign: Presign;
    message: Uint8Array; signatureScheme: SignatureAlgorithm;
    ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument;
    encryptedUserSecretKeyShare?: EncryptedUserSecretKeyShare;
    secretShare?: Uint8Array;  publicOutput?: Uint8Array;
  }): Promise<TransactionObjectArgument>;  // signID

  // Sign — Imported Key dWallet
  async requestSignWithImportedKey(params: {
    dWallet: ImportedKeyDWallet | ImportedSharedDWallet;
    importedKeyMessageApproval: TransactionObjectArgument;
    verifiedPresignCap: TransactionObjectArgument; presign: Presign;
    hashScheme: Hash; message: Uint8Array; signatureScheme?: SignatureAlgorithm;
    ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument;
    encryptedUserSecretKeyShare?: EncryptedUserSecretKeyShare;
    secretShare?: Uint8Array; publicOutput?: Uint8Array;
  }): Promise<TransactionObjectArgument>;  // signID

  // Future signing — create partial signature now, complete later
  async requestFutureSign(params: {
    dWallet: ZeroTrustDWallet | SharedDWallet;
    verifiedPresignCap: TransactionObjectArgument; presign: Presign;
    message: Uint8Array; hashScheme: Hash; signatureScheme: SignatureAlgorithm;
    ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument;
    encryptedUserSecretKeyShare?: EncryptedUserSecretKeyShare;
    secretShare?: Uint8Array; publicOutput?: Uint8Array;
  }): Promise<TransactionObjectArgument>;  // unverifiedPartialUserSignatureCap

  async requestFutureSignWithImportedKey(params: {
    dWallet: ImportedKeyDWallet | ImportedSharedDWallet;
    verifiedPresignCap: TransactionObjectArgument; presign: Presign;
    message: Uint8Array; hashScheme: Hash; signatureScheme: SignatureAlgorithm;
    ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument;
    encryptedUserSecretKeyShare?: EncryptedUserSecretKeyShare;
    secretShare?: Uint8Array; publicOutput?: Uint8Array;
  }): Promise<TransactionObjectArgument>;  // unverifiedPartialUserSignatureCap

  futureSign(params: { partialUserSignatureCap: TransactionObjectArgument; messageApproval: TransactionObjectArgument; ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument }): TransactionObjectArgument;
  futureSignWithImportedKey(params: { partialUserSignatureCap: TransactionObjectArgument; importedKeyMessageApproval: TransactionObjectArgument; ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument }): TransactionObjectArgument;

  // Transfer share to another address (recipient must have registered encryption key)
  async requestReEncryptUserShareFor(params: {
    dWallet: ZeroTrustDWallet;
    destinationEncryptionKeyAddress: string;
    sourceEncryptedUserSecretKeyShare: EncryptedUserSecretKeyShare;
    ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument;
  }): Promise<IkaTransaction>;

  // Convert ZeroTrust → Shared (IRREVERSIBLE)
  makeDWalletUserSecretKeySharesPublic(params: {
    dWallet: ZeroTrustDWallet | ImportedKeyDWallet;
    secretShare: Uint8Array;  // from userShareEncryptionKeys.decryptUserShare()
    ikaCoin: TransactionObjectArgument; suiCoin: TransactionObjectArgument;
  }): IkaTransaction;

  // On-chain existence checks (within PTB)
  hasDWallet(params: { dwalletId: string }): TransactionObjectArgument;  // → bool
  getDWallet(params: { dwalletId: string }): TransactionObjectArgument;  // → DWallet ref
}
```

---

## Cryptographic Functions

All WASM-backed via `@ika.xyz/ika-wasm`:

```typescript
// Create class-groups keypair from 32-byte seed
async function createClassGroupsKeypair(seed: Uint8Array, curve: Curve): Promise<{ encryptionKey: Uint8Array; decryptionKey: Uint8Array }>;

// Encrypt a secret share (produces encrypted share + ZK proof)
async function encryptSecretShare(curve: Curve, userSecretKeyShare: Uint8Array, encryptionKey: Uint8Array, protocolPublicParameters: Uint8Array): Promise<Uint8Array>;

// Verify secret share is consistent with public output
async function verifyUserShare(curve: Curve, userSecretKeyShare: Uint8Array, userDKGOutput: Uint8Array, networkDkgPublicOutput: Uint8Array): Promise<boolean>;

// Verify user + network DKG outputs match (always check before using dWallet)
async function userAndNetworkDKGOutputMatch(curve: Curve, userPublicOutput: Uint8Array, networkDKGOutput: Uint8Array): Promise<boolean>;

// Verify a signature produced by a dWallet
async function verifySecpSignature<C extends Curve, S extends ValidSignatureAlgorithmForCurve<C>>(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array, networkDkgPublicOutput: Uint8Array, hash: ValidHashForSignature<S>, signatureAlgorithm: S, curve: C): Promise<boolean>;

// Parse raw signature bytes from sign session output
async function parseSignatureFromSignOutput<C extends Curve>(curve: C, signatureAlgorithm: ValidSignatureAlgorithmForCurve<C>, signatureOutput: Uint8Array): Promise<Uint8Array>;

// Extract public key from on-chain outputs
async function publicKeyFromDWalletOutput(curve: Curve, dWalletOutput: Uint8Array): Promise<Uint8Array>;
async function publicKeyFromCentralizedDKGOutput(curve: Curve, centralizedDkgOutput: Uint8Array): Promise<Uint8Array>;

// Protocol public parameters conversions
async function networkDkgPublicOutputToProtocolPublicParameters(curve: Curve, network_dkg_public_output: Uint8Array): Promise<Uint8Array>;
async function reconfigurationPublicOutputToProtocolPublicParameters(curve: Curve, reconfiguration_public_output: Uint8Array, network_dkg_public_output: Uint8Array): Promise<Uint8Array>;

// Verify and get DKG public output (uses public key, not private key — safe to call)
async function verifyAndGetDWalletDKGPublicOutput(dWallet: DWallet, encryptedUserSecretKeyShare: EncryptedUserSecretKeyShare, publicKey: PublicKey): Promise<Uint8Array>;

// Session identifier digest (domain-separated KECCAK-256) — used internally by prepareDKG
function sessionIdentifierDigest(bytesToHash: Uint8Array, senderAddressBytes: Uint8Array): Uint8Array;

// Low-level sign message builders (used internally by IkaTransaction.requestSign)
async function createUserSignMessageWithPublicOutput(protocolPublicParameters: Uint8Array, publicOutput: Uint8Array, userSecretKeyShare: Uint8Array, presign: Uint8Array, message: Uint8Array, hash: Hash, signatureAlgorithm: SignatureAlgorithm, curve: Curve): Promise<Uint8Array>;
async function createUserSignMessageWithCentralizedOutput(protocolPublicParameters: Uint8Array, centralizedDkgOutput: Uint8Array, userSecretKeyShare: Uint8Array, presign: Uint8Array, message: Uint8Array, hash: Hash, signatureAlgorithm: SignatureAlgorithm, curve: Curve): Promise<Uint8Array>;
```

---

## coordinatorTransactions (low-level)

Raw Move call builders. `IkaTransaction` uses these internally. Import for fine-grained PTB control:

```typescript
import { coordinatorTransactions } from '@ika.xyz/sdk';
// All functions: (ikaConfig, coordinatorRef, ...params, tx) pattern
```

Key functions: `requestDWalletDKG`, `requestDWalletDKGWithPublicUserSecretKeyShare`, `registerEncryptionKeyTx`, `registerSessionIdentifier`, `approveMessage`, `approveImportedKeyMessage`, `requestPresign`, `requestGlobalPresign`, `verifyPresignCap`, `isPresignValid`, `requestSign`, `requestSignAndReturnId`, `requestImportedKeySign`, `requestImportedKeySignAndReturnId`, `requestFutureSign`, `verifyPartialUserSignatureCap`, `matchPartialUserSignatureWithMessageApproval`, `matchPartialUserSignatureWithImportedKeyMessageApproval`, `acceptEncryptedUserShare`, `requestReEncryptUserShareFor`, `requestMakeDwalletUserSecretKeySharesPublic`, `requestImportedKeyDwalletVerification`, `hasDWallet`, `getDWallet`, `signDuringDKGRequest`, `getActiveEncryptionKey`.

Also: `processCheckpointMessageByQuorum/ByCap`, `advanceEpoch`, `setSupportedAndPricing`, `setGlobalPresignConfig`, `setPricingVote`, `subsidizeCoordinatorWithIka/Sui`, `tryMigrate` (admin/protocol-cap gated).

---

## Error Types

```typescript
class NetworkError extends Error {}        // RPC/transport failure (incl. 429)
class ObjectNotFoundError extends Error {} // Object ID not found on-chain
class InvalidObjectError extends Error {}  // Object exists but failed validation
```

**Common:** `NetworkError 429` from default testnet RPC → use `https://sui-testnet-rpc.publicnode.com`.

---

## ⚠️ Deprecated — Throw at Runtime

| Deprecated | Use Instead |
|-----------|-------------|
| `IkaTransaction.requestDWalletDKGFirstRound()` | `requestDWalletDKG()` |
| `IkaTransaction.requestDWalletDKGFirstRoundAsync()` | `requestDWalletDKG()` |
| `IkaTransaction.requestDWalletDKGSecondRound()` | `requestDWalletDKG()` |
| `prepareDKGSecondRound()` | `prepareDKGAsync()` |
| `prepareDKGSecondRoundAsync()` | `prepareDKGAsync()` |
| `createDKGUserOutput()` | `prepareDKGAsync()` |
| Move: `request_dwallet_dkg_first_round/second_round` | Move: `request_dwallet_dkg` |

---

## Practical Notes

- **Two payments always**: `ikaCoin: Coin<IKA>` + `suiCoin: Coin<SUI>` on every MPC call. IKA can be empty coin (`coin::zero<IKA>`).
- **IKA faucet**: `https://faucet.ika.xyz` (swap SUI → IKA on testnet).
- **Presign routing**: `requestPresign` (dWallet-specific) for ECDSA with imported-key or pre-v2 dWallets. `requestGlobalPresign` for everything else.
- **Polling**: exponential backoff by default. Pass `PollingOptions` to override timeout/interval.
- **Single `IkaClient` instance**: enables caching of protocol state and network objects.
- **`getSign` is different**: requires `curve` + `signatureAlgorithm` (auto-parses signature from raw session output). Other `get*` methods only need an ID.
- **`getProtocolPublicParameters(dWallet?, curve?)`**: pass `dWallet` to auto-detect curve and key; pass just `curve` to use configured key; no args = SECP256K1 + latest key.
- **`approveMessage` / `approveImportedKeyMessage`**: takes `dWalletCap` object or TransactionObjectArgument (not a raw string ID), plus `hashScheme` (not `hash`).

---

*Sources: `@ika.xyz/sdk v0.2.7` installed + introspected · github.com/dwallet-labs/ika · docs.ika.xyz · 2026-02-18*
