import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Readable } from 'node:stream';

const rootDir = process.cwd();
const modelsDir = path.join(rootDir, 'models');
const args = new Set(process.argv.slice(2));

const QWEN4B_REPO = 'unsloth/Qwen3-4B-GGUF';
const QWEN4B_DEFAULT_FILE = 'Qwen3-4B-Q4_K_M.gguf';

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function resolveQwen4bDownloadUrl() {
  try {
    const res = await fetch(`https://huggingface.co/api/models/${QWEN4B_REPO}/tree/main`, {
      headers: { Accept: 'application/json', 'User-Agent': 'UmbrasPass-Builder/1.0' },
    });
    if (res.ok) {
      const files = await res.json();
      const ggufs = files.filter(
        (f) => f.type === 'file' && typeof f.path === 'string' && f.path.toLowerCase().endsWith('.gguf')
      );
      const exact = ggufs.find((f) => f.path.toLowerCase() === QWEN4B_DEFAULT_FILE.toLowerCase());
      const q4 = ggufs.find((f) => /q4_k_m\.gguf$/i.test(f.path));
      const chosen = exact || q4 || ggufs[0];
      if (chosen?.path) {
        return {
          fileName: path.basename(chosen.path),
          url: `https://huggingface.co/${QWEN4B_REPO}/resolve/main/${chosen.path}?download=true`,
          size: chosen.size || 0,
        };
      }
    }
  } catch (err) {
    console.warn('[UmbrasPass] Hugging Face API lookup failed, using default URL:', err.message);
  }
  return {
    fileName: QWEN4B_DEFAULT_FILE,
    url: `https://huggingface.co/${QWEN4B_REPO}/resolve/main/${QWEN4B_DEFAULT_FILE}?download=true`,
    size: 0,
  };
}

async function downloadQwen4b() {
  fs.mkdirSync(modelsDir, { recursive: true });
  const existing = fs
    .readdirSync(modelsDir)
    .filter((f) => f.toLowerCase().endsWith('.gguf'));
  const existingQwen = existing.find((f) => f.toLowerCase().includes('qwen3-4b'));
  if (existingQwen) {
    const full = path.join(modelsDir, existingQwen);
    const stat = fs.statSync(full);
    console.log(`[UmbrasPass] Found existing GGUF: ${full} (${formatBytes(stat.size)})`);
    return full;
  }

  const resolved = await resolveQwen4bDownloadUrl();
  const destPath = path.join(modelsDir, resolved.fileName);
  const partialPath = `${destPath}.partial`;

  console.log(`[UmbrasPass] Downloading ${resolved.fileName} from ${QWEN4B_REPO}...`);
  const res = await fetch(resolved.url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'UmbrasPass-Builder/1.0' },
  });

  if (!res.ok || !res.body) {
    throw new Error(`Failed to download from Hugging Face: HTTP ${res.status} ${res.statusText}`);
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
    if (Date.now() - lastLog > 1500) {
      const pct = totalBytes > 0 ? ` (${Math.round((downloaded / totalBytes) * 100)}%)` : '';
      process.stdout.write(
        `\r[UmbrasPass] Downloaded ${formatBytes(downloaded)}${totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ''}${pct}   `
      );
      lastLog = Date.now();
    }
  }

  await new Promise((resolve, reject) => {
    writeStream.end(() => resolve());
    writeStream.on('error', reject);
  });
  fs.renameSync(partialPath, destPath);
  console.log(`\n[UmbrasPass] Saved ${destPath} (${formatBytes(downloaded)})`);
  return destPath;
}

function runCommand(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: rootDir });
}

function findUnpackedOutputDir() {
  const distElectron = path.join(rootDir, 'dist-electron');
  const candidates = ['win-unpacked', 'linux-unpacked', 'mac-arm64', 'mac'];
  for (const dirName of candidates) {
    const full = path.join(distElectron, dirName);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

async function bundleDesktopFolder() {
  fs.mkdirSync(modelsDir, { recursive: true });

  if (args.has('--with-qwen4b')) {
    await downloadQwen4b();
  }

  runCommand('npm run build');
  runCommand('npm run build:server');

  const isWin = process.platform === 'win32';
  const builderArgs = isWin ? '--win dir --x64' : '--dir';
  runCommand(`npx electron-builder ${builderArgs}`);

  const unpackedDir = findUnpackedOutputDir();
  if (!unpackedDir) {
    throw new Error('Could not find Electron unpacked output directory inside dist-electron/.');
  }

  const targetModelsDir = path.join(unpackedDir, 'models');
  fs.mkdirSync(targetModelsDir, { recursive: true });

  const localGgufs = fs
    .readdirSync(modelsDir)
    .filter((f) => f.toLowerCase().endsWith('.gguf'));

  if (localGgufs.length === 0) {
    console.warn(
      `\n[UmbrasPass] Warning: No .gguf files found in ${modelsDir}.` +
        `\nCopy Qwen3-4B-Q4_K_M.gguf into ${targetModelsDir} or run: npm run dist:win:qwen4b`
    );
  } else {
    for (const fileName of localGgufs) {
      const src = path.join(modelsDir, fileName);
      const dst = path.join(targetModelsDir, fileName);
      const srcStat = fs.statSync(src);
      const needsCopy =
        !fs.existsSync(dst) || fs.statSync(dst).size !== srcStat.size;
      if (needsCopy) {
        console.log(
          `[UmbrasPass] Copying ${fileName} (${formatBytes(srcStat.size)}) to ${targetModelsDir}...`
        );
        fs.copyFileSync(src, dst);
      } else {
        console.log(`[UmbrasPass] Side-by-side model already up to date: ${dst}`);
      }
    }
  }

  console.log(`\n[UmbrasPass] Desktop folder bundle complete!`);
  console.log(`  App folder:    ${unpackedDir}`);
  console.log(`  Models folder: ${targetModelsDir}`);
}

async function main() {
  if (args.has('--download-only')) {
    await downloadQwen4b();
    return;
  }
  await bundleDesktopFolder();
}

main().catch((err) => {
  console.error('\n[UmbrasPass] Build helper failed:', err);
  process.exit(1);
});
