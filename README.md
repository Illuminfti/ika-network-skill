# 🦑 Ika Network Developer Skill

> **The documentation Ika deserves.** Complete SDK reference, verified code templates, and production patterns for building with dWallets — because the official docs are 90% broken links.

[![SDK Version](https://img.shields.io/badge/@ika.xyz/sdk-v0.2.7-blue)](https://www.npmjs.com/package/@ika.xyz/sdk)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Verified](https://img.shields.io/badge/API-ground--truth--verified-brightgreen)](#verification)

---

## What is this?

Ika Network lets Sui smart contracts sign transactions on **any blockchain** (Bitcoin, Ethereum, Solana, Cosmos, etc.) using **dWallets** — programmable MPC signing keys. No bridges. No wrapping. No trust assumptions beyond cryptography.

This repo is:

1. **Complete documentation** — every SDK function, type, and enum verified against the actual installed package
2. **Working project template** — `tsc --noEmit` clean, copy and build
3. **Production patterns** — security, error handling, gas budgeting, agentic architectures
4. **AI agent skill** — drop into [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenClaw](https://openclaw.ai), or any skill-aware agent

**Why does this exist?** The official Ika docs at `docs.ika.xyz` are a Next.js site where ~90% of pages return 404 or empty content. The SDK itself is solid (8/10), but without docs you're reading source code. This fills the gap.

---

## Quick Start (5 minutes)

### 1. Check prerequisites

```bash
./scripts/setup.sh
```

### 2. Copy the project template

```bash
cp -r assets/project-template my-ika-project
cd my-ika-project
pnpm install
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env:
#   PRIVATE_KEY=suiprivkey1...     (from: sui keytool generate ed25519)
#   IKA_COIN_OBJECT_ID=0x...      (from: faucet.ika.xyz → swap SUI for IKA)
```

### 4. Get testnet tokens

| Token | Where | How |
|-------|-------|-----|
| **SUI** | [faucet.testnet.sui.io](https://faucet.testnet.sui.io/) | Click button or `sui client faucet` |
| **IKA** | [faucet.ika.xyz](https://faucet.ika.xyz/) | Connect wallet → swap SUI → IKA |

### 5. Run

```bash
pnpm dev
```

This creates a dWallet (30-90s), signs a test message (60-120s), and prints the signature. You now have a working cross-chain signing key.

---

## ⚠️ Critical Knowledge (Not in Official Docs)

These will save you hours of debugging:

| # | Gotcha | Fix |
|---|--------|-----|
| 1 | Default Sui RPC (`getFullnodeUrl('testnet')`) returns **429** immediately under SDK load | Use `https://sui-testnet-rpc.publicnode.com` |
| 2 | `IkaNetworkConfig` is **not exported** | Use `ReturnType<typeof getNetworkConfig>` |
| 3 | `UserShareEncryptionKeys.create()` **doesn't exist** | Use `UserShareEncryptionKeys.fromRootSeedKey(seed, curve)` |
| 4 | `.toBytes()` **doesn't exist** on encryption keys | Use `.toShareEncryptionKeysBytes()` |
| 5 | `requestDWalletDKGFirstRound` / `SecondRound` are **deprecated and throw** | Use `prepareDKGAsync` + `requestDWalletDKG` |
| 6 | IKA tokens are **required** for every protocol operation | Get from [faucet.ika.xyz](https://faucet.ika.xyz/) (wallet UI only, no API) |
| 7 | Mainnet RPC is **not** `getFullnodeUrl('mainnet')` | Use `https://ikafn-on-sui-2-mainnet.ika-network.net/` |

---

## Documentation Map

| I need to... | Read | Lines |
|---|---|---:|
| Understand dWallets, 2PC-MPC, zero-trust | [references/concepts.md](references/concepts.md) | 371 |
| See all SDK exports, types, enums | [references/sdk-api.md](references/sdk-api.md) | 497 |
| Walk through DKG → sign step by step | [references/workflows.md](references/workflows.md) | 673 |
| Write Move contracts using dWallets | [references/move-integration.md](references/move-integration.md) | 1,030 |
| Debug an error message | [references/error-catalogue.md](references/error-catalogue.md) | 451 |
| Build an AI agent with dWallet signing | [references/agentic-patterns.md](references/agentic-patterns.md) | 726 |
| Deploy to production | [references/production-patterns.md](references/production-patterns.md) | 522 |
| Get network endpoints & package IDs | [references/network-config.md](references/network-config.md) | 474 |
| Explore use cases with code stubs | [references/use-cases.md](references/use-cases.md) | 549 |
| Understand security & trust model | [references/security-model.md](references/security-model.md) | 319 |

**Total: ~5,700 lines of verified documentation.**

---

## For AI Agents

### As a Claude Code / OpenClaw Skill

Drop the entire repo into your agent's skills directory:

```bash
# Claude Code
cp -r . ~/.claude/skills/ika-network/

# OpenClaw
cp -r . /path/to/openclaw/.agents/skills/ika-network/
```

The `SKILL.md` follows the standard skill format. Any skill-aware agent will automatically load it when it encounters Ika-related tasks.

### As Context for Any LLM

Feed the files your agent needs:

```python
# For SDK questions → sdk-api.md + workflows.md
# For Move contracts → move-integration.md
# For agent architecture → agentic-patterns.md
# For debugging → error-catalogue.md + network-config.md
```

### Agentic Patterns (NEW)

[`references/agentic-patterns.md`](references/agentic-patterns.md) covers:

- **Autonomous Trading Agent** — Move policy vault + TypeScript agent (full code)
- **MCP Tool Server** — Expose dWallet signing as MCP tools for any LLM
- **Multi-Chain Treasury** — BTC/ETH/SOL caps with guardian kill switch
- **Subscription Payments** — Recurring auto-pay within caps
- **Cross-Chain Arbitrage** — Parallel signing with timing considerations
- **Security model** — threat table, key insight (Move contract is the security boundary, not the agent's keypair)
- **Anti-patterns** — 7 things not to do

---

## Project Template

The [`assets/project-template/`](assets/project-template/) is a complete, compilable TypeScript project:

```
assets/project-template/
├── src/
│   ├── config.ts      # Network config, RPC URLs, type-safe setup
│   ├── dwallet.ts     # DWalletClient class: create + sign (388 lines, extensively commented)
│   └── index.ts       # CLI entry point: create dWallet → sign message → print signature
├── .env.example
├── package.json       # @ika.xyz/sdk@0.2.7, @mysten/sui@^1.44.0
└── tsconfig.json
```

Every import is verified. `tsc --noEmit` passes. The `dwallet.ts` contains 20+ inline comments explaining API corrections vs what you'd find in broken docs.

### Move Template

[`assets/move-template/`](assets/move-template/) is a starter Move contract for dWallet treasury management with correct Ika dependency configuration and testnet package addresses.

---

## Verification

<a name="verification"></a>

Every TypeScript type and function signature in this repo was verified by:

1. **Installing `@ika.xyz/sdk@0.2.7`** in a real project
2. **Introspecting exports** via `node -e "console.log(Object.keys(require('@ika.xyz/sdk')))"` 
3. **Running `tsc --noEmit`** on the project template (zero errors)
4. **Runtime-checking** all 9 SDK imports resolve: `IkaClient`, `IkaTransaction`, `UserShareEncryptionKeys`, `Curve`, `SignatureAlgorithm`, `Hash`, `getNetworkConfig`, `prepareDKGAsync`, `createRandomSessionIdentifier`
5. **Cross-referencing** with actual testnet DKG execution (dWallet `0x36ada...`, Ed25519 pubkey `46453f...`)

The ground truth API extraction is documented in the research that produced this skill.

---

## Network Quick Reference

| | Testnet | Mainnet |
|---|---|---|
| **Sui RPC** | `https://sui-testnet-rpc.publicnode.com` | `https://ikafn-on-sui-2-mainnet.ika-network.net/` |
| **IKA Faucet** | [faucet.ika.xyz](https://faucet.ika.xyz/) | N/A |
| **SUI Faucet** | [faucet.testnet.sui.io](https://faucet.testnet.sui.io/) | N/A |
| **Explorer** | [suiscan.xyz/testnet](https://suiscan.xyz/testnet) | [suiscan.xyz/mainnet](https://suiscan.xyz/mainnet) |
| **SDK** | `@ika.xyz/sdk@0.2.7` | Same package, pass `'mainnet'` to `getNetworkConfig()` |

---

## Supported Curves & Algorithms

| Curve | Enum | Chains |
|---|---|---|
| `Curve.SECP256K1` | 0 | Bitcoin, Ethereum, BNB, Arbitrum, Base, Avalanche |
| `Curve.ED25519` | 2 | Solana, Cardano, Near, Stellar, Aptos |
| `Curve.SECP256R1` | 3 | WebAuthn, Apple Secure Enclave, some L2s |
| `Curve.RISTRETTO` | 1 | Privacy protocols (Monero-adjacent) |

| Signature Algorithm | Use |
|---|---|
| `SignatureAlgorithm.ECDSASecp256k1` | Bitcoin, Ethereum, EVM chains |
| `SignatureAlgorithm.Schnorr` | Bitcoin Taproot |
| `SignatureAlgorithm.EdDSA` | Solana, Cardano, Near |
| `SignatureAlgorithm.ECDSASecp256r1` | WebAuthn |

---

## Contributing

Found an error? SDK updated? Please open an issue or PR. The whole point of this repo is accurate, verified documentation.

When contributing code examples:
1. Run `tsc --noEmit` on any TypeScript
2. Verify imports exist in `@ika.xyz/sdk@0.2.7`
3. Note the SDK version you tested against

---

## Links

| Resource | URL |
|---|---|
| Ika GitHub | [github.com/dwallet-labs/ika](https://github.com/dwallet-labs/ika) |
| SDK on npm | [@ika.xyz/sdk](https://www.npmjs.com/package/@ika.xyz/sdk) |
| Official Docs (partial) | [docs.ika.xyz](https://docs.ika.xyz/docs/sdk) |
| Cryptography Paper | [IACR ePrint 2024/253](https://eprint.iacr.org/2024/253) |
| Twitter | [@ikadotxyz](https://twitter.com/ikadotxyz) |

---

<p align="center">
  Built with 🦑 by <a href="https://github.com/Illuminfti">Illuminfti</a> + Ika Minami
</p>
