# Umbra's Pass v1.2.0 — Windows Release Notes (`Umbras-Pass-Setup-1.2.0.exe` / `Umbras-Pass-Portable-1.2.0.exe`)

**Release Date:** 2026-11-23  
**Artifacts:**
- `Umbras-Pass-Setup-1.2.0.exe` — Windows NSIS Installer
- `Umbras-Pass-Portable-1.2.0.exe` — Portable Windows Executable (no installation required)

---

## What's New in v1.2.0

### 🌐 1–4 Player Multiplayer Tabletop (Offline LAN & Self-Hosted Online)
- Host or join **1–4 player hybrid pods** with human friends and adaptive AI bots over home Wi-Fi/Ethernet (**Offline LAN**) or remote port-forwarded sessions (**Self-Hosted Online**).
- Includes built-in **Host Local IP Detection**, a live **`Test Port Reachability`** tool, and copy-pasteable **Router Port-Forwarding & OS Firewall** instructions (Windows PowerShell + Linux/macOS UFW).
- Secured with a 6-character Room Code, scrypt-hashed Session Passcode, and **Host Lobby Approval** before guests take a tabletop seat.
- Clean, streamlined Multiplayer Configuration screen for fast hosting and scanning/joining open sessions.

### 🃏 Free-Form Drag-and-Drop Playmat Interface
- Drag and arrange permanents **anywhere** on your playmat—and reposition bot creatures on bot playmats—in both **Playtest** and **Multiplayer** modes.
- Drag cards directly from Hand, Command Zone, Graveyard, or Exile to drop them at exact board coordinates, or drag untapped attackers onto opponent seats to attack.
- Includes toggleable **`Zone Guides`**, one-click **`Tidy Board`**, and automatic non-overlapping card placement and combat advance animations for AI bots.

### 🎨 Custom Tabletop Playmats, Backgrounds, Proxies & Tokens
- **Per-User & Per-Tabletop Playmats**: Customize individual player seat mats and full tabletop backgrounds with built-in themes, art presets, or custom image URLs synced live in multiplayer rooms.
- **Custom Card Art, Proxies & Tokens**: Apply custom card images, create playtest proxies with custom frames/stats, and spawn custom tokens directly onto the battlefield.

### 🧭 Streamlined Playtest Tab & Fixes
- Renamed **Bot Playtest** to **Playtest** and merged Playtest & Live AI Bot setup controls into a cleaner configuration flow.
- Fixed the **Workspace Sync Error** (`"Rendered more hooks than during the previous render"`).
- Fixed card artwork loading so Scryfall card images and custom proxies appear cleanly on every card.

---

## Quick Windows Install & Upgrade Notes
1. Download **`Umbras-Pass-Setup-1.2.0.exe`** (installer) or **`Umbras-Pass-Portable-1.2.0.exe`** (portable).
2. If upgrading from v1.1.0, your local `models/` folder (e.g., `Qwen3-4B-Q4_K_M.gguf`) and saved playmat/proxy preferences are preserved automatically.
3. For **Self-Hosted Online Multiplayer**, open TCP port `3000` using the built-in **Router Port-Forwarding Guide** and click **`Test Port Reachability`** inside the Host Setup panel before sharing your Room Code and Passcode.

Full technical history is available in **[CHANGELOG.md](CHANGELOG.md)**.
