# Troubleshooting & FAQ

### Can I use Umbras Pass without downloading a 2.5 GB AI model?
**Yes.** If you skip the `.gguf` download—or remove `.gguf` files from `models/`—Umbras Pass automatically falls back to its built-in deterministic rules engine for deck diagnostics, mana math, and bot gameplay. You can download or select a `.gguf` model anytime later.

---

### Which `.gguf` model size should I choose?
- **`Qwen3-1.7B` (~1.1 GB):** Best for laptops or PCs with 4–8 GB RAM.
- **`Qwen3-4B` (~2.5 GB):** Recommended default—best balance of speed and card-evaluation quality for 8 GB+ RAM systems.
- **`Qwen3-8B` (~5.0 GB):** Best strategic depth for systems with 16 GB+ RAM or dedicated GPUs.

---

### Where is my data stored?
Everything stays **locally on your machine** by default (browser storage for web sessions, or Electron `userData` + `./models/` for the desktop app). Optional Firebase cloud sync is only active if you configure `.env` and `firebase-applet-config.json`.

---

### Windows SmartScreen shows "Windows protected your PC" when launching `.exe`
Because Umbras Pass is an open-source indie release without a paid commercial Authenticode certificate, Windows SmartScreen may prompt on first run.
- Click **More info → Run anyway** if you downloaded the official release from [GitHub Releases](https://github.com/bssman89/umbras-pass/releases).
- Or inspect the source and compile your own `.exe` locally with `npm run dist:win` (see **[Building from Source & Releases](Building-from-Source-and-Releases)**).

---

### A card failed to resolve or prices didn't load
Umbras Pass resolves card metadata, Oracle text, and printings via the public **Scryfall API**.
- Check that you have an active internet connection when importing new cards.
- Check for typos or non-standard set/promo tags (the importer strips common Arena/Moxfield tags automatically, and any unrecognized names are listed under **Unresolved Cards**).

---

### Why do `models/` and `dist-electron/` not appear in the GitHub repository?
`models/`, `*.gguf`, `dist-electron/`, `firebase-applet-config.json`, and `.env*` (except `.env.example`) are intentionally excluded in `.gitignore` so multi-gigabyte weights, compiled binaries, and personal credentials are never committed to source control.
