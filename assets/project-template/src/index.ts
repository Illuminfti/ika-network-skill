/**
 * Ika dWallet — basic flow
 *
 * Setup:
 *   cp .env.example .env
 *   # Fill in PRIVATE_KEY and IKA_COIN_OBJECT_ID
 *   pnpm install
 *   pnpm dev
 *
 * What this does:
 *   1. Connect to Ika testnet (via publicnode RPC — the default Sui RPC rate-limits)
 *   2. Create a shared dWallet (DKG — ~30–90s on testnet for validators to process)
 *   3. Sign a test message (presign + sign, another ~60–120s)
 *   4. Print the signature
 *
 * Prerequisites:
 *   - SUI tokens for gas: https://faucet.testnet.sui.io/
 *   - IKA tokens for protocol fees: https://faucet.ika.xyz/ (swap SUI → IKA)
 *   - Note your IKA coin object ID: sui client objects --json | grep -A3 IKA
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildConfig } from './config.js';
import { DWalletClient } from './dwallet.js';

async function main() {
  // ── Configuration ────────────────────────────────────────────────────────
  const config = buildConfig();

  const privateKeyRaw = process.env.PRIVATE_KEY;
  if (!privateKeyRaw) throw new Error('PRIVATE_KEY not set in .env');

  const ikaCoinObjectId = process.env.IKA_COIN_OBJECT_ID;
  if (!ikaCoinObjectId) {
    throw new Error(
      'IKA_COIN_OBJECT_ID not set.\n' +
        'Get IKA testnet tokens at https://faucet.ika.xyz/ (swap SUI → IKA)\n' +
        'Then find your coin: sui client objects --json | grep -B2 -A8 IKA'
    );
  }

  // Parse keypair — supports both raw hex and Sui bech32 format
  const keypair = Ed25519Keypair.fromSecretKey(privateKeyRaw);
  const address = keypair.getPublicKey().toSuiAddress();
  console.log(`\n🔑 Address: ${address}`);
  console.log(`🌐 Network: ${config.network}`);
  console.log(`📡 RPC:     ${config.rpcUrl}\n`);

  // ── Connect ───────────────────────────────────────────────────────────────
  const client = new DWalletClient({
    rpcUrl: config.rpcUrl,
    config: config.ika,
    keypair,
  });

  await client.initialize();
  console.log('✅ Connected to Ika network');

  // ── Create dWallet ─────────────────────────────────────────────────────────
  console.log('\n⏳ Creating shared dWallet (DKG)...');
  console.log('   Validators run 2PC-MPC DKG in the background. This takes ~30–90s.');

  const wallet = await client.createDWallet(ikaCoinObjectId);

  console.log('\n✅ dWallet created!');
  console.log(`   dWalletId:    ${wallet.dwalletId}`);
  console.log(`   dWalletCapId: ${wallet.dwalletCapId}`);
  console.log('\n💾 Save these IDs — you need them to sign later.');

  // ── Sign a message ──────────────────────────────────────────────────────────
  const messageToSign = new TextEncoder().encode('Hello from Ika dWallet!');
  console.log(`\n⏳ Signing message: "${new TextDecoder().decode(messageToSign)}"...`);
  console.log('   Step 1/2: Requesting presign (~30–60s)...');

  const { signature, signSessionId } = await client.signMessage({
    message: messageToSign,
    dwalletId: wallet.dwalletId,
    dwalletCapId: wallet.dwalletCapId,
    ikaCoinObjectId,
  });

  console.log('\n✅ Message signed!');
  console.log(`   Signature (hex): ${Buffer.from(signature).toString('hex')}`);
  console.log(`   Sign session:    ${signSessionId}`);
  console.log('\n🎉 Done! Use the signature on your target chain (BTC, ETH, SOL, etc.)');
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  if (err.cause) console.error('   Cause:', err.cause);
  process.exit(1);
});
