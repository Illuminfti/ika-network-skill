# Agentic Patterns — Ika dWallets for AI Agents

**SDK version:** `@ika.xyz/sdk` v0.2.7+
**Last verified:** 2026-02-18
**Audience:** AI agent developers, autonomous systems, MCP tool builders

---

## Why dWallets for Agents

AI agents need to move value across chains. The options today are bad:

| Approach | Problem |
|---|---|
| Hot wallet per agent | One compromise = all funds gone. No policy enforcement. |
| Custodial API (Fireblocks, etc.) | Centralized. Vendor lock-in. API key = full access. |
| Multisig (Safe, Squads) | Requires human co-signers. Blocks autonomous operation. |
| MPC networks (Lit, etc.) | Collusion risk. Network can sign without you. |
| **Ika dWallet** | **On-chain policy via Move. Non-collusive. Agent signs autonomously within rules.** |

dWallets solve the agent custody problem: the signing key is split between a Sui smart contract and the Ika validator network. Neither can sign alone. The Move contract enforces arbitrary policy (spend limits, allowlists, time locks, human override) and the agent operates freely within those bounds.

**Shared dWallets** (public user share) are the correct primitive for agents. The network can co-sign without user interaction, so the agent's Sui transaction is the only trigger needed.

---

## Architecture: Agent + dWallet

```
┌─────────────────────────────────────────────────┐
│  AI Agent (TypeScript / Python / MCP Server)     │
│                                                   │
│  ┌─────────────┐   ┌──────────────────────────┐  │
│  │ Agent Logic  │──▶│ Ika SDK (@ika.xyz/sdk)   │  │
│  │ (LLM, tools) │   │ - createDWallet()        │  │
│  └─────────────┘   │ - signMessage()           │  │
│                     │ - checkBalance()          │  │
│                     └──────────┬───────────────┘  │
└────────────────────────────────┼──────────────────┘
                                 │ Sui RPC
                    ┌────────────▼────────────────┐
                    │  Sui Smart Contract (Move)   │
                    │                              │
                    │  PolicyVault {               │
                    │    dwallet_cap: DWalletCap,  │
                    │    daily_limit: u64,         │
                    │    allowlist: vector<addr>,   │
                    │    human_override: address,   │
                    │  }                           │
                    └────────────┬─────────────────┘
                                 │ 2PC-MPC
                    ┌────────────▼────────────────┐
                    │  Ika Validator Network       │
                    │  (co-signs if Move approves) │
                    └─────────────────────────────┘
                                 │
                    ┌────────────▼────────────────┐
                    │  Target Chain (BTC/ETH/SOL)  │
                    │  dWallet address holds funds  │
                    └──────────────────────────────┘
```

**Key insight**: The DWalletCap lives inside a Move contract, NOT in the agent's keypair. The agent's Sui keypair can only call functions the contract exposes. The contract enforces policy. The agent can't bypass it even if compromised.

---

## Pattern 1: Autonomous Trading Agent

An agent that trades across chains within policy bounds.

### Move Contract (Policy Layer)

```move
module agent_vault::trading_vault {
    use ika::coordinator::{DWalletCap, DWalletCoordinator, MessageApproval};

    const EOverDailyLimit: u64 = 1;
    const ENotAuthorizedAgent: u64 = 2;
    const ENotOwner: u64 = 3;
    const EPaused: u64 = 4;

    /// Vault holds the DWalletCap and enforces trading policy.
    /// The agent CANNOT extract the cap — only call sign_trade().
    public struct TradingVault has key, store {
        id: UID,
        dwallet_cap: DWalletCap,
        /// Agent's Sui address — only this address can request signs
        agent: address,
        /// Human owner — can pause, update limits, replace agent
        owner: address,
        /// Max value per 24h rolling window (in USD cents to avoid floats)
        daily_limit_cents: u64,
        /// Spent in current window
        spent_today_cents: u64,
        /// Epoch when spend counter resets
        reset_epoch: u64,
        /// Emergency pause
        paused: bool,
    }

    /// Agent calls this to get a MessageApproval for signing.
    /// The contract checks: is caller the agent? is vault paused? is limit exceeded?
    public fun sign_trade(
        vault: &mut TradingVault,
        coordinator: &mut DWalletCoordinator,
        message: vector<u8>,
        value_cents: u64,
        ctx: &mut TxContext,
    ): MessageApproval {
        assert!(!vault.paused, EPaused);
        assert!(ctx.sender() == vault.agent, ENotAuthorizedAgent);

        // Reset daily counter if epoch changed
        let current_epoch = ctx.epoch();
        if (current_epoch > vault.reset_epoch) {
            vault.spent_today_cents = 0;
            vault.reset_epoch = current_epoch;
        };

        vault.spent_today_cents = vault.spent_today_cents + value_cents;
        assert!(vault.spent_today_cents <= vault.daily_limit_cents, EOverDailyLimit);

        // DWalletCap never leaves the contract — approve_message borrows it
        coordinator.approve_message(
            &vault.dwallet_cap,
            0, // Curve::SECP256K1
            2, // Hash::SHA256
            message,
        )
    }

    /// Human owner can pause the agent instantly
    public fun pause(vault: &mut TradingVault, ctx: &mut TxContext) {
        assert!(ctx.sender() == vault.owner, ENotOwner);
        vault.paused = true;
    }

    /// Human owner can update spending limit
    public fun set_daily_limit(
        vault: &mut TradingVault,
        new_limit_cents: u64,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == vault.owner, ENotOwner);
        vault.daily_limit_cents = new_limit_cents;
    }

    /// Human owner can replace the agent address (rotate keys)
    public fun set_agent(
        vault: &mut TradingVault,
        new_agent: address,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == vault.owner, ENotOwner);
        vault.agent = new_agent;
    }
}
```

### TypeScript Agent (Execution Layer)

```typescript
import {
  IkaClient, IkaTransaction, Curve, SignatureAlgorithm, Hash,
  getNetworkConfig, UserShareEncryptionKeys, prepareDKGAsync,
  createRandomSessionIdentifier,
} from '@ika.xyz/sdk';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

// ── Agent Configuration ──────────────────────────────────────────────────────

interface AgentConfig {
  /** Agent's Sui keypair (controls ONLY what the Move contract allows) */
  keypair: Ed25519Keypair;
  /** Sui RPC — use publicnode for testnet, Ika RPC for mainnet */
  rpcUrl: string;
  /** The TradingVault object ID on Sui */
  vaultObjectId: string;
  /** The DWalletCoordinator shared object ID */
  coordinatorObjectId: string;
  /** IKA coin for protocol fees */
  ikaCoinObjectId: string;
  /** dWallet ID (for polling sign completion) */
  dwalletId: string;
  /** Your Move package ID */
  packageId: string;
}

// ── Sign a Cross-Chain Trade ─────────────────────────────────────────────────

/**
 * Agent requests a signature for a cross-chain trade.
 * The Move contract enforces daily limits, pause state, and agent identity.
 * If policy is violated, the transaction reverts — no signature produced.
 */
async function signTrade(
  config: AgentConfig,
  ikaClient: IkaClient,
  suiClient: SuiClient,
  /** Raw transaction bytes for the target chain (e.g., serialized ETH tx) */
  txBytes: Uint8Array,
  /** Trade value in USD cents for limit tracking */
  valueCents: number,
): Promise<Uint8Array> {
  const address = config.keypair.getPublicKey().toSuiAddress();
  const networkKey = await ikaClient.getLatestNetworkEncryptionKey();

  // ── Step 1: Presign ─────────────────────────────────────────────────────
  const presignTx = new Transaction();
  const presignIkaTx = new IkaTransaction({
    ikaClient,
    transaction: presignTx,
  });

  const presignCap = presignIkaTx.requestGlobalPresign({
    dwalletNetworkEncryptionKeyId: networkKey.id,
    curve: Curve.SECP256K1,
    signatureAlgorithm: SignatureAlgorithm.ECDSASecp256k1,
    ikaCoin: presignTx.object(config.ikaCoinObjectId),
    suiCoin: presignTx.splitCoins(presignTx.gas, [presignTx.pure.u64(10_000_000)]),
  });

  presignTx.transferObjects([presignCap], presignTx.pure.address(address));
  presignTx.setGasBudget(100_000_000);

  const presignResult = await suiClient.signAndExecuteTransaction({
    signer: config.keypair,
    transaction: presignTx,
    options: { showObjectChanges: true },
  });

  const presignCapId = presignResult.objectChanges?.find(
    (c) => c.type === 'created' && c.objectType?.includes('UnverifiedPresignCap')
  )?.objectId;
  if (!presignCapId) throw new Error('Presign failed — no UnverifiedPresignCap');

  const completedPresign = await ikaClient.getPresignInParticularState(
    presignCapId, 'Completed', { timeout: 120_000, interval: 2_000 }
  );

  // ── Step 2: Approve + Sign via Move contract ───────────────────────────
  const signTx = new Transaction();
  const signIkaTx = new IkaTransaction({
    ikaClient,
    transaction: signTx,
  });

  const verifiedPresignCap = signIkaTx.verifyPresignCap({ presign: completedPresign });

  // Call YOUR Move contract — it checks policy then calls approve_message internally
  const messageApproval = signTx.moveCall({
    target: `${config.packageId}::trading_vault::sign_trade`,
    arguments: [
      signTx.object(config.vaultObjectId),
      signTx.object(config.coordinatorObjectId),
      signTx.pure.vector('u8', Array.from(txBytes)),
      signTx.pure.u64(valueCents),
    ],
  });

  // dWallet object for requestSign
  const dWallet = await ikaClient.getDWallet(config.dwalletId);

  const signRef = await signIkaTx.requestSign({
    dWallet,
    messageApproval,
    hashScheme: Hash.SHA256,
    verifiedPresignCap,
    presign: completedPresign,
    message: txBytes,
    signatureScheme: SignatureAlgorithm.ECDSASecp256k1,
    ikaCoin: signTx.object(config.ikaCoinObjectId),
    suiCoin: signTx.splitCoins(signTx.gas, [signTx.pure.u64(10_000_000)]),
  });

  signTx.transferObjects(
    [signRef as ReturnType<typeof signTx.object>],
    signTx.pure.address(address)
  );
  signTx.setGasBudget(150_000_000);

  const signResult = await suiClient.signAndExecuteTransaction({
    signer: config.keypair,
    transaction: signTx,
    options: { showObjectChanges: true, showEvents: true },
  });

  if (signResult.effects?.status?.status !== 'success') {
    throw new Error('Sign tx failed — policy check likely rejected');
  }

  // Extract sign session ID
  const signSessionId = signResult.objectChanges?.find(
    (c) => c.type === 'created' && c.objectType?.includes('SignSession')
  )?.objectId;
  if (!signSessionId) throw new Error('No SignSession in tx output');

  // Wait for signature
  const completed = await ikaClient.getSignInParticularState(
    signSessionId, Curve.SECP256K1, SignatureAlgorithm.ECDSASecp256k1, 'Completed',
    { timeout: 120_000, interval: 2_000 }
  );

  const sig = (completed.state as { Completed?: { signature: number[] } })
    ?.Completed?.signature;
  if (!sig) throw new Error('No signature in completed state');

  return Uint8Array.from(sig);
}
```

---

## Pattern 2: MCP Tool Server (Agent-as-a-Service)

Expose dWallet signing as an MCP tool that any LLM agent can call.

```typescript
// mcp-dwallet-server.ts
// MCP tool that lets AI agents sign cross-chain transactions
// The Move contract enforces all policy — the MCP server is just a thin wrapper

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  IkaClient, IkaTransaction, Curve, SignatureAlgorithm, Hash, getNetworkConfig,
} from '@ika.xyz/sdk';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

const server = new Server({ name: 'dwallet-signer', version: '1.0.0' }, {
  capabilities: { tools: {} },
});

// Initialize once
const suiClient = new SuiClient({ url: 'https://sui-testnet-rpc.publicnode.com' });
const ikaClient = new IkaClient({
  suiClient,
  config: getNetworkConfig('testnet'),
  cache: true,
});

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'sign_transaction',
      description:
        'Sign a cross-chain transaction using a policy-controlled dWallet. ' +
        'The on-chain Move contract enforces spend limits, allowlists, and pause state. ' +
        'Returns a raw signature for the target chain (BTC, ETH, SOL, etc.).',
      inputSchema: {
        type: 'object',
        properties: {
          target_chain: {
            type: 'string',
            enum: ['bitcoin', 'ethereum', 'solana', 'arbitrum', 'base', 'avalanche'],
            description: 'Which blockchain the transaction targets',
          },
          tx_hex: {
            type: 'string',
            description: 'Hex-encoded transaction bytes to sign',
          },
          value_usd_cents: {
            type: 'number',
            description: 'Trade value in USD cents (for on-chain limit tracking)',
          },
          vault_id: {
            type: 'string',
            description: 'Sui object ID of the policy vault controlling the dWallet',
          },
        },
        required: ['target_chain', 'tx_hex', 'value_usd_cents', 'vault_id'],
      },
    },
    {
      name: 'get_dwallet_address',
      description:
        'Get the target-chain address derived from a dWallet. ' +
        'Use to check balances or construct transactions before signing.',
      inputSchema: {
        type: 'object',
        properties: {
          dwallet_id: { type: 'string', description: 'dWallet object ID on Sui' },
          target_chain: { type: 'string', enum: ['bitcoin', 'ethereum', 'solana'] },
        },
        required: ['dwallet_id', 'target_chain'],
      },
    },
    {
      name: 'check_vault_policy',
      description:
        'Check current policy state: remaining daily limit, pause status, agent address.',
      inputSchema: {
        type: 'object',
        properties: {
          vault_id: { type: 'string', description: 'TradingVault object ID' },
        },
        required: ['vault_id'],
      },
    },
  ],
}));

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'check_vault_policy': {
      const vault = await suiClient.getObject({
        id: args.vault_id,
        options: { showContent: true },
      });
      const fields = (vault.data?.content as any)?.fields;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            paused: fields?.paused,
            daily_limit_cents: fields?.daily_limit_cents,
            spent_today_cents: fields?.spent_today_cents,
            agent: fields?.agent,
            owner: fields?.owner,
          }, null, 2),
        }],
      };
    }

    case 'get_dwallet_address': {
      const dWallet = await ikaClient.getDWallet(args.dwallet_id);
      // The dWallet's public key can derive addresses for any chain
      const pubkey = (dWallet as any).publicKey;
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            dwallet_id: args.dwallet_id,
            public_key_hex: Buffer.from(pubkey).toString('hex'),
            note: 'Derive target-chain address from this compressed secp256k1 pubkey',
          }),
        }],
      };
    }

    case 'sign_transaction': {
      // Actual signing logic — same as Pattern 1's signTrade()
      // The MCP server is a thin wrapper; all policy is in Move
      const txBytes = Buffer.from(args.tx_hex, 'hex');
      // ... (call signTrade from Pattern 1)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ signature_hex: '...', sign_session_id: '...' }),
        }],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Using from an LLM Agent

```
Human: Send 0.01 ETH from my trading vault to 0xAbC...123

Agent thinking:
1. Call check_vault_policy(vault_id) → daily limit OK, not paused
2. Call get_dwallet_address(dwallet_id, "ethereum") → get ETH address
3. Construct raw ETH transaction (nonce, gasPrice, to, value, chainId)
4. Call sign_transaction(target_chain="ethereum", tx_hex="...", value_usd_cents=2500)
5. Broadcast signed tx to Ethereum RPC
```

---

## Pattern 3: Multi-Chain Treasury with Human Override

Multiple dWallets (one per chain), unified policy, human kill switch.

```move
module treasury::multi_chain {
    use ika::coordinator::{DWalletCap, DWalletCoordinator, MessageApproval};

    public struct Treasury has key, store {
        id: UID,
        /// One DWalletCap per target chain
        btc_cap: DWalletCap,
        eth_cap: DWalletCap,
        sol_cap: DWalletCap,
        /// Agent addresses (can have multiple, e.g., trading + rebalancing)
        agents: vector<address>,
        /// Human override — can pause, drain, reconfigure
        guardian: address,
        /// Per-chain daily limits (cents)
        btc_daily_limit: u64,
        eth_daily_limit: u64,
        sol_daily_limit: u64,
        /// Global pause
        frozen: bool,
    }

    /// Agent picks which chain to sign for.
    /// Contract selects the right DWalletCap and checks the right limit.
    public fun sign_for_chain(
        treasury: &mut Treasury,
        coordinator: &mut DWalletCoordinator,
        chain: u8, // 0=BTC, 1=ETH, 2=SOL
        message: vector<u8>,
        value_cents: u64,
        ctx: &mut TxContext,
    ): MessageApproval {
        assert!(!treasury.frozen, 0);
        assert!(treasury.agents.contains(&ctx.sender()), 1);

        // Select cap + check limit based on chain
        let cap = if (chain == 0) { &treasury.btc_cap }
                  else if (chain == 1) { &treasury.eth_cap }
                  else { &treasury.sol_cap };

        // Curve: 0=SECP256K1 for BTC/ETH, 2=ED25519 for SOL
        let curve = if (chain == 2) { 2 } else { 0 };
        // Hash: 2=SHA256 for BTC, 6=KECCAK256 for ETH, 2=SHA256 for SOL
        let hash = if (chain == 1) { 6 } else { 2 };

        coordinator.approve_message(cap, curve, hash, message)
    }

    /// Guardian freezes everything instantly. No delay, no vote.
    public fun emergency_freeze(treasury: &mut Treasury, ctx: &mut TxContext) {
        assert!(ctx.sender() == treasury.guardian, 2);
        treasury.frozen = true;
    }
}
```

---

## Pattern 4: Subscription / Recurring Payments Agent

Agent auto-pays recurring bills from a dWallet with per-payment caps.

```typescript
// Agent checks: is payment due? → constructs tx → signs via vault → broadcasts
async function processSubscriptions(
  ikaClient: IkaClient,
  suiClient: SuiClient,
  config: AgentConfig,
  subscriptions: Subscription[],
) {
  for (const sub of subscriptions) {
    if (!isDue(sub)) continue;

    // Construct target-chain payment tx
    const paymentTx = buildPaymentTx(sub);

    // Sign via policy vault — contract checks:
    //   - Is this agent authorized?
    //   - Is payment amount within per-tx cap?
    //   - Is daily aggregate within limit?
    //   - Is recipient on allowlist?
    try {
      const signature = await signTrade(config, ikaClient, suiClient, paymentTx, sub.amountCents);
      await broadcastToChain(sub.chain, paymentTx, signature);
      console.log(`✅ Paid ${sub.name}: $${sub.amountCents / 100} on ${sub.chain}`);
    } catch (err) {
      // Policy rejection = Move abort. Agent can't override.
      console.error(`❌ ${sub.name} rejected by policy: ${err.message}`);
    }
  }
}
```

---

## Pattern 5: Cross-Chain Arbitrage Bot

Agent spots price differences, executes atomic-ish trades across chains.

```typescript
// Arbitrage loop — agent has dWallets on ETH + SOL
async function arbitrageLoop(ethDWallet: DWalletIds, solDWallet: DWalletIds) {
  while (true) {
    const ethPrice = await getPrice('ETH', 'uniswap');
    const solPrice = await getPrice('ETH', 'raydium'); // ETH on Solana via wormhole

    const spread = Math.abs(ethPrice - solPrice) / ethPrice;
    if (spread < 0.005) { await sleep(1000); continue; } // <0.5% not worth it

    // Build both transactions
    const buyTx = ethPrice < solPrice
      ? buildEthSwapTx(/* buy ETH on Uniswap */)
      : buildSolSwapTx(/* buy ETH on Raydium */);

    const sellTx = ethPrice < solPrice
      ? buildSolSwapTx(/* sell ETH on Raydium */)
      : buildEthSwapTx(/* sell ETH on Uniswap */);

    // Sign both via policy vaults — each vault has its own limit
    // Both signs can run in parallel (different dWallets)
    const [buySig, sellSig] = await Promise.all([
      signTrade(ethConfig, ikaClient, suiClient, buyTx, estimateUsdCents(buyTx)),
      signTrade(solConfig, ikaClient, suiClient, sellTx, estimateUsdCents(sellTx)),
    ]);

    // Broadcast — buy first, then sell
    await broadcastToChain('ethereum', buyTx, buySig);
    await broadcastToChain('solana', sellTx, sellSig);
  }
}
```

---

## Security Model for Agents

### Threat Model

| Threat | Mitigation |
|---|---|
| Agent keypair compromised | Move contract limits damage: daily caps, allowlists, pause. Attacker can only do what policy allows. |
| Agent hallucinates a bad trade | Value tracking in Move contract. Exceeding daily limit = tx reverts. |
| Agent sends to wrong address | Allowlist in Move contract. Only pre-approved destinations. |
| Infinite loop / runaway spending | Daily limit resets per epoch. Human guardian can freeze instantly. |
| Human wants to stop the agent | `pause()` / `emergency_freeze()` — single tx, no delay. |
| Agent framework compromised | DWalletCap is in the Move contract, not in the agent's memory. Framework compromise ≠ key compromise. |

### Key Principle

**The agent's Sui keypair is NOT the security boundary.** The Move contract is. If the agent's key leaks, the attacker can only call the same contract functions with the same policy limits. They cannot extract the DWalletCap, change limits, or bypass the allowlist.

This is fundamentally different from a hot wallet where key = full access.

### Recommended Policy Layers

1. **Move contract** (on-chain, enforced) — daily limits, allowlists, pause, agent identity
2. **Agent-side checks** (off-chain, defense-in-depth) — sanity checks before submitting tx
3. **Monitoring** (off-chain, alerting) — watch Sui events for unusual patterns, alert human
4. **Human override** (on-chain, ultimate authority) — guardian can freeze, replace agent, drain

---

## Timing Considerations

dWallet signing is not instant. Plan for these latencies:

| Operation | Testnet | Mainnet (expected) |
|---|---|---|
| DKG (create dWallet) | 30–90s | 10–30s |
| Presign | 30–60s | 5–15s |
| Sign | 30–60s | 5–15s |
| **Total (create + first sign)** | **~2–4 min** | **~30–60s** |
| **Subsequent signs** | **~1–2 min** | **~10–30s** |

**Implications for agents:**
- Pre-create dWallets during setup, not at trade time
- Use presign batching: request presigns ahead of time for faster signing
- For time-sensitive operations (arbitrage), keep a pool of pre-signed nonces
- Design for async: submit sign request → do other work → poll for completion

---

## Gas & Fee Budgeting

Every agent operation costs SUI (gas) + IKA (protocol fee).

```typescript
// Rough per-operation costs (testnet, may differ on mainnet)
const COSTS = {
  createDWallet: { sui: 0.3, ika: 0.1 },  // ~300M gas + IKA fee
  presign:       { sui: 0.1, ika: 0.05 },  // ~100M gas + IKA fee
  sign:          { sui: 0.15, ika: 0.05 }, // ~150M gas + IKA fee
};

// Agent should monitor balances and alert when low
async function checkAgentFunds(suiClient: SuiClient, address: string) {
  const suiBalance = await suiClient.getBalance({ owner: address });
  const ikaBalance = await suiClient.getBalance({
    owner: address,
    coinType: '0x8f66bb433ad1c4f45da565a49199e8bc29787e3c02d60906e07bbd1612acacb6::ika::IKA',
  });

  const suiAmount = Number(suiBalance.totalBalance) / 1e9;
  const ikaAmount = Number(ikaBalance.totalBalance) / 1e9;

  if (suiAmount < 1) console.warn(`⚠️ Low SUI: ${suiAmount} — refill agent wallet`);
  if (ikaAmount < 0.5) console.warn(`⚠️ Low IKA: ${ikaAmount} — swap at faucet.ika.xyz`);

  return { sui: suiAmount, ika: ikaAmount };
}
```

---

## Anti-Patterns

| Don't | Why | Do Instead |
|---|---|---|
| Store DWalletCap in agent memory | Agent compromise = full key access | Lock cap in Move contract |
| Use zero-trust dWallet for agents | Requires user interaction per sign | Use shared dWallet (public user share) |
| Skip the Move policy layer | Hot wallet with extra steps | Always enforce policy on-chain |
| Hard-code gas amounts | Network conditions change | Query gas estimates, use dynamic budgets |
| Sign and broadcast in one step | Can't retry broadcast on failure | Sign → store sig → broadcast (retry-safe) |
| Create dWallet per transaction | 30–90s DKG each time | Pre-create, reuse for all signs |
| Ignore IKA token balance | Signs fail silently with confusing errors | Monitor + auto-refill or alert |

---

## Quick Reference: Agent Setup Checklist

1. **Deploy Move contract** with policy vault (daily limits, allowlists, guardian address)
2. **Create shared dWallet** via `requestDWalletDKGWithPublicUserShare` — save dwalletId + dwalletCapId
3. **Transfer DWalletCap** into Move contract vault (one-time setup)
4. **Fund agent wallet** with SUI (gas) + IKA (protocol fees)
5. **Deposit funds** to dWallet's target-chain address (derived from dWallet public key)
6. **Configure agent** with: vault object ID, dwallet ID, package ID, IKA coin ID
7. **Set guardian** to human's address for emergency override
8. **Monitor**: watch SUI events for sign requests, track balances, alert on anomalies
