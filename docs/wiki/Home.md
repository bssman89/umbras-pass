# Welcome to the Umbras Pass Wiki

**Umbras Pass** (v1.2.1) is an open-source, standalone *Magic: The Gathering* deck analyzer, Karsten-calibrated mana base optimizer, and interactive 1–4 player tabletop simulator built by **BizRoomba (`bssman89`)**.

It supports **100% private, offline AI** via local `.gguf` language models (`node-llama-cpp`)—with zero cloud API keys or subscriptions required—alongside **Offline LAN & Self-Hosted Public IPv4 Multiplayer** with friends and AI bots.

![Umbras Pass Mana & Land Analysis Dashboard](https://raw.githubusercontent.com/bssman89/umbras-pass/main/docs/screenshots/03-analysis-dashboard.png)

---

## Wiki Directory

| Guide | What You'll Learn |
| --- | --- |
| **[Getting Started](Getting-Started)** | Installing the Windows `.exe` or running from source with `setup-gguf` |
| **[Deck Importer & Formats](Deck-Importer-and-Formats)** | Importing from Arena, Moxfield, Archidekt, ManaBox CSV, URLs, formats & Brackets |
| **[Mana & Deck Analysis](Mana-and-Deck-Analysis)** | Land/source math, Turn-T castability, Synergy Audit, Deep Metrics, Hover Zoom & exports |
| **[Bot Playtest & Live Tabletop](Bot-Playtest-and-Live-Tabletop)** | 1v1 and 4-Player Commander pods, animated d20 rolls, Stack interrupts, zones, tokens & adaptive bot memory |
| **[Local AI (.gguf) Setup](Local-AI-GGUF-Setup)** | `Qwen3-1.7B / 4B / 8B` tiers, Hugging Face downloads, manual `models/` setup & CPU/GPU tuning |
| **[Settings & Workspace](Settings-and-Workspace)** | TopBar sections, `My Decks`, local/Firebase profiles, Settings tabs & release updater |
| **[Building from Source & Releases](Building-from-Source-and-Releases)** | `npm` scripts, Electron/NSIS Windows `.exe` packaging, GitHub Actions & publishing this Wiki |
| **[Troubleshooting & FAQ](Troubleshooting-and-FAQ)** | Running without AI weights, low-RAM guidance, SmartScreen, Scryfall & build troubleshooting |
| **[Disclaimer & Credits](Disclaimer-and-Credits)** | Unofficial fan project notice, trademark attributions, "as is" license terms & credits |

---

## Core Capabilities at a Glance

- **Universal Deck Importer:** Paste text, import by URL, or upload `.txt` / `.csv` / `.dek` files from MTG Arena, Moxfield, Archidekt, MTGGoldfish, ManaBox, MTGO, Cockatrice, Scryfall, Deckstats, TappedOut, CubeCobra, MTGTop8, Pastebin, and GitHub Gists.
- **Karsten-Calibrated Mana & Curve Engine:** Diagnoses land counts, tapped-land tempo, color pip distributions, Turn-T castability odds, ramp/draw/removal/board-wipe counts, synergy gaps, and 8 MTG formats.
- **Offline LAN & Self-Hosted Public IPv4 Multiplayer:** 1–4 player hybrid pods with automatic `0.0.0.0:3000` binding, router port-forwarding guides, strict `localhost` firewall protections, hidden WAN room directories, scrypt passcodes, Host Lobby Approval, and a synced 4-seat lobby life tracker.
- **Free-Form Playmats & Animated d20 Roll-Off:** Drag permanents anywhere on enlarged 2D playmats, use zone guides and tidy board, and roll an animated d20 with tie-breakers to decide who goes first.
- **Interactive Card Previews & Visual Stack:** Global hover card zoom overlay, Card Inspector pricing/printings, and a real-time MTG Arena-style visual Stack (`CR 405`) with automatic trigger detection (`CR 603`).

---

## Quick Links

- **Source Repository:** [github.com/bssman89/umbras-pass](https://github.com/bssman89/umbras-pass)
- **Windows Releases:** [github.com/bssman89/umbras-pass/releases](https://github.com/bssman89/umbras-pass/releases)
- **Issue Tracker:** [github.com/bssman89/umbras-pass/issues](https://github.com/bssman89/umbras-pass/issues)
- **Support Email:** `umbraspass.support@gmail.com`
