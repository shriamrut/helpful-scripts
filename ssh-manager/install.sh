#!/usr/bin/env bash
# ssh-manager installer for macOS
set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}⬡ ssh-manager installer${RESET}"
echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# ── Check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js not found.${RESET}"
  echo "  Install it: brew install node"
  exit 1
fi
NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
echo -e "  ${GREEN}✓${RESET} Node.js ${NODE_VER}"

# ── Resolve install dir ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_TARGET="$HOME/.ssh-manager-app"

echo -e "  ${DIM}Installing to: ${INSTALL_TARGET}${RESET}"
mkdir -p "$INSTALL_TARGET"

# ── Copy files ────────────────────────────────────────────────────────────────
cp "$SCRIPT_DIR/index.js" "$INSTALL_TARGET/"
cp "$SCRIPT_DIR/package.json" "$INSTALL_TARGET/"
cp -r "$SCRIPT_DIR/src" "$INSTALL_TARGET/"
cp -r "$SCRIPT_DIR/node_modules" "$INSTALL_TARGET/"
echo -e "  ${GREEN}✓${RESET} Files copied"

# ── Make executable ───────────────────────────────────────────────────────────
chmod +x "$INSTALL_TARGET/index.js"

# ── Create symlinks in /usr/local/bin ────────────────────────────────────────
BIN_DIR="/usr/local/bin"
if [[ ! -w "$BIN_DIR" ]]; then
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
fi

ln -sf "$INSTALL_TARGET/index.js" "$BIN_DIR/ssh-manager"
ln -sf "$INSTALL_TARGET/index.js" "$BIN_DIR/sm"
echo -e "  ${GREEN}✓${RESET} Linked: ssh-manager + sm → ${BIN_DIR}"

# ── Shell completion hint ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓ Installation complete!${RESET}"
echo ""
echo -e "  ${CYAN}ssh-manager${RESET}              → Open TUI"
echo -e "  ${CYAN}sm${RESET}                       → Same (short alias)"
echo -e "  ${CYAN}sm connect prod-web-01${RESET}   → Connect instantly"
echo -e "  ${CYAN}sm add bastion --host 1.2.3.4 --user ubuntu${RESET}"
echo -e "  ${CYAN}sm list${RESET}                  → List all hosts"
echo -e "  ${CYAN}sm --help${RESET}                → All commands"
echo ""
echo -e "${DIM}Data stored encrypted at: ~/.ssh-manager/${RESET}"
echo ""

# ── Add to PATH if needed ─────────────────────────────────────────────────────
if [[ ":$PATH:" != *":$HOME/.local/bin:"* && "$BIN_DIR" == "$HOME/.local/bin" ]]; then
  echo -e "${YELLOW}! Add this to your ~/.zshrc or ~/.bashrc:${RESET}"
  echo -e "    export PATH=\"\$HOME/.local/bin:\$PATH\""
  echo ""
fi
