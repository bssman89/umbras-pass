# Umbra's Pass v1.2.0 — Windows Release Notes (`Umbras-Pass-Setup-1.2.0.exe` / `Umbras-Pass-Portable-1.2.0.exe`)

**Release Date:** 2026-11-23  
**Artifacts:**
- `Umbras-Pass-Setup-1.2.0.exe` — Windows NSIS Installer
- `Umbras-Pass-Portable-1.2.0.exe` — Portable Windows Executable (no installation required)

---

## What's New in v1.2.0

### 🌐 1–4 Player Multiplayer Tabletop (Offline LAN & Self-Hosted Public IPv4)
- Host or join **1–4 player hybrid pods** with human friends and adaptive AI bots over home Wi-Fi/Ethernet (**Offline LAN**) or router port-forwarded **Self-Hosted Public IPv4** (`0.0.0.0:3000` automatic binding).
- Includes built-in **Local & Public IPv4 Detection**, direct `UP-XXXX` room code / seat invite URL joining, a live **`Test Port Reachability`** tool, and copy-pasteable **Router Port-Forwarding & OS Firewall** instructions (Windows PowerShell + Linux/macOS UFW).
- **Localhost Firewall & Anti-Leak Security**: Private host routes (local deck analysis, `.gguf` AI endpoints, OS file paths, room creation, and diagnostics) are locked strictly to `localhost` (`127.0.0.1` / `::1`), the active room list is hidden from public/WAN callers, remote errors are sanitized, and guests require your Room Code, scrypt-hashed Session Passcode, and **Host Lobby Approval** before entering a seat.
- Clean, streamlined Multiplayer Configuration screen plus a **Persistent 4-Seat Lobby Life Total Tracker** (`-5`, `-1`, `+1`, `+5`, format-aware resets, carry-over into match start, and `< 10` life **Danger Zone** alerts).

### 🎲 Animated d20 Turn-Order Roll-Off & Enlarged Tabletop Play Area
- Added an animated **20-sided die (`d20`) roll-off** stage and launch modal in **Live Play vs AI Bots** and **Multiplayer Lobbies**, complete with automatic sudden-death tie-breakers, sound cues, and one-click chat sharing.
- Enlarged playmats, permanent & hand card tiles, fanned card-back hand counts, 2/3/4-seat turn-order strips, full vertical MTG card tiles inside opponent/bot playmats, and expanded chat/log drawers across **Live vs AI Bots**, **Solo Goldfish**, **Online/LAN Multiplayer**, and **Match Replay**.

### 🃏 Free-Form Drag-and-Drop Playmats & Custom Cosmetics
- Drag and arrange permanents **anywhere** on your playmat—and reposition bot creatures on bot playmats—with toggleable **`Zone Guides`**, one-click **`Tidy Board`**, and automatic non-overlapping card placement.
- Customize per-seat playmats, table-wide backgrounds, custom card art/proxies, frame borders, and custom battlefield tokens synced live across multiplayer rooms.

### 🧭 Streamlined Playtest Arena, Settings & Fixes
- Streamlined the **Playtest & Tabletop Arena** navigation, Live Bot configuration, and **Playtest & Multiplayer Guide** with larger, clearer controls across the entire UI.
- Added the official website link (**`https://umbraspass.org/`**) inside **Settings → About**.
- Fixed the React `"Cannot read properties of null (reading 'useMemo')"` error via Vite single-instance deduplication, resolved the Workspace Sync hook ordering error, and fixed Scryfall card artwork hydration.

---

## Quick Windows Install & Upgrade Notes
1. Download **`Umbras-Pass-Setup-1.2.0.exe`** (installer) or **`Umbras-Pass-Portable-1.2.0.exe`** (portable).
2. If upgrading from v1.1.0, your local `models/` folder (e.g., `Qwen3-4B-Q4_K_M.gguf`) and saved playmat/proxy preferences are preserved automatically.
3. For **Self-Hosted Online Multiplayer**, open TCP port `3000` using the built-in **Router Port-Forwarding Guide** and click **`Test Port Reachability`** inside the Host Setup panel before sharing your Room Code and Passcode.

Full technical history is available in **[CHANGELOG.md](CHANGELOG.md)**.
