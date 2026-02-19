---
name: ika-network
description: >
  Build with Ika Network's dWallet primitive for programmable multi-chain signing.
  Use when: creating dWallets, signing transactions on any blockchain (BTC, ETH, SOL)
  from Sui smart contracts, integrating dWallets into Move contracts, understanding
  2PC-MPC cryptography, debugging Ika SDK errors, building cross-chain applications,
  chain abstraction, programmable custody, multi-chain treasury, or any task involving
  the @ika.xyz/sdk TypeScript package or Ika Move modules. Also use for questions about
  dWallet Network (Ika's former name), zero-trust signing, non-collusive MPC, or
  comparing Ika to bridges/MPC networks like Lit Protocol, Wormhole, LayerZero, Axelar.
  Also covers agentic patterns: AI agents with policy-controlled dWallets, MCP tool servers
  for cross-chain signing, autonomous trading bots, and multi-chain treasury management.
---

# Ika Network Developer Skill

## What Ika Is

Ika is a parallel MPC signing network built on Sui. It creates **dWallets**: programmable,
transferable signing keys that work on any blockchain. A dWallet is controlled by a Sui smart
contract (via `DWalletCap`) and requires BOTH the user AND the Ika validator network to produce
a signature. Neither can sign alone (non-collusive 2PC-MPC). This means Sui contracts can
natively control Bitcoin, Ethereum, Solana assets without bridges or wrapping.

## Quick Start

```typescript
import { IkaClient, getNetworkConfig } from '@ika.xyz/sdk';
import { SuiClient } from '@mysten/sui/client';

// IMPORTANT: Use publicnode RPC, NOT the default Sui RPC (rate-limited)
const suiClient = new SuiClient({ url: 'https://sui-testnet-rpc.publicnode.com' });
const ikaClient = new IkaClient({
  suiClient,
  config: getNetworkConfig('testnet'),
  network: 'testnet',
  cache: true,
});
await ikaClient.initialize();
```

## Prerequisites

- Rust (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Sui CLI (`brew install sui`)
- pnpm (`npm install -g pnpm`)
- wasm-pack (`curl https://drager.github.io/wasm-pack/installer/init.sh -sSf | sh`)
- wasm-bindgen-cli (`cargo install wasm-bindgen-cli --version 0.2.100`)

Install SDK: `pnpm add @ika.xyz/sdk`

## Tips & Practical Notes

1. **Use `https://sui-testnet-rpc.publicnode.com`** for testnet, NOT `getFullnodeUrl('testnet')`. The default Sui RPC rate-limits the SDK's multi-call patterns.
2. **IKA tokens required**: Get them at `https://faucet.ika.xyz/` by swapping SUI for IKA.
3. **Create encryption keys**: `UserShareEncryptionKeys.fromRootSeedKey(randomBytes(32), Curve.SECP256K1)` — the factory method for generating key pairs.
4. **Deprecated API warning**: Do NOT use `requestDWalletDKGFirstRound`, `requestDWalletDKGFirstRoundAsync`, or `requestDWalletDKGSecondRound`. Use `requestDWalletDKG` (v2 API).
5. **Mainnet RPC**: `https://ikafn-on-sui-2-mainnet.ika-network.net/`

## Navigation

| I want to... | Read |
|---|---|
| Understand dWallets, 2PC-MPC, zero-trust | [concepts.md](references/concepts.md) |
| See SDK API (types, functions, signatures) | [sdk-api.md](references/sdk-api.md) |
| Walk through DKG → sign end-to-end | [workflows.md](references/workflows.md) |
| Write Move contracts using dWallets | [move-integration.md](references/move-integration.md) |
| Debug an error | [error-catalogue.md](references/error-catalogue.md) |
| Deploy to production | [production-patterns.md](references/production-patterns.md) |
| See network endpoints, package IDs, config | [network-config.md](references/network-config.md) |
| Explore use cases + code stubs | [use-cases.md](references/use-cases.md) |
| Build AI agent with dWallet signing | [agentic-patterns.md](references/agentic-patterns.md) |
| Understand security model + trust assumptions | [security-model.md](references/security-model.md) |

## Status Notes

- **EdDSA**: Added Dec 2025, available for Solana/Cardano/Near/Stellar signing
- **Operators docs**: Coming soon on official docs
- **Code Examples section**: Coming soon on official docs
- **Move integration**: See [move-integration.md](references/move-integration.md) for extended examples beyond the official guides

## Key Concepts (30-second version)

- **dWallet** = Sui object that can sign on any chain. Created via DKG (Distributed Key Generation).
- **DWalletCap** = The capability object that controls a dWallet. Whoever holds it controls signing policy. Losing it = frozen wallet.
- **2PC-MPC** = Two-Party Computation with Multi-Party Computation. User + network = signature. Neither alone can sign. Non-collusive by construction.
- **Zero-Trust** = Even if 100% of validators are compromised, they cannot sign without the user's participation.
- **Presigning** = Pre-compute partial signatures for faster signing later.

## GitHub & Resources

- **Repo**: https://github.com/dwallet-labs/ika
- **SDK**: `@ika.xyz/sdk` on npm
- **Docs**: https://docs.ika.xyz/docs/sdk
- **Faucet**: https://faucet.ika.xyz/
- **Paper**: IACR ePrint 2024/253
- **Twitter**: @ikadotxyz
