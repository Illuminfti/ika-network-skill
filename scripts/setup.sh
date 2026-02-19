#!/usr/bin/env bash
# setup.sh — Check and install Ika Network development prerequisites
#
# Dependencies checked:
#   rustup         — Rust toolchain manager (required for wasm-pack + wasm-bindgen-cli)
#   sui            — Sui CLI (for Move contract development + testnet interaction)
#   pnpm           — Package manager (preferred for @ika.xyz/sdk)
#   wasm-pack      — WASM build tool (only if building from source; skip if using npm)
#   wasm-bindgen-cli v0.2.100 — EXACT version required by @ika.xyz/ika-wasm
#
# This script is READ-ONLY for your system — it checks first, then prints
# install commands. It does NOT install anything automatically.
#
# Usage:
#   chmod +x setup.sh && ./setup.sh
#
# To auto-install missing tools (unsupported), run the printed commands manually.
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

check() { printf "  ${GREEN}✓${RESET} %s\n" "$*"; }
warn()  { printf "  ${YELLOW}⚠${RESET}  %s\n" "$*"; }
fail()  { printf "  ${RED}✗${RESET} %s\n" "$*"; }
info()  { printf "  ${BOLD}→${RESET} %s\n" "$*"; }

MISSING=0

echo ""
echo "${BOLD}Ika Network — Development Prerequisites Check${RESET}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Rust / rustup ────────────────────────────────────────────────────────────
echo "${BOLD}[1/5] Rust + rustup${RESET}"
if command -v rustup &>/dev/null; then
    RUST_VER=$(rustc --version 2>/dev/null || echo "unknown")
    check "rustup found. $RUST_VER"
    # Check WASM target is available (needed if building from source)
    if rustup target list --installed 2>/dev/null | grep -q "wasm32-unknown-unknown"; then
        check "wasm32-unknown-unknown target installed"
    else
        warn "wasm32-unknown-unknown target not installed (only needed if building @ika.xyz/ika-wasm from source)"
        info "Install: rustup target add wasm32-unknown-unknown"
    fi
else
    fail "rustup not found"
    MISSING=$((MISSING+1))
    info "Install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    info "         source \$HOME/.cargo/env"
fi

echo ""

# ── Sui CLI ──────────────────────────────────────────────────────────────────
echo "${BOLD}[2/5] Sui CLI${RESET}"
if command -v sui &>/dev/null; then
    SUI_VER=$(sui --version 2>/dev/null || echo "unknown")
    check "sui CLI found. $SUI_VER"

    # Warn if not connected to testnet
    ACTIVE_ENV=$(sui client active-env 2>/dev/null || echo "unknown")
    if [[ "$ACTIVE_ENV" == *"testnet"* ]]; then
        check "Active environment: testnet ✓"
    else
        warn "Active Sui environment: '$ACTIVE_ENV' (not testnet)"
        info "Switch: sui client switch --env testnet"
        info "Add testnet: sui client new-env --alias testnet --rpc https://sui-testnet-rpc.publicnode.com"
    fi
else
    fail "sui CLI not found"
    MISSING=$((MISSING+1))
    echo ""
    info "Install options:"
    info "  macOS/Linux: brew install sui"
    info "  Or from source: https://docs.sui.io/guides/developer/getting-started/sui-install"
fi

echo ""

# ── pnpm ─────────────────────────────────────────────────────────────────────
echo "${BOLD}[3/5] pnpm${RESET}"
if command -v pnpm &>/dev/null; then
    PNPM_VER=$(pnpm --version 2>/dev/null || echo "unknown")
    check "pnpm found. v$PNPM_VER"
elif command -v npm &>/dev/null; then
    NPM_VER=$(npm --version 2>/dev/null || echo "unknown")
    warn "pnpm not found, but npm v$NPM_VER is available (npm works too)"
    info "Install pnpm: npm install -g pnpm"
else
    fail "Neither pnpm nor npm found"
    MISSING=$((MISSING+1))
    info "Install pnpm: https://pnpm.io/installation"
    info "  curl -fsSL https://get.pnpm.io/install.sh | sh -"
fi

echo ""

# ── wasm-pack ────────────────────────────────────────────────────────────────
echo "${BOLD}[4/5] wasm-pack${RESET}"
echo "  (Only needed if building @ika.xyz/ika-wasm from source — npm install skips this)"
if command -v wasm-pack &>/dev/null; then
    WASM_PACK_VER=$(wasm-pack --version 2>/dev/null || echo "unknown")
    check "wasm-pack found. $WASM_PACK_VER"
else
    warn "wasm-pack not found (skip if using published npm package)"
    info "Install: curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh"
fi

echo ""

# ── wasm-bindgen-cli ─────────────────────────────────────────────────────────
REQUIRED_WASM_BINDGEN="0.2.100"
echo "${BOLD}[5/5] wasm-bindgen-cli${RESET}"
echo "  (Only needed if building @ika.xyz/ika-wasm from source)"
if command -v wasm-bindgen &>/dev/null; then
    WB_VER=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || echo "unknown")
    if [[ "$WB_VER" == "$REQUIRED_WASM_BINDGEN" ]]; then
        check "wasm-bindgen $WB_VER found (exact required version ✓)"
    else
        warn "wasm-bindgen found but version is $WB_VER (required: $REQUIRED_WASM_BINDGEN)"
        info "Install exact version: cargo install wasm-bindgen-cli --version $REQUIRED_WASM_BINDGEN --force"
        MISSING=$((MISSING+1))
    fi
else
    warn "wasm-bindgen not found (skip if using published npm package)"
    info "Install exact version: cargo install wasm-bindgen-cli --version $REQUIRED_WASM_BINDGEN"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $MISSING -eq 0 ]]; then
    echo ""
    echo "${GREEN}${BOLD}✓ All required tools are installed.${RESET}"
    echo ""
    echo "Next steps:"
    echo "  1. pnpm install                          # Install SDK"
    echo "  2. cp .env.example .env && edit .env     # Set PRIVATE_KEY + IKA_COIN_OBJECT_ID"
    echo "  3. Get SUI:  https://faucet.testnet.sui.io/"
    echo "  4. Get IKA:  https://faucet.ika.xyz/ (swap SUI → IKA)"
    echo "  5. pnpm dev                              # Run the example"
    echo ""
else
    echo ""
    echo "${YELLOW}${BOLD}⚠ $MISSING item(s) need attention.${RESET}"
    echo "  Run the install commands above, then re-run this script."
    echo ""
fi
