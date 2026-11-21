import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const args = new Set(process.argv.slice(2));

const CLEAN_BUILD_PATHS = ['dist', 'dist-server', 'server.js'];
const CLEAN_ALL_PATHS = [...CLEAN_BUILD_PATHS, 'dist-electron'];

function cleanTargets(paths) {
  for (const relPath of paths) {
    const absPath = path.join(rootDir, relPath);
    if (fs.existsSync(absPath)) {
      fs.rmSync(absPath, { recursive: true, force: true });
      console.log(`[Build] Cleaned ${relPath}`);
    }
  }
}

function runNodeScript(scriptPath, scriptArgs = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runLocalBin(packageBinRelPath, binArgs = [], fallbackCmd = '') {
  const binAbsPath = path.join(rootDir, packageBinRelPath);
  if (fs.existsSync(binAbsPath)) {
    runNodeScript(binAbsPath, binArgs);
    return;
  }

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npxCmd, [fallbackCmd, ...binArgs], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  if (args.has('--clean-only')) {
    cleanTargets(CLEAN_ALL_PATHS);
    return;
  }

  const shouldPackageWinAll = args.has('--win');
  const shouldPackageWinInstaller = args.has('--win-installer');
  const shouldPackageWin = shouldPackageWinAll || shouldPackageWinInstaller;
  cleanTargets(shouldPackageWin ? CLEAN_ALL_PATHS : CLEAN_BUILD_PATHS);

  console.log('[Build] Bundling frontend with Vite...');
  runLocalBin(path.join('node_modules', 'vite', 'bin', 'vite.js'), ['build'], 'vite');

  console.log('[Build] Bundling backend server...');
  runNodeScript(path.join(rootDir, 'scripts', 'build-server.mjs'));

  if (shouldPackageWin) {
    const targets = shouldPackageWinAll ? ['nsis', 'portable'] : ['nsis'];
    console.log(`[Build] Packaging Windows executables (${targets.join(', ')}) with electron-builder...`);
    runLocalBin(
      path.join('node_modules', 'electron-builder', 'cli.js'),
      ['--win', ...targets, '--x64'],
      'electron-builder'
    );

    const outDir = path.join(rootDir, 'dist-electron');
    const exeFiles = fs.existsSync(outDir)
      ? fs.readdirSync(outDir).filter((f) => f.toLowerCase().endsWith('.exe'))
      : [];

    if (exeFiles.length === 0) {
      throw new Error(
        `electron-builder finished, but no .exe files were found in ${outDir}. Check the output above for NSIS packaging errors.`
      );
    }

    console.log('\n[Build] Windows executables ready in dist-electron/:');
    for (const exe of exeFiles) {
      console.log(`  -> ${path.join('dist-electron', exe)}`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error('[Build] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
