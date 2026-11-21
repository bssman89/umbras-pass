# Umbras Pass — Indie Magic: The Gathering Deck Analyzer & Playtest Sim

Umbras Pass is an independent Magic: The Gathering deck analyzer, mana base optimizer, and tactical playtest simulator with adaptive AI bots powered by local `.gguf` models.

---

## Prerequisites

- **Node.js** `v20+` and **npm**
- **A local `.gguf` AI model file** (optional for basic deterministic analysis, recommended for full AI deck analysis and adaptive bot learning — **no cloud API keys required**)

---

## Tech Stack & Dependencies

### Core Web & Build (npm & Vite)
- **Vite** (`vite`, `@vitejs/plugin-react`, `vite-plugin-pwa`) — Frontend dev bundler, PWA service worker, and chunked production builds
- **React & TypeScript** (`react`, `react-dom`, `typescript`, `tsx`, `esbuild`) — UI runtime, strict type checking, and server bundling
- **Styling & Icons** (`tailwindcss`, `@tailwindcss/vite`, `autoprefixer`, `lucide-react`, `motion`) — Utility styling, icons, and transitions
- **Data Visualization** (`recharts`) — Mana curve distributions, color identity breakdowns, radar profiles, and CMC analytics (`charts-vendor` chunk)

### Backend, Local AI & Persistence
- **Express & Environment** (`express`, `dotenv`) — Local API server, Scryfall card lookup/pricing proxy, and deck analysis endpoints
- **Local GGUF Inference** (`node-llama-cpp`) — Runs quantized `.gguf` LLMs directly on your CPU/GPU with no external API key
- **Firebase** (`firebase`) — Optional user authentication and private cloud deck/bot-memory syncing

### Windows Desktop Packaging
- **Electron** (`electron`, `electron-builder`) — Builds standalone Windows `.exe` installers (`nsis`), portable executables (`portable`), and unpacked folders with bundled `.gguf` models

---

## Local Setup (Using a `.gguf` Model)

1. **Install npm & Vite dependencies:**
   ```bash
   npm install
   ```

2. **Add a local `.gguf` model file** (choose any of the three methods below):
   - **Option A — Automatic download (Recommended):**
     Download the compact `Qwen3-4B-Q4_K_M.gguf` model directly into `./models/`:
     ```bash
     npm run download:qwen4b
     ```
   - **Option B — Manual placement:**
     Place any `.gguf` model file (e.g., `Qwen3-1.7B`, `Qwen3-4B`, `Qwen3-8B`, or `Qwen3.8-27B` from Hugging Face) inside the `./models/` folder at the project root. Umbras Pass automatically detects `.gguf` files in `models/` on startup.
   - **Option C — Pick a `.gguf` file in the app:**
     Launch the app and open **AI Model Settings** to download a recommended GGUF tier or browse for an existing `.gguf` file anywhere on your computer.

   *(Note: If no `.gguf` file is present yet, the analyzer and playtester automatically fall back to the built-in deterministic rules engine until you select a model.)*

3. **Optional environment configuration:**
   Copy `.env.example` to `.env` only if you want to configure optional Firebase cloud sync (`VITE_FIREBASE_*`) or custom app settings. No Google Gemini API key is required when running with a local `.gguf` model.

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   The app runs locally on `http://localhost:3000`.

---

## Useful npm Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Starts the Express + Vite development server on port `3000` |
| `npm run build` | Builds the optimized Vite production frontend (`dist/`) |
| `npm run build:server` | Bundles the Node/Express server (`dist-server/`) |
| `npm run lint` | Runs TypeScript type checking (`tsc --noEmit`) |
| `npm run electron` | Launches the app inside Electron |
| `npm run download:qwen4b` | Downloads `Qwen3-4B-Q4_K_M.gguf` into `./models/` |
| `npm run dist:win` | Builds standalone Windows installer & portable `.exe` files in `dist-electron/` |
| `npm run dist:win:bundle` | Builds an unpacked Windows desktop folder and copies your local `./models/*.gguf` files side-by-side |
| `npm run dist:win:qwen4b` | Downloads `Qwen3-4B-Q4_K_M.gguf` (if missing) and packages the full offline Windows desktop folder |

---

## Building & Sharing Windows `.exe` Releases

- **Standalone `.exe` (no bundled model):** Run `npm run dist:win` (or push a Git tag like `v1.0.0` to trigger the included GitHub Actions workflow) to produce the NSIS installer and portable `.exe` in `dist-electron/`. Recipients can select or download a `.gguf` file from **AI Model Settings** on first run.
- **Offline bundle with `.gguf` included:** Run `npm run dist:win:qwen4b`, then zip and share the entire `dist-electron/win-unpacked/` folder so the `models/` directory stays next to the `.exe`.

---

## Security & Repository Hygiene

`models/`, `*.gguf`, `firebase-applet-config.json`, `dist-electron/`, and `.env*` (except `.env.example`) are excluded via `.gitignore` so large model weights, build artifacts, and personal credentials are never committed to GitHub.
