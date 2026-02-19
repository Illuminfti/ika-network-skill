/**
 * DWalletClient — Ika Network SDK wrapper
 *
 * Uses a SHARED dWallet (public user share) which is the canonical pattern for
 * smart-contract-controlled wallets, DAOs, and automated systems.
 *
 * For ZERO-TRUST dWallets (user-controlled), use `requestDWalletDKG` with:
 *   - `dkgRequestInput: dkgInput`           ← was broken as `dkgInput` (not a valid param key)
 *   - `sessionIdentifier: ikaTx.registerSessionIdentifier(sessionId)` ← NOT createSessionIdentifier()
 *   - `dwalletNetworkEncryptionKeyId: networkKey.id`
 *   - `suiCoin: tx.splitCoins(tx.gas, [...])`
 *   Then run `acceptEncryptedUserShare` to activate, and store the encrypted share ID.
 *
 * Key API corrections vs the original broken template:
 *   1. `IkaNetworkConfig` is NOT exported — use `ReturnType<typeof getNetworkConfig>`
 *   2. `requestDWalletDKG` param `dkgInput` → `dkgRequestInput`
 *   3. `requestDWalletDKG` was missing `suiCoin` and `dwalletNetworkEncryptionKeyId`
 *   4. Session: `createSessionIdentifier()` creates a NEW random one each call;
 *      use `registerSessionIdentifier(sessionId)` to bind to the DKG session bytes
 *   5. `userShareEncryptionKeys.toBytes()` → `toShareEncryptionKeysBytes()`
 *   6. @mysten/sui must be ≥1.44.0 to match @ika.xyz/sdk's peer dep
 */

import {
  IkaClient,
  IkaTransaction,
  UserShareEncryptionKeys,
  Curve,
  SignatureAlgorithm,
  Hash,
  getNetworkConfig,
  prepareDKGAsync,
  createRandomSessionIdentifier,
  type SharedDWallet,
} from '@ika.xyz/sdk';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { randomBytes } from '@noble/hashes/utils';

// Correct type — IkaNetworkConfig is not a named SDK export.
type IkaConfig = ReturnType<typeof getNetworkConfig>;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DWalletIds {
  dwalletId: string;
  dwalletCapId: string;
}

export interface SignResult {
  signature: Uint8Array;
  signSessionId: string;
}

// ── DWalletClient ─────────────────────────────────────────────────────────────

export class DWalletClient {
  private readonly ikaClient: IkaClient;
  private readonly suiClient: SuiClient;
  private readonly keypair: Ed25519Keypair;
  // IkaConfig is ReturnType<typeof getNetworkConfig>, not IkaNetworkConfig
  private readonly config: IkaConfig;

  constructor(opts: {
    rpcUrl: string;
    config: IkaConfig;
    keypair: Ed25519Keypair;
  }) {
    this.suiClient = new SuiClient({ url: opts.rpcUrl });
    this.keypair = opts.keypair;
    this.config = opts.config;
    // IkaClient accepts { suiClient, config, cache? } — no `network` param
    this.ikaClient = new IkaClient({
      suiClient: this.suiClient,
      config: opts.config,
      cache: true,
    });
  }

  async initialize(): Promise<void> {
    await this.ikaClient.initialize();
  }

  // ── createDWallet ───────────────────────────────────────────────────────────

  /**
   * Create a new SHARED dWallet via 2PC-MPC DKG.
   *
   * Shared dWallets (public user share) let contracts sign without user interaction.
   * Ideal for DAOs, treasuries, and automated systems.
   *
   * Flow:
   *   1. prepareDKGAsync    — local WASM crypto, no RPC calls
   *   2. requestDWalletDKGWithPublicUserShare tx  — on-chain DKG request
   *   3. Transfer DWalletCap to self
   *   4. Poll until dWallet 'Active' (~30–90s, validators run 2PC-MPC)
   *
   * Requires: SUI for gas, IKA for protocol fees.
   */
  async createDWallet(ikaCoinObjectId: string): Promise<DWalletIds> {
    const address = this.keypair.getPublicKey().toSuiAddress();

    // ── Step 1: Local crypto (pure WASM, no network) ──────────────────────────
    const rootSeed = randomBytes(32);
    const userShareEncryptionKeys = await UserShareEncryptionKeys.fromRootSeedKey(
      rootSeed,
      Curve.SECP256K1
    );
    // The sessionId bytes bind prepareDKGAsync with registerSessionIdentifier below.
    const sessionId = createRandomSessionIdentifier();

    // ── Step 2: Prepare DKG input ─────────────────────────────────────────────
    const dkgInput = await prepareDKGAsync(
      this.ikaClient,
      Curve.SECP256K1,
      userShareEncryptionKeys,
      sessionId,
      address
    );
    // dkgInput: { userDKGMessage, userPublicOutput, userSecretKeyShare, encryptedUserShareAndProof? }

    // ── Step 3: Get current network encryption key ────────────────────────────
    const networkKey = await this.ikaClient.getLatestNetworkEncryptionKey();

    // ── Step 4: Build + execute DKG transaction ───────────────────────────────
    const tx = new Transaction();
    // IkaTransaction requires userShareEncryptionKeys even for shared dWallets —
    // the WASM crypto layer needs it during the DKG protocol setup.
    const ikaTx = new IkaTransaction({
      ikaClient: this.ikaClient,
      transaction: tx,
      userShareEncryptionKeys,
    });

    // requestDWalletDKGWithPublicUserShare creates a shared (public-user-share) dWallet.
    // For ZERO-TRUST, use requestDWalletDKG({ dkgRequestInput: dkgInput, ... }) instead.
    const [dWalletCapRef] = await ikaTx.requestDWalletDKGWithPublicUserShare({
      publicKeyShareAndProof: dkgInput.userDKGMessage,
      publicUserSecretKeyShare: dkgInput.userSecretKeyShare,
      userPublicOutput: dkgInput.userPublicOutput,
      curve: Curve.SECP256K1,
      dwalletNetworkEncryptionKeyId: networkKey.id,
      // registerSessionIdentifier MUST use the same bytes passed to prepareDKGAsync.
      // createSessionIdentifier() generates a DIFFERENT random session — do not use it here.
      sessionIdentifier: ikaTx.registerSessionIdentifier(sessionId),
      ikaCoin: tx.object(ikaCoinObjectId),
      suiCoin: tx.splitCoins(tx.gas, [tx.pure.u64(20_000_000)]),
    });

    tx.transferObjects([dWalletCapRef], tx.pure.address(address));
    tx.setGasBudget(300_000_000);

    const result = await this.suiClient.signAndExecuteTransaction({
      signer: this.keypair,
      transaction: tx,
      options: { showEffects: true, showObjectChanges: true },
    });

    if (result.effects?.status.status !== 'success') {
      throw new Error(`DKG transaction failed: ${JSON.stringify(result.effects?.status)}`);
    }

    // ── Step 5: Extract DWalletCap ID from transaction result ─────────────────
    const capId = findCreatedObjectId(result.objectChanges ?? [], 'DWalletCap');
    if (!capId) {
      throw new Error(
        'DWalletCap not found in transaction objectChanges. ' +
          'Check that the IKA coin had sufficient balance and gas was adequate.'
      );
    }

    // Read the cap content to get the dWallet ID
    const capObj = await this.suiClient.getObject({ id: capId, options: { showContent: true } });
    const capFields = (capObj.data?.content as { fields?: Record<string, unknown> })?.fields;
    const rawDwalletId = capFields?.dwallet_id;
    const dwalletId =
      typeof rawDwalletId === 'string'
        ? rawDwalletId
        : (rawDwalletId as { id: string } | undefined)?.id;

    if (!dwalletId) {
      throw new Error('Could not extract dwallet_id from DWalletCap content');
    }

    // ── Step 6: Poll until dWallet is Active (~30–90s on testnet) ────────────
    await this.ikaClient.getDWalletInParticularState(dwalletId, 'Active', {
      timeout: 120_000,
      interval: 2_000,
    });

    return { dwalletId, dwalletCapId: capId };
  }

  // ── signMessage ─────────────────────────────────────────────────────────────

  /**
   * Sign a message with an existing shared dWallet.
   *
   * Flow:
   *   1. requestGlobalPresign tx   — pre-compute signing nonce on-chain
   *   2. Wait for presign 'Completed' (~30–60s, validators run 2PC-MPC presign)
   *   3. approveMessage + requestSign tx  — submit the actual sign request
   *   4. Wait for sign 'Completed' (~30–60s, validators complete the signing)
   *   5. Extract and return signature bytes
   *
   * @param message   - Raw bytes to sign (Bitcoin tx hash, EVM tx hash, etc.)
   * @param dwalletId - dWallet object ID from createDWallet
   * @param dwalletCapId - DWalletCap object ID from createDWallet
   * @param ikaCoinObjectId - IKA coin object ID for protocol fees
   */
  async signMessage(opts: {
    message: Uint8Array;
    dwalletId: string;
    dwalletCapId: string;
    ikaCoinObjectId: string;
  }): Promise<SignResult> {
    const address = this.keypair.getPublicKey().toSuiAddress();
    const networkKey = await this.ikaClient.getLatestNetworkEncryptionKey();

    // ── Step 1: Request global presign ───────────────────────────────────────
    const presignTx = new Transaction();
    // No userShareEncryptionKeys needed for signing a shared dWallet
    const presignIkaTx = new IkaTransaction({
      ikaClient: this.ikaClient,
      transaction: presignTx,
    });

    // requestGlobalPresign is synchronous — it adds the PTB call, returns a result ref.
    // Use global presigns for Taproot, EdDSA, and ECDSASecp256k1 (non-imported key).
    const presignCapRef = presignIkaTx.requestGlobalPresign({
      dwalletNetworkEncryptionKeyId: networkKey.id,
      curve: Curve.SECP256K1,
      signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
      ikaCoin: presignTx.object(opts.ikaCoinObjectId),
      suiCoin: presignTx.splitCoins(presignTx.gas, [presignTx.pure.u64(10_000_000)]),
    });

    presignTx.transferObjects([presignCapRef], presignTx.pure.address(address));
    presignTx.setGasBudget(100_000_000);

    const presignResult = await this.suiClient.signAndExecuteTransaction({
      signer: this.keypair,
      transaction: presignTx,
      options: { showEffects: true, showObjectChanges: true },
    });

    if (presignResult.effects?.status.status !== 'success') {
      throw new Error('Presign transaction failed');
    }

    // The presign cap (UnverifiedPresignCap) is a Sui object — its ID is used for polling.
    const presignCapId = findCreatedObjectId(
      presignResult.objectChanges ?? [],
      'UnverifiedPresignCap'
    );
    if (!presignCapId) throw new Error('UnverifiedPresignCap not found in presign transaction');

    // ── Step 2: Wait for presign completion (~30–60s on testnet) ────────────
    console.log('   Waiting for presign completion (~30–60s)...');
    const completedPresign = await this.ikaClient.getPresignInParticularState(
      presignCapId,
      'Completed',
      { timeout: 120_000, interval: 2_000 }
    );

    // ── Step 3: Get dWallet object ────────────────────────────────────────────
    const dWallet = await this.ikaClient.getDWallet(opts.dwalletId);

    // ── Step 4: Build sign transaction ───────────────────────────────────────
    const signTx = new Transaction();
    const signIkaTx = new IkaTransaction({
      ikaClient: this.ikaClient,
      transaction: signTx,
    });

    // verifyPresignCap converts UnverifiedPresignCap → VerifiedPresignCap within the PTB
    const verifiedPresignCap = signIkaTx.verifyPresignCap({ presign: completedPresign });

    // approveMessage: dWalletCap accepts a string ID or TransactionObjectArgument
    const messageApproval = signIkaTx.approveMessage({
      dWalletCap: opts.dwalletCapId,
      curve: Curve.SECP256K1,
      signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
      hashScheme: Hash.SHA256,
      message: opts.message,
    });

    // requestSign: shared dWallet needs no encryptedUserSecretKeyShare or secretShare
    const signRef = await signIkaTx.requestSign({
      dWallet: dWallet as SharedDWallet,
      messageApproval,
      hashScheme: Hash.SHA256,
      verifiedPresignCap,
      presign: completedPresign,
      message: opts.message,
      signatureScheme: SignatureAlgorithm.ECDSASecp256k1,
      ikaCoin: signTx.object(opts.ikaCoinObjectId),
      suiCoin: signTx.splitCoins(signTx.gas, [signTx.pure.u64(10_000_000)]),
    });

    // Transfer the sign session object to self so it appears in objectChanges
    signTx.transferObjects([signRef as ReturnType<typeof signTx.object>], signTx.pure.address(address));
    signTx.setGasBudget(150_000_000);

    const signTxResult = await this.suiClient.signAndExecuteTransaction({
      signer: this.keypair,
      transaction: signTx,
      options: { showEffects: true, showObjectChanges: true, showEvents: true },
    });

    if (signTxResult.effects?.status.status !== 'success') {
      throw new Error('Sign transaction failed');
    }

    // SignSession is a proper Sui object — find it in objectChanges.
    // Fallback: some builds store it only in coordinator dynamic fields; use events then.
    const signSessionId =
      findCreatedObjectId(signTxResult.objectChanges ?? [], 'SignSession') ??
      extractIdFromEvents(signTxResult.events ?? [], 'sign_session_id') ??
      extractIdFromEvents(signTxResult.events ?? [], 'session_id');

    if (!signSessionId) {
      throw new Error(
        'Sign session ID not found in transaction output or events. ' +
          'Check transaction on explorer: https://suiscan.xyz/testnet/tx/' +
          signTxResult.digest
      );
    }

    // ── Step 5: Wait for signature (~30–60s on testnet) ─────────────────────
    console.log('   Waiting for signature (~30–60s)...');
    const completedSign = await this.ikaClient.getSignInParticularState(
      signSessionId,
      Curve.SECP256K1,             // Curve enum value, not a string
      SignatureAlgorithm.ECDSASecp256k1, // SignatureAlgorithm enum value, not a string
      'Completed',
      { timeout: 120_000, interval: 2_000 }
    );

    // Extract the raw signature bytes from the completed state
    const signatureBytes = (completedSign.state as { Completed?: { signature: number[] } })
      ?.Completed?.signature;

    if (!signatureBytes) {
      throw new Error('Signature not found in completed sign session state');
    }

    return {
      signature: Uint8Array.from(signatureBytes),
      signSessionId,
    };
  }
}

// ── Utility helpers ─────────────────────────────────────────────────────────

/**
 * Find the first created object ID whose `objectType` contains a keyword.
 * Ika object types look like:
 *   0x6573...::coordinator_inner::DWalletCap
 *   0x6573...::coordinator_inner::UnverifiedPresignCap
 *   0x6573...::coordinator_inner::SignSession
 */
function findCreatedObjectId(
  objectChanges: Array<{ type: string; objectType?: string; objectId?: string }>,
  typeKeyword: string
): string | undefined {
  return objectChanges.find(
    (c) => c.type === 'created' && c.objectType?.includes(typeKeyword)
  )?.objectId;
}

/**
 * Try to extract an ID from emitted events by scanning parsedJson fields.
 */
function extractIdFromEvents(
  events: Array<{ parsedJson?: unknown }>,
  fieldName: string
): string | undefined {
  for (const ev of events) {
    const json = ev.parsedJson as Record<string, unknown> | undefined;
    if (json && typeof json[fieldName] === 'string') {
      return json[fieldName] as string;
    }
  }
  return undefined;
}
