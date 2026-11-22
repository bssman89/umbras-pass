# Umbras Pass — Indie Magic: The Gathering Deck Analyzer & Playtest Sim

**Umbras Pass** is a free, standalone *Magic: The Gathering* deck analyzer, mana base optimizer, and tabletop playtest simulator. It features adaptive AI opponents powered by a local `.gguf` language model—meaning **100% private, offline AI with no cloud API keys or subscriptions required**.

<!-- Quick Navigation -->
- [Key Features](#key-features)
- [Screenshots](#screenshots)
- [Getting Started](#getting-started)
  - [Option A: Windows App (No Coding Required)](#option-a-windows-app-no-coding-required)
  - [Option B: Run from Source (Developers)](#option-b-run-from-source-developers)
- [Manual AI Model Setup (Optional)](#manual-ai-model-setup-optional)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Developer Reference & Building Releases](#developer-reference--building-releases)

---

## Key Features

- **Universal Deck Importer:** Paste or import decklists directly from **MTG Arena, Moxfield, Archidekt, MTGGoldfish, ManaBox (CSV), MTGO, or Cockatrice**, or jump right in with built-in sample decks.
- **Karsten-Calibrated Mana Analysis:** Automatically checks land counts, ramp targets, color pip distributions, and tapped-land tempo warnings so you stop getting mana-screwed.
- **Deep Curve & Playability Metrics:** Visualize stacked mana curves, cumulative playability odds, color identity breakdowns, and average/median CMC benchmarks.
- **Live Tabletop Simulator (1v1 & 1v3 Commander):** Test your deck turn-by-turn against adaptive AI bots with hover card zoom, phase tracking, and persistent matchup memory.
- **100% Local AI:** Runs directly on your PC's CPU or GPU using `.gguf` models. *(Don't want to download an AI model? Umbras Pass still works out of the box using its built-in deterministic rules engine!)*

---

## Screenshots

### Deck Importer & Sample Decks
Import from any major deckbuilder or test immediately with pre-loaded decks.
![Umbras Pass Deck Importer](docs/screenshots/02-deck-importer.png)

### Mana & Land Analysis Dashboard
Optimize land counts, color sources, and early-game tempo.
![Umbras Pass Mana & Land Analysis Dashboard](docs/screenshots/03-analysis-dashboard.png)

### Advanced Deck Metrics
Inspect stacked mana curves, playability percentages, and CMC benchmarks.
![Umbras Pass Advanced Deck Metrics](docs/screenshots/04-advanced-deck-metrics.png)

### Live Tabletop vs. Adaptive AI Bots
Playtest 1v1 or 4-player Commander pods against bots that learn your deck's threats.
![Umbras Pass Live Tabletop VS AI Bots](docs/screenshots/05-live-tabletop-playtest.png)

### One-Click `.gguf` AI Setup
Guided first-time setup downloads and configures the local AI automatically.
![Umbras Pass One-Time GGUF Setup Screen](docs/screenshots/01-gguf-startup-setup.png)

---

## Getting Started

### Option A: Windows App (No Coding Required)

1. Download the latest Windows release (`.exe` installer or portable `.zip`) from the **[Releases](../../releases)** page.
2. Launch **Umbras Pass**.
3. On your first launch, a **one-time setup screen** will appear. Click the button to automatically download the recommended AI model (`Qwen3-4B-Q4_K_M.gguf`, ~2.5 GB) into the right folder.
4. Once finished, start importing decks and playtesting!

---

### Option B: Run from Source (Developers)

**Prerequisites:** Make sure you have [Node.js v20+](https://nodejs.org/) installed.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/bssman89/umbras-pass.git
   cd umbras-pass
   ```

2. **Run the automated setup script** (installs dependencies, creates `models/`, and downloads the AI model):
   - **Windows:** Double-click `setup-gguf.bat` in the project folder.
   - **macOS / Linux:**
     ```bash
     chmod +x setup-gguf.sh
     ./setup-gguf.sh
     ```
   - **Any OS (via npm):**
     ```bash
     npm install
     npm run setup:gguf
     ```
   > **Tip for Low-RAM or High-End PCs:** You can choose a different model size using `node scripts/setup-umbras-pass.mjs --model=1.7b` (lightweight) or `--model=8b` (high-end).

3. **Start the app:**
   ```bash
   npm run dev
   ```
   Open **`http://localhost:3000`** in your browser.

---

## Manual AI Model Setup (Optional)

If you prefer to download the AI model manually or already have `.gguf` files on your computer:

1. Download **`Qwen3-4B-Q4_K_M.gguf`** (or another compatible `Qwen3` tier) from [Hugging Face (`unsloth/Qwen3-4B-GGUF`)](https://huggingface.co/unsloth/Qwen3-4B-GGUF).
2. Place the `.gguf` file inside a `models/` folder in your Umbras Pass directory (right next to the `.exe` or `package.json`):
   ```text
   umbras-pass/
   └── models/
       └── Qwen3-4B-Q4_K_M.gguf
   ```
3. Restart Umbras Pass—it will automatically detect the model, or you can browse to any `.gguf` file on your PC under **AI Model Settings**.

---

## Troubleshooting & FAQ

- **Can I use Umbras Pass without downloading a 2.5 GB AI model?**
  Yes! If you skip the `.gguf` download, Umbras Pass automatically falls back to its fast, built-in deterministic rules engine for deck analysis and bot gameplay. You can add an AI model anytime later.
- **Which AI model size should I pick?**
  - `Qwen3-4B` (~2.5 GB) — Best balance of speed and smart gameplay for most PCs (8 GB+ RAM).
  - `Qwen3-1.7B` (~1.1 GB) — Best for older laptops or systems with limited RAM.
  - `Qwen3-8B` (~5.0 GB) — Best strategic depth for gaming PCs with 16 GB+ RAM or dedicated GPUs.
- **Where is my data stored?**
  Everything stays locally on your machine by default. Optional Firebase cloud sync is supported if you configure `.env` using `.env.example`.

---

<details>
<summary><strong>Developer Reference, Tech Stack & Building Windows Releases (Click to Expand)</strong></summary>

### Tech Stack
- **Frontend:** React, TypeScript, Vite (`vite-plugin-pwa`), Tailwind CSS, Lucide Icons, Motion, Recharts
- **Backend & Local AI:** Node.js, Express, `node-llama-cpp` (CPU/GPU `.gguf` inference), Scryfall API proxy
- **Desktop Packaging & Optional Sync:** Electron (`electron-builder`), Firebase

### Useful npm Scripts
| Command | Description |
| --- | --- |
| `npm run setup:gguf` | Installs npm dependencies and downloads `Qwen3-4B-Q4_K_M.gguf` into `./models/` |
| `npm run dev` | Starts the Express + Vite development server on `http://localhost:3000` |
| `npm run build` | Builds the production frontend (`dist/`) |
| `npm run build:server` | Bundles the Node/Express backend (`dist-server/`) |
| `npm run lint` | Runs TypeScript type checking (`tsc --noEmit`) |
| `npm run electron` | Launches Umbras Pass inside Electron |
| `npm run download:qwen4b` | Downloads only `Qwen3-4B-Q4_K_M.gguf` into `./models/` |
| `npm run dist:win` | Builds standalone Windows installer & portable `.exe` in `dist-electron/` |
| `npm run dist:win:bundle` | Builds an unpacked Windows folder and copies `./models/*.gguf` side-by-side |
| `npm run dist:win:qwen4b` | Downloads `Qwen3-4B-Q4_K_M.gguf` (if missing) and packages a complete offline Windows bundle |

### Building & Sharing Windows `.exe` Releases
- **Standalone `.exe` (no bundled model):** Run `npm run dist:win` (or push a Git tag like `v1.0.0` to trigger GitHub Actions). Users will see the one-time startup screen to auto-download their `.gguf` model.
- **Offline bundle with `.gguf` included:** Run `npm run dist:win:qwen4b`, then zip and share the entire `dist-electron/win-unpacked/` folder so `models/` stays next to the `.exe`.

### Security & Repository Hygiene
`models/`, `*.gguf`, `firebase-applet-config.json`, `dist-electron/`, and `.env*` (except `.env.example`) are ignored via `.gitignore` so large model weights, compiled binaries, and personal credentials are never committed to GitHub.

</details>
