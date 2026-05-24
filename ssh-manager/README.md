# ⬡ ssh-manager

A secure, developer-friendly SSH session manager with a Claude Code-inspired TUI.  
**Never type a password or rebuild a jump chain again.**

---

## Install

```bash
cd ssh-manager
chmod +x install.sh
./install.sh
```

Then use `ssh-manager` or the short alias `sm`.

---

## Quick start

```bash
# 1. Add a direct host
sm add prod-web-01 --host 10.0.1.5 --user ubuntu --group prod

# 2. Add a jump/bastion host
sm add bastion --host 203.0.113.5 --user admin

# 3. Add a host that goes THROUGH the bastion
sm add db-prod --host 10.0.1.20 --user postgres --jump bastion --group prod

# 4. Connect instantly (handles the full jump chain automatically)
sm connect db-prod
# or just:
sm c db-prod

# 5. Open the TUI (navigate visually)
sm
```

---

## All commands

| Command | Short | Description |
|---------|-------|-------------|
| `ssh-manager` | `sm` | Open TUI |
| `ssh-manager connect <alias>` | `sm c <alias>` | Connect to host |
| `ssh-manager add <alias>` | | Add a host (interactive) |
| `ssh-manager list` | `sm ls` | List all hosts |
| `ssh-manager remove <alias>` | `sm rm <alias>` | Remove a host |
| `ssh-manager info <alias>` | | Show host details + SSH command |
| `ssh-manager history [alias]` | `sm hist` | Command history |
| `ssh-manager sessions [alias]` | | Session history |
| `ssh-manager keygen <alias>` | | Show ssh-copy-id commands for the chain |
| `ssh-manager import` | | Import from ~/.ssh/config |
| `ssh-manager cmd <alias> <cmd>` | | Run a one-off remote command |

---

## `sm add` options

```
-H, --host <hostname>      Hostname or IP address
-u, --user <username>      SSH username
-p, --port <port>          SSH port (default: 22)
-j, --jump <alias>         Single jump host alias
-J, --jump-chain <a,b,c>   Multi-hop chain (comma-separated aliases in order)
-i, --identity <path>      Path to private key (~/.ssh/id_ed25519 auto-detected)
-g, --group <group>        Group for organisation (default: "default")
-t, --tags <tags>          Comma-separated tags
    --password             Prompt for password (stored AES-encrypted)
```

---

## Multi-hop example

```bash
# Topology: laptop → bastion (public) → jump2 (internal) → database (private)

sm add bastion --host 203.0.113.5  --user admin
sm add jump2   --host 10.10.0.5    --user admin   --jump bastion
sm add db-prod --host 10.10.1.100  --user postgres --jump jump2

sm connect db-prod
# Generates: ssh -J admin@203.0.113.5,admin@10.10.0.5 postgres@10.10.1.100
```

---

## Key-based auth setup

```bash
# Show the ssh-copy-id commands for every hop in the chain
sm keygen db-prod
# Copy-paste and run each one — then you're passwordless forever
```

---

## TUI keyboard shortcuts

| Key | Action |
|-----|--------|
| `↑ / ↓` or `j / k` | Navigate host list |
| `Enter` or `c` | Connect to selected host |
| `/` | Filter hosts |
| `a` | Add new host |
| `d` | Delete host |
| `1` | Info tab (SSH command) |
| `2` | Command history tab |
| `3` | Session history tab |
| `?` | Help overlay |
| `q` | Quit |

---

## Data & security

- All data stored at `~/.ssh-manager/store.enc`  
- AES-256 encrypted using a machine-unique key at `~/.ssh-manager/.key`  
- Passwords never stored in plain text  
- File permissions: `chmod 600` on both files  
