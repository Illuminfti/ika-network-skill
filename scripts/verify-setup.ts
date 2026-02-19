#!/usr/bin/env tsx
/**
 * verify-setup.ts — Verify Ika Network SDK is correctly configured
 *
 * Runs a series of connectivity and SDK checks against testnet:
 *   1. SuiClient connection (epoch query)
 *   2. IkaClient initialization
 *   3. Network encryption key fetch
 *   4. Protocol public parameters
 *   5. Coordinator object ID resolution
 *
 * Usage:
 *   pnpm add -D tsx @ika.xyz/sdk @mysten/sui  (if not already installed)
 *   npx tsx verify-setup.ts
 *   # or from the project-template directory:
 *   pnpm dev:verify
 *
 * No private key or IKA tokens required — read-only calls only.
 */

import { IkaClient, getNetworkConfig, Curve } from '@ika.xyz/sdk';
import { SuiClient } from '@mysten/sui/client';

// ── Configuration ─────────────────────────────────────────────────────────────

const NETWORK = (process.env.NETWORK ?? 'testnet') as 'testnet' | 'mainnet';

// IMPORTANT: Use publicnode, NOT the default Sui RPC.
// The default https://fullnode.testnet.sui.io returns 429 for the SDK's
// multi-call patterns (fetchAllDynamicFields, etc.).
const RPC_URLS = {
  testnet: 'https://sui-testnet-rpc.publicnode.com',
  mainnet: 'https://ikafn-on-sui-2-mainnet.ika-network.net/',
} as const;

const RPC_URL = process.env.RPC_URL ?? RPC_URLS[NETWORK];

// ── Check runner ──────────────────────────────────────────────────────────────

interface CheckResult {
  name: string;
  passed: boolean;
  value?: string;
  error?: string;
}

async function runCheck(
  name: string,
  fn: () => Promise<string>
): Promise<CheckResult> {
  try {
    const value = await fn();
    return { name, passed: true, value };
  } catch (err) {
    return {
      name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function printResult(result: CheckResult): void {
  const icon = result.passed ? '✅' : '❌';
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(`  ${icon} [${status}] ${result.name}`);
  if (result.passed && result.value) {
    console.log(`         → ${result.value}`);
  }
  if (!result.passed && result.error) {
    console.log(`         ↳ ${result.error}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n🔍 Ika Network Setup Verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Network: ${NETWORK}`);
  console.log(`  RPC:     ${RPC_URL}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── Set up clients ─────────────────────────────────────────────────────────
  const suiClient = new SuiClient({ url: RPC_URL });
  const ikaConfig = getNetworkConfig(NETWORK);
  const ikaClient = new IkaClient({
    suiClient,
    config: ikaConfig,
    cache: true,
  });

  const results: CheckResult[] = [];

  // ── Check 1: SuiClient — basic RPC connectivity ───────────────────────────
  results.push(
    await runCheck('SuiClient RPC connectivity (epoch query)', async () => {
      const { epoch } = await suiClient.getLatestSuiSystemState();
      return `Current epoch: ${epoch}`;
    })
  );

  // ── Check 2: IkaClient initialization ────────────────────────────────────
  results.push(
    await runCheck('IkaClient initialization', async () => {
      await ikaClient.initialize();
      const epoch = await ikaClient.getEpoch();
      return `Ika epoch: ${epoch}`;
    })
  );

  // ── Check 3: Network encryption key ──────────────────────────────────────
  let networkKeyId: string | undefined;
  results.push(
    await runCheck('Latest network encryption key', async () => {
      const key = await ikaClient.getLatestNetworkEncryptionKey();
      networkKeyId = key.id;
      return `Key ID: ${key.id} (epoch: ${key.epoch})`;
    })
  );

  // ── Check 4: Protocol public parameters (crypto parameters) ──────────────
  results.push(
    await runCheck('Protocol public parameters (SECP256K1)', async () => {
      if (!networkKeyId) throw new Error('Skipped — network key not available');
      const params = await ikaClient.getProtocolPublicParameters(undefined, Curve.SECP256K1);
      // Parameters are large binary blobs; just confirm they exist
      const size = JSON.stringify(params).length;
      return `Fetched (${size} chars of parameters)`;
    })
  );

  // ── Check 5: Coordinator object ID ───────────────────────────────────────
  results.push(
    await runCheck('DWalletCoordinator object resolution', async () => {
      const coordinatorId = ikaConfig.objects.ikaDWalletCoordinator.objectID;
      // Verify the coordinator object exists on chain
      const obj = await suiClient.getObject({
        id: coordinatorId,
        options: { showType: true },
      });
      if (obj.error) throw new Error(`Object error: ${obj.error.code}`);
      return `ID: ${coordinatorId} (type: ${obj.data?.type?.slice(-40)})`;
    })
  );

  // ── Check 6: Ika package addresses (config sanity) ────────────────────────
  results.push(
    await runCheck('Network config package addresses', async () => {
      const pkgs = ikaConfig.packages;
      const coordId = ikaConfig.objects.ikaDWalletCoordinator.objectID;
      return [
        `ikaDwallet2pcMpcPackage: ${pkgs.ikaDwallet2pcMpcPackage}`,
        `         coordinatorId: ${coordId}`,
      ].join('\n         ');
    })
  );

  // ── Print results ─────────────────────────────────────────────────────────
  for (const result of results) {
    printResult(result);
    console.log('');
  }

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (passed === total) {
    console.log(`\n✅ All ${total} checks passed. Your setup is ready!\n`);
    console.log('Next steps:');
    console.log('  1. Get SUI testnet tokens: https://faucet.testnet.sui.io/');
    console.log('  2. Get IKA tokens: https://faucet.ika.xyz/ (swap SUI → IKA)');
    console.log('  3. Set PRIVATE_KEY + IKA_COIN_OBJECT_ID in .env');
    console.log('  4. pnpm dev  (runs src/index.ts — full DKG + sign demo)\n');
  } else {
    console.log(`\n⚠️  ${passed}/${total} checks passed.\n`);

    const failed = results.filter((r) => !r.passed);
    console.log('Failed checks:');
    for (const f of failed) {
      console.log(`  • ${f.name}: ${f.error}`);
    }

    console.log('\nCommon fixes:');
    console.log('  • 429 / rate-limited: default Sui RPC is throttled. Use:');
    console.log('    export RPC_URL=https://sui-testnet-rpc.publicnode.com');
    console.log('  • IkaClient init fails: check @ika.xyz/sdk version (need 0.2.7)');
    console.log('  • pnpm install missing: run pnpm install first\n');

    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n❌ Unexpected error:', err.message);
  if (err.cause) console.error('   Cause:', err.cause);
  process.exit(1);
});
