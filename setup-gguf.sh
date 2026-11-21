#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo "  Umbras Pass - Automated Local AI (.gguf) Setup"
echo "============================================================"
echo ""

if command -v node >/dev/null 2>&1 && [ -f "package.json" ]; then
  echo "Running automated setup (npm dependencies + .gguf model)..."
  node scripts/setup-umbras-pass.mjs "$@"
  exit 0
fi

mkdir -p models
TARGET_FILE="models/Qwen3-4B-Q4_K_M.gguf"
MODEL_URL="https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf?download=true"

if [ -f "$TARGET_FILE" ]; then
  echo "Found existing model at $TARGET_FILE — skipping download."
else
  echo "Downloading Qwen3-4B-Q4_K_M.gguf from Hugging Face (~2.5 GB)..."
  curl -L --progress-bar -o "${TARGET_FILE}.partial" "$MODEL_URL"
  mv "${TARGET_FILE}.partial" "$TARGET_FILE"
  echo "Saved $TARGET_FILE successfully!"
fi

echo ""
echo "Setup complete! Start Umbras Pass and your local .gguf model will load automatically."
