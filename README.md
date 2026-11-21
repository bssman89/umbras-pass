# Umbras Pass — Indie Magic: The Gathering Deck Analyzer & Playtest Sim

Umbras Pass is an independent Magic: The Gathering deck analyzer, mana base optimizer, and tactical playtest simulator.

## Run Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure `GEMINI_API_KEY` in a local `.env` file (excluded from git via `.gitignore`) or in your environment secrets.
3. Start the development server:
   ```bash
   npm run dev
   ```

## Security & Repository Hygiene

`models/`, `*.gguf`, `firebase-applet-config.json`, and `.env*` (except `.env.example`) are excluded via `.gitignore` so model weights and credentials are never committed to GitHub.
