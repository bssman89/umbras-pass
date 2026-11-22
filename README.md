# Umbras Pass — Indie Magic: The Gathering Deck Analyzer & Playtest Sim

Umbras Pass is an independent Magic: The Gathering deck analyzer, mana base optimizer, and tactical playtest simulator with adaptive AI bots powered by a local `.gguf` AI model (**no Google Gemini or cloud API key required**).

---

## Program Preview

### Deck Importer & Sample Decks
Import decklists from Arena, Moxfield, Archidekt, MTGGoldfish, ManaBox CSV, MTGO, or Cockatrice, or test instantly with built-in sample decks.

![Umbras Pass Deck Importer](docs/screenshots/02-deck-importer.png)

### Mana & Land Analysis Dashboard
Karsten-calibrated land and ramp targets, tapped-land tempo warnings, spell mana curve, and color pip distribution.

![Umbras Pass Mana & Land Analysis Dashboard](docs/screenshots/03-analysis-dashboard.png)

### Advanced Deck Metrics
Stacked mana curve distribution with cumulative playability curve, color identity breakdown, and average/median CMC benchmarks.

![Umbras Pass Advanced Deck Metrics](docs/screenshots/04-advanced-deck-metrics.png)

### Live Tabletop VS Adaptive AI Bots (1v3 Commander & 1v1)
Interactive turn-by-turn tabletop simulator against adaptive bots with hover card zoom, phase tracking, and persistent bot matchup memory.

![Umbras Pass Live Tabletop VS AI Bots](docs/screenshots/05-live-tabletop-playtest.png)

### Program Setup & Ai Model Configuration  `.gguf` Setup Screen
New users are guided through a one-click `.gguf` model download or automated setup script on first launch — no cloud API keys needed.

![Umbras Pass One-Time GGUF Setup Screen](docs/screenshots/01-gguf-startup-setup.png)

---

## Quick Start (Automated Script — Handles Everything)

To unlock full local AI deck analysis and adaptive bot learning, **you need to download a `.gguf` model file once**. Our automated setup script installs all npm & Vite dependencies, creates the `models/` folder, and downloads the recommended `Qwen3-4B-Q4_K_M.gguf` model (~2.5 GB) for you automatically.

### 1. Clone the Repository
```bash
git clone https://github.com/bssman89/umbras-pass.git
cd umbras-pass
```

### 2. Run the Automated `.gguf` Setup Script
Choose whichever option fits your system:

- **Windows (Double-Click):**
  Double-click **`setup-gguf.bat`** in the project folder. It automatically runs `npm install`, creates `models/`, and downloads `Qwen3-4B-Q4_K_M.gguf` from Hugging Face.
- **macOS / Linux:**
  ```bash
  chmod +x setup-gguf.sh
  ./setup-gguf.sh
  ```
- **Any OS via npm:**
  ```bash
  npm install
  npm run setup:gguf
  ```
  *(Optional model sizes: `node scripts/setup-umbras-pass.mjs --model=1.7b` for older/low-RAM PCs, or `--model=8b` for high-RAM systems.)*

### 3. Start Umbras Pass
```bash
npm run dev
```
Open `http://localhost:3000` in your browser.

> **First-Time Users (or Windows `.exe` Users):** On your very first launch, Umbras Pass also shows a **one-time startup screen** that lets you auto-download the recommended `.gguf` file with one click or download `setup-gguf.bat` directly.

---

## Manual `.gguf` Model Download (Optional)

If you prefer to download the `.gguf` file manually instead of using the automated script:

1. Download **`Qwen3-4B-Q4_K_M.gguf`** (or another compatible tier such as `Qwen3-1.7B`, `Qwen3-8B`, or `Qwen3.8-27B`) from Hugging Face:
   - [unsloth/Qwen3-4B-GGUF on Hugging Face](https://huggingface.co/unsloth/Qwen3-4B-GGUF)
2. Create a `models/` folder in the root of your Umbras Pass folder (or next to the `.exe`) and move the `.gguf` file inside:
   ```text
   umbras-pass/
   └── models/
       └── Qwen3-4B-Q4_K_M.gguf
   ```
3. Launch Umbras Pass — it automatically detects `.gguf` files in `models/`, or you can pick any `.gguf` file on your PC under **AI Model Settings**.

*(If you skip downloading a `.gguf` file, Umbras Pass still runs using its built-in deterministic rules engine until you add a model later.)*

---

## Prerequisites & Dependencies (npm & Vite)

- **Node.js `v20+`** and **npm**

### Core Web & Build Dependencies
- **Vite** (`vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`) — Frontend bundler, PWA service worker, and chunked production builds
- **React & TypeScript** (`react`, `react-dom`, `typescript`, `tsx`, `esbuild`) — UI runtime, strict type checking, and server bundling
- **Styling & Icons** (`tailwindcss`, `@tailwindcss/vite`, `autoprefixer`, `lucide-react`, `motion`) — Styling, icon set, and UI transitions
- **Charts** (`recharts`) — Mana curve distributions, color identity breakdowns, radar profiles, and CMC analytics (`charts-vendor` chunk)

### Backend, Local AI & Packaging
- **Express & Environment** (`express`, `dotenv`) — Local API server, Scryfall card metadata/pricing proxy, and deck analysis endpoints
- **Local GGUF Engine** (`node-llama-cpp`) — Runs local `.gguf` models directly on CPU/GPU without cloud API keys
- **Firebase** (`firebase`) — Optional cloud sync for saved decks and bot memory (configure via `.env` from `.env.example` if desired)
- **Electron** (`electron`, `electron-builder`) — Builds standalone Windows `.exe` installers (`nsis`), portable `.exe`, and offline bundled folders

---

## Useful npm Scripts

| Command | Description |
| --- | --- |
| `npm run setup:gguf` | Automated all-in-one setup: installs npm/Vite dependencies and downloads the `.gguf` model into `./models/` |
| `npm run dev` | Starts the Express + Vite development server on port `3000` |
| `npm run build` | Builds the optimized Vite production frontend (`dist/`) |
| `npm run build:server` | Bundles the Node/Express backend (`dist-server/`) |
| `npm run lint` | Runs TypeScript type checking (`tsc --noEmit`) |
| `npm run electron` | Launches Umbras Pass inside Electron |
| `npm run download:qwen4b` | Downloads only `Qwen3-4B-Q4_K_M.gguf` into `./models/` |
| `npm run dist:win` | Builds standalone Windows installer & portable `.exe` files in `dist-electron/` |
| `npm run dist:win:bundle` | Builds an unpacked Windows folder and copies your `./models/*.gguf` files side-by-side |
| `npm run dist:win:qwen4b` | Downloads `Qwen3-4B-Q4_K_M.gguf` (if missing) and packages the complete offline Windows folder |

---

## Building & Sharing Windows `.exe` Releases

- **Standalone `.exe` (no bundled model):** Run `npm run dist:win` (or push a Git tag like `v1.0.0` to trigger the included GitHub Actions workflow) to build the NSIS installer and portable `.exe` in `dist-electron/`. New users will see the one-time startup screen to auto-download their `.gguf` file.
- **Offline bundle with `.gguf` included:** Run `npm run dist:win:qwen4b`, then zip and share the entire `dist-electron/win-unpacked/` folder so `models/` stays next to the `.exe`.

---

## Security & Repository Hygiene

`models/`, `*.gguf`, `firebase-applet-config.json`, `dist-electron/`, and `.env*` (except `.env.example`) are excluded via `.gitignore` so large model weights, compiled binaries, and personal credentials are never committed to GitHub.
