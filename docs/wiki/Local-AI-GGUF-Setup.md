# Local AI (`.gguf`) Setup

Umbras Pass runs **100% private, offline AI** on your own machine using `node-llama-cpp` and `.gguf` quantized language models—**no cloud API keys, telemetry, or paid subscriptions required**.

> **Optional by Design:** Don't want to download a multi-gigabyte model? Umbras Pass works completely out of the box using its built-in **deterministic rules engine** for deck analysis and bot gameplay.

---

## Recommended Model Tiers

| Model Tier | Approximate Size | Best For |
| --- | --- | --- |
| **`Qwen3-1.7B-Q4_K_M.gguf`** | ~1.1 GB | Older laptops or systems with 4–8 GB RAM |
| **`Qwen3-4B-Q4_K_M.gguf`** *(Default)* | ~2.5 GB | Most PCs (8 GB+ RAM); best speed-to-quality balance |
| **`Qwen3-8B-Q4_K_M.gguf`** | ~5.0 GB | Gaming PCs with 16 GB+ RAM or dedicated GPUs |

---

## Method 1: One-Click In-App Setup (Desktop App)

1. Launch **Umbras Pass**.
2. In the first-run **`.gguf` Startup Setup** modal, click the download button for your chosen model tier (fetched directly from Hugging Face, e.g., `unsloth/Qwen3-4B-GGUF`).
3. Progress is streamed cleanly; once downloaded, the model is stored locally and activated automatically.

You can also open **Settings → General → AI Engine & Local Models** at any time to:
- Switch between **Local GGUF AI** and **Deterministic Engine**.
- Select CPU vs. GPU compute mode.
- Browse to any existing `.gguf` file on your PC.
- Open your `models/` folder or delete an installed model to reclaim disk space.

---

## Method 2: Automated CLI Setup (Source Installs)

```bash
# Default Qwen3-4B (~2.5 GB)
npm run setup:gguf

# Choose a specific tier:
node scripts/setup-umbras-pass.mjs --model=1.7b
node scripts/setup-umbras-pass.mjs --model=4b
node scripts/setup-umbras-pass.mjs --model=8b
```

---

## Method 3: Manual Placement

1. Download a compatible `Qwen3` `.gguf` file from Hugging Face (`unsloth/Qwen3-4B-GGUF` or similar).
2. Place the `.gguf` file inside the `models/` folder next to your Umbras Pass executable or `package.json`:
   ```text
   umbras-pass/
   └── models/
       └── Qwen3-4B-Q4_K_M.gguf
   ```
3. Restart Umbras Pass (or select the file manually under **AI Engine & Local Models**).
