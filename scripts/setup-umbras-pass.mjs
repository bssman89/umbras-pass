import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Readable } from 'node:stream';

const rootDir = process.cwd();
const modelsDir = path.join(rootDir, 'models');
const args = process.argv.slice(2);

const MODEL_PRESETS = {
  '1.7b': {
    label: 'Qwen3-1.7B (Q4_K_M)',
    repo: 'unsloth/Qwen3-1.7B-GGUF',
    defaultFile: 'Qwen3-1.7B-Q4_K_M.gguf',
  },
  '4b': {
    label: 'Qwen3-4B (Q4_K_M)',
    repo: 'unsloth/Qwen3-4B-GGUF',
    defaultFile: 'Qwen3-4B-Q4_K_M.gguf',
  },
  '8b': {
    label: 'Qwen3-8B (Q4_K_M)',
    repo: 'unsloth/Qwen3-8B-GGUF',
    defaultFile: 'Qwen3-8B-Q4_K_M.gguf',
  },
};

function getSelectedPreset() {
  const modelArg = args.find((a) => a.startsWith('--model='))?.split('=')[1]?.toLowerCase();
  if (modelArg && MODEL_PRESETS[modelArg]) {
    return MODEL_PRESETS[modelArg];
  }
  return MODEL_PRESETS['4b'];
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function resolveDownloadUrl(preset) {
  try {
    const res = await fetch(`https://huggingface.co/api/models/${preset.repo}/tree/main`, {
      headers: { Accept: 'application/json', 'User-Agent': 'UmbrasPass-AutoSetup/1.0' },
    });
    if (res.ok) {
      const files = await res.json();
      const ggufs = files.filter(
        (f) => f.type === 'file' && typeof f.path === 'string' && f.path.toLowerCase().endsWith('.gguf')
      );
      const exact = ggufs.find((f) => f.path.toLowerCase() === preset.defaultFile.toLowerCase());
      const q4 = ggufs.find((f) => /q4_k_m\.gguf$/i.test(f.path));
      const chosen = exact || q4 || ggufs[0];
      if (chosen?.path) {
        return {
          fileName: path.basename(chosen.path),
          url: `https://huggingface.co/${preset.repo}/resolve/main/${chosen.path}?download=true`,
          size: chosen.size || 0,
        };
      }
    }
  } catch (err) {
    console.warn('[Umbras Pass Setup] Hugging Face lookup fell back to direct URL:', err.message);
  }
  return {
    fileName: preset.defaultFile,
    url: `https://huggingface.co/${preset.repo}/resolve/main/${preset.defaultFile}?download=true`,
    size: 0,
  };
}

function ensureDependenciesInstalled() {
  if (args.includes('--skip-install')) return;
  const nodeModulesPath = path.join(rootDir, 'node_modules');
  const viteBinPath = path.join(nodeModulesPath, 'vite');
  if (fs.existsSync(nodeModulesPath) && fs.existsSync(viteBinPath) && !args.includes('--force-install')) {
    console.log('[1/3] npm & Vite dependencies already installed.');
    return;
  }
  console.log('[1/3] Installing npm & Vite dependencies (npm install)...');
  execSync('npm install', { stdio: 'inherit', cwd: rootDir });
}

async function ensureGgufModel(preset) {
  fs.mkdirSync(modelsDir, { recursive: true });
  const existing = fs
    .readdirSync(modelsDir)
    .filter((f) => f.toLowerCase().endsWith('.gguf'));

  if (existing.length > 0 && !args.includes('--force-download')) {
    const first = path.join(modelsDir, existing[0]);
    const stat = fs.statSync(first);
    console.log(`[2/3] Found existing local GGUF model: ${existing[0]} (${formatBytes(stat.size)})`);
    return first;
  }

  console.log(`[2/3] Downloading ${preset.label} from Hugging Face into ./models/...`);
  const resolved = await resolveDownloadUrl(preset);
  const destPath = path.join(modelsDir, resolved.fileName);
  const partialPath = `${destPath}.partial`;

  const res = await fetch(resolved.url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'UmbrasPass-AutoSetup/1.0' },
  });

  if (!res.ok || !res.body) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  }

  const totalBytes = Number(res.headers.get('content-length')) || resolved.size || 0;
  const writeStream = fs.createWriteStream(partialPath);
  const nodeStream = Readable.fromWeb(res.body);

  let downloaded = 0;
  let lastLog = Date.now();

  for await (const chunk of nodeStream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (!writeStream.write(buf)) {
      await new Promise((resolve) => writeStream.once('drain', resolve));
    }
    downloaded += buf.length;
    if (Date.now() - lastLog > 1000) {
      const pct = totalBytes > 0 ? ` (${Math.round((downloaded / totalBytes) * 100)}%)` : '';
      process.stdout.write(
        `\r      Progress: ${formatBytes(downloaded)}${totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ''}${pct}   `
      );
      lastLog = Date.now();
    }
  }

  await new Promise((resolve, reject) => {
    writeStream.end(() => resolve());
    writeStream.on('error', reject);
  });

  fs.renameSync(partialPath, destPath);
  console.log(`\n      Saved ${destPath} (${formatBytes(downloaded)})`);
  return destPath;
}

async function main() {
  const preset = getSelectedPreset();
  console.log('\n====================================================');
  console.log('  Umbras Pass — Automated Setup & Local GGUF Loader');
  console.log('====================================================\n');

  ensureDependenciesInstalled();
  await ensureGgufModel(preset);

  console.log('\n[3/3] Setup complete! Your local .gguf AI model is ready.');
  console.log('      Run "npm run dev" to launch Umbras Pass on http://localhost:3000');
  console.log('      Or launch your compiled Umbras Pass Windows .exe.\n');
}

main().catch((err) => {
  console.error('\n[Umbras Pass Setup] Error:', err.message || err);
  process.exit(1);
});
