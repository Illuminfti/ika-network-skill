# Ika Network — Configuration Reference

> SDK: `@ika.xyz/sdk` v0.2.7 | Verified: 2026-02-18  
> Sources: ground-truth-api.md (live SDK introspection), github-deep-dive.md (network-configs.ts source)  
> ⚠️ Testnet addresses marked ✅ = verified from installed SDK. Mainnet from source only.

---

## RPC Endpoints

| Network | URL | Notes |
|---------|-----|-------|
| Testnet | `https://sui-testnet-rpc.publicnode.com` | **USE THIS** — handles SDK burst patterns |
| Testnet (avoid) | `https://fullnode.testnet.sui.io` | Hits 429 within seconds on multi-call ops |
| Mainnet | `https://ikafn-on-sui-2-mainnet.ika-network.net/` | Ika's own RPC node |
| Mainnet (fallback) | `https://fullnode.mainnet.sui.io` | Lower rate limits |

### Standard Client Setup

```typescript
import { getNetworkConfig, IkaClient } from '@ika.xyz/sdk';
import { SuiClient } from '@mysten/sui/client';

// ✅ Testnet (always use publicnode, not getFullnodeUrl)
const suiClient = new SuiClient({ url: 'https://sui-testnet-rpc.publicnode.com' });
const ikaClient = new IkaClient({
  suiClient,
  config: getNetworkConfig('testnet'),
  cache: true,               // ← reduces repeated RPC calls significantly
});
await ikaClient.initialize();
const epoch = await ikaClient.getEpoch(); // verify connection

// ✅ Mainnet
const suiClient = new SuiClient({ url: 'https://ikafn-on-sui-2-mainnet.ika-network.net/' });
const ikaClient = new IkaClient({ suiClient, config: getNetworkConfig('mainnet'), cache: true });
```

---

## Testnet Package IDs ✅ VERIFIED (from installed SDK v0.2.7)

> Source: `ground-truth-api.md` — extracted from `getNetworkConfig('testnet')` on live SDK

```typescript
const testnetConfig = getNetworkConfig('testnet');
// testnetConfig.packages:

ikaPackage:                      '0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a'
ikaCommonPackage:                '0x96fc75633b6665cf84690587d1879858ff76f88c10c945e299f90bf4e0985eb0'
ikaSystemOriginalPackage:        '0xae71e386fd4cff3a080001c4b74a9e485cd6a209fa98fb272ab922be68869148'
ikaSystemPackage:                '0xde05f49e5f1ee13ed06c1e243c0a8e8fe858e1d8689476fdb7009af8ddc3c38b'
ikaDwallet2pcMpcOriginalPackage: '0xf02f5960c94fce1899a3795b5d11fd076bc70a8d0e20a2b19923d990ed490730'
ikaDwallet2pcMpcPackage:         '0x6573a6c13daf26a64eb8a37d3c7a4391b353031e223072ca45b1ff9366f59293'  ← current (post-upgrade)
```

**Which to use where:**
- `ikaDwallet2pcMpcPackage` — use for all SDK calls, TypeScript Move call targets
- `ikaDwallet2pcMpcOriginalPackage` — use in Move.toml `[addresses]` section
- `ikaSystemPackage` — current (post-upgrade); use for system calls
- `ikaPackage` — IKA token package; used to construct `Coin<IKA>` type

### Testnet Object IDs ✅ VERIFIED

```typescript
// testnetConfig.objects:

ikaSystemObject: {
  objectID:            '0x2172c6483ccd24930834e30102e33548b201d0607fb1fdc336ba3267d910dec6',
  initialSharedVersion: 508060325,
}

ikaDWalletCoordinator: {
  objectID:            '0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc',
  initialSharedVersion: 510819272,
}
```

### IKA Coin Type (Testnet) ✅

```typescript
// Full Move type string for Coin<IKA> on testnet:
const IKA_COIN_TYPE_TESTNET =
  '0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a::ika::IKA';

// Programmatic (from initialized client):
const ikaType = `${ikaClient.ikaConfig.packages.ikaPackage}::ika::IKA`;
```

---

## Mainnet Package IDs (from network-configs.ts source)

```typescript
const mainnetConfig = getNetworkConfig('mainnet');
// mainnetConfig.packages:

ikaPackage:                      '0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa'
ikaCommonPackage:                '0x9e1e9f8e4e51ee2421a8e7c0c6ab3ef27c337025d15333461b72b1b813c44175'
ikaSystemOriginalPackage:        '0xb874c9b51b63e05425b74a22891c35b8da447900e577667b52e85a16d4d85486'
ikaSystemPackage:                '0xd69f947d7ee6f224dd0dd31ec3ec30c0dd0f713a1de55d564e8e98910c4f9553'
ikaDwallet2pcMpcOriginalPackage: '0xdd24c62739923fbf582f49ef190b4a007f981ca6eb209ca94f3a8eaf7c611317'
ikaDwallet2pcMpcPackage:         '0x23b5bd96051923f800c3a2150aacdcdd8d39e1df2dce4dac69a00d2d8c7f7e77'
```

### Mainnet Object IDs

```typescript
// mainnetConfig.objects:

ikaSystemObject: {
  objectID:            '0x215de95d27454d102d6f82ff9c54d8071eb34d5706be85b5c73cbd8173013c80',
  initialSharedVersion: 595745916,
}

ikaDWalletCoordinator: {
  objectID:            '0x5ea59bce034008a006425df777da925633ef384ce25761657ea89e2a08ec75f3',
  initialSharedVersion: 595876492,
}
```

### IKA Coin Type (Mainnet)

```typescript
const IKA_COIN_TYPE_MAINNET =
  '0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA';
```

---

## Coordinator — Move Shared Object Reference

The coordinator must be passed as a shared object reference with `mutable: true` for write ops:

```typescript
import { Transaction } from '@mysten/sui/transactions';

const config = getNetworkConfig('testnet');

// Direct reference (SDK handles this internally via ikaTx):
const coordinatorRef = tx.sharedObjectRef({
  objectId:            config.objects.ikaDWalletCoordinator.objectID,
  initialSharedVersion: config.objects.ikaDWalletCoordinator.initialSharedVersion,
  mutable: true,
});

// Read-only reference (for queries):
const coordinatorReadRef = tx.sharedObjectRef({
  objectId:            config.objects.ikaDWalletCoordinator.objectID,
  initialSharedVersion: config.objects.ikaDWalletCoordinator.initialSharedVersion,
  mutable: false,
});
```

**Explorer links — Testnet Coordinator:**
```
https://suiscan.xyz/testnet/object/0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc
```

---

## Move.toml Dependency Format

### Testnet (git dependencies from source + published addresses)

```toml
[package]
name = "my_dwallet_app"
edition = "2024.beta"

[dependencies]
Sui = {
  git = "https://github.com/MystenLabs/sui.git",
  subdir = "crates/sui-framework/packages/sui-framework",
  rev = "framework/testnet"
}
ika_dwallet_2pc_mpc = {
  git = "https://github.com/dwallet-labs/ika.git",
  subdir = "contracts/ika_dwallet_2pc_mpc",
  rev = "main"
}
ika_common = {
  git = "https://github.com/dwallet-labs/ika.git",
  subdir = "contracts/ika_common",
  rev = "main"
}
ika = {
  git = "https://github.com/dwallet-labs/ika.git",
  subdir = "contracts/ika",
  rev = "main"
}

[addresses]
my_dwallet_app = "0x0"
# Use the CURRENT (post-upgrade) package address for the module address:
ika_dwallet_2pc_mpc = "0x6573a6c13daf26a64eb8a37d3c7a4391b353031e223072ca45b1ff9366f59293"
ika_common = "0x96fc75633b6665cf84690587d1879858ff76f88c10c945e299f90bf4e0985eb0"
ika = "0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a"
```

### Minimal Move Imports

```move
module my_protocol::my_module;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::{
    coordinator::DWalletCoordinator,
    coordinator_inner::{
        DWalletCap,
        ImportedKeyDWalletCap,
        UnverifiedPresignCap,
        VerifiedPresignCap,
        MessageApproval,
        ImportedKeyMessageApproval,
        UnverifiedPartialUserSignatureCap,
        VerifiedPartialUserSignatureCap,
    },
    sessions_manager::SessionIdentifier,
};
use sui::{balance::Balance, coin::Coin, sui::SUI};
```

---

## Cryptographic Constants

### Curve IDs (u32 in Move, enum in TypeScript)

| Curve | Move ID | TypeScript | Use Case |
|-------|---------|-----------|----------|
| SECP256K1 | `0` | `Curve.SECP256K1` | Ethereum, Bitcoin |
| SECP256R1 | `1` | `Curve.SECP256R1` | WebAuthn, Passkeys |
| ED25519 | `2` | `Curve.ED25519` | Solana, Cosmos |
| RISTRETTO | `3` | `Curve.RISTRETTO` | Polkadot/Substrate |

### Signature Algorithm IDs (relative to curve)

| Curve | Algorithm | Move ID | TypeScript |
|-------|-----------|---------|-----------|
| SECP256K1 | ECDSASecp256k1 | `0` | `SignatureAlgorithm.ECDSASecp256k1` |
| SECP256K1 | Taproot | `1` | `SignatureAlgorithm.Taproot` |
| SECP256R1 | ECDSASecp256r1 | `0` | `SignatureAlgorithm.ECDSASecp256r1` |
| ED25519 | EdDSA | `0` | `SignatureAlgorithm.EdDSA` |
| RISTRETTO | SchnorrkelSubstrate | `0` | `SignatureAlgorithm.SchnorrkelSubstrate` |

### Hash Scheme IDs (relative to curve + algorithm)

| Curve | Algorithm | Hash | Move ID | TypeScript |
|-------|-----------|------|---------|-----------|
| SECP256K1 | ECDSASecp256k1 | KECCAK256 (Ethereum) | `0` | `Hash.KECCAK256` |
| SECP256K1 | ECDSASecp256k1 | SHA256 | `1` | `Hash.SHA256` |
| SECP256K1 | ECDSASecp256k1 | DoubleSHA256 (Bitcoin) | `2` | `Hash.DoubleSHA256` |
| SECP256K1 | Taproot | SHA256 | `0` | `Hash.SHA256` |
| SECP256R1 | ECDSASecp256r1 | SHA256 | `0` | `Hash.SHA256` |
| SECP256R1 | ECDSASecp256r1 | DoubleSHA256 | `1` | `Hash.DoubleSHA256` |
| ED25519 | EdDSA | SHA512 | `0` | `Hash.SHA512` |
| RISTRETTO | SchnorrkelSubstrate | Merlin | `0` | `Hash.Merlin` |

**Bitcoin Taproot:** `curve=0, algorithm=1, hash=0`  
**Ethereum:** `curve=0, algorithm=0, hash=0`  
**Solana:** `curve=2, algorithm=0, hash=0`

---

## Token Acquisition

### Faucet URLs

| Resource | URL | Notes |
|----------|-----|-------|
| SUI Testnet | `https://faucet.testnet.sui.io/` | Rate-limited by IP (1/day) |
| SUI via Discord | `discord.gg/sui` → `#testnet-faucet` | Higher limits |
| IKA Testnet | `https://faucet.ika.xyz/` | Swap SUI→IKA, requires wallet UI |

### Getting IKA Testnet Tokens (Step by Step)

```
1. Get SUI: POST https://faucet.testnet.sui.io/v2/gas with { FixedAmountRequest: { recipient: "<address>" } }
2. Visit https://faucet.ika.xyz/ (wallet connection required — no API)
3. Connect Sui wallet → swap SUI → IKA
4. Note the IKA coin object ID from your wallet

Note: faucet.ika.xyz has no programmatic API. Wallet UI only.
```

### Programmatic SUI Request

```typescript
const res = await fetch('https://faucet.testnet.sui.io/v2/gas', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
});
// Rate limit: ~1 request/day/IP. Use Discord faucet if blocked.
```

### Testnet: Zero-Value IKA Coin (avoids faucet entirely)

```typescript
// Most testnet protocol ops accept an empty IKA coin
const config = ikaClient.ikaConfig;
const ikaType = `${config.packages.ikaPackage}::ika::IKA`;

const ikaCoin = tx.moveCall({
  target: '0x2::coin::zero',
  typeArguments: [ikaType],
  arguments: [],
});
// Pass ikaCoin to requestDWalletDKG, requestPresign, etc.
// After the op, destroy it:
tx.moveCall({
  target: '0x2::coin::destroy_zero',
  typeArguments: [ikaType],
  arguments: [ikaCoin],
});
```

---

## Localnet Setup

From `https://docs.ika.xyz/docs/sdk/setup-localnet`:

### Prerequisites

```bash
# 1. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. Sui CLI (macOS/Linux)
brew install sui
```

### Start Sui Localnet

```bash
# Terminal 1 — start Sui localnet with faucet
RUST_LOG="off,sui_node=info" sui start \
  --with-faucet \
  --force-regenesis \
  --epoch-duration-ms 1000000000000000
```

**Parameters:**
- `--with-faucet` — enables test token faucet
- `--force-regenesis` — new genesis every time (clean state)
- `--epoch-duration-ms 1000000000000000` — very long epoch for testing

### Start Ika Localnet

```bash
# Terminal 2 — clone and start Ika node
git clone https://github.com/dwallet-labs/ika.git
cd ika
cargo run --bin ika --release --no-default-features -- start
```

**Parameters:**
- `--bin ika` — main Ika node binary
- `--release` — optimized build
- `--no-default-features` — removes 16-core minimum requirement for localnet

### Localnet Client Config

Localnet uses a config file instead of `getNetworkConfig()`:

```typescript
// For localnet, IkaClient reads from ika_config.json generated by the node:
import { IkaClient } from '@ika.xyz/sdk';
import { readFileSync } from 'fs';

const ikaConfig = JSON.parse(readFileSync('./ika_config.json', 'utf8'));
const ikaClient = new IkaClient({
  suiClient: new SuiClient({ url: 'http://127.0.0.1:9000' }),
  config: ikaConfig,
});
```

---

## SDK Version Compatibility

| SDK | WASM | Sui SDK | Node.js | Notes |
|-----|------|---------|---------|-------|
| **0.2.7** | 0.2.1 | ^1.44.0 | ≥18 | **Current — use this** |
| 0.2.6 | 0.2.1 | ^1.44.0 | ≥18 | Minor bug fixes |
| 0.1.x | 0.1.x | older | ≥16 | Two-round DKG — **DO NOT USE** |

### Install

```bash
npm install @ika.xyz/sdk       # npm
pnpm add @ika.xyz/sdk          # pnpm (monorepo recommended)
bun add @ika.xyz/sdk           # bun
```

### Deprecated / Archived (do not install)

```
@dwallet-network/dwallet.js           ← ARCHIVED Sep 2025
@dwallet-network/signature-mpc-wasm   ← ARCHIVED
```

---

## WASM Build Prerequisites (only if building from source)

```bash
rustup target add wasm32-unknown-unknown
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
cargo install wasm-bindgen-cli --version 0.2.100  # ← EXACT version, no substitutes
```

Skip all of this — use the pre-built package from npm:
```bash
npm install @ika.xyz/ika-wasm  # includes pre-built WASM, no Rust needed
```

---

## Block Explorers

| Network | URL |
|---------|-----|
| Testnet (suiscan) | `https://suiscan.xyz/testnet` |
| Testnet (suivision) | `https://suivision.xyz/testnet` |
| Mainnet | `https://suiscan.xyz/mainnet` |

```
# Testnet quick links:
Coordinator: https://suiscan.xyz/testnet/object/0x4d157b7415a298c56ec2cb1dcab449525fa74aec17ddba376a83a7600f2062fc
Tx:          https://suiscan.xyz/testnet/tx/<DIGEST>
Object:      https://suiscan.xyz/testnet/object/<OBJECT_ID>
```

---

## Environment Variables

```bash
# Testnet connection
SUI_TESTNET_URL=https://sui-testnet-rpc.publicnode.com
SUI_FAUCET_URL=https://faucet.testnet.sui.io/v2/gas

# Localnet only
IKA_CONFIG_PATH=/path/to/ika_config.json

# Backend / keyspring pattern
SUI_ADMIN_SECRET_KEY=<base64-encoded-private-key>
IKA_COIN_ID=<ika-coin-object-id>
```

---

## Links and Resources

| Resource | URL |
|----------|-----|
| Website | https://ika.xyz |
| GitHub | https://github.com/dwallet-labs/ika |
| npm | https://www.npmjs.com/package/@ika.xyz/sdk |
| Docs (only working page) | https://docs.ika.xyz/docs/sdk |
| IKA Faucet | https://faucet.ika.xyz/ |
| Security Audits | https://github.com/dwallet-labs/security-audits |
| Dev Email | dev@dwalletlabs.com |

> ⚠️ As of 2026-02-18: all docs.ika.xyz pages except `/docs/sdk` return 404.  
> Use this skill + GitHub source as primary reference.

---

*Sources: ground-truth-api.md (live SDK v0.2.7 introspection ✅), github-deep-dive.md (network-configs.ts),*  
*move-and-concepts-pages.md (sdk-pages localnet), DevEx audit (06-devex-report.md)*
