const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const net = require('net');
const { fork } = require('child_process');

let mainWindow = null;
let serverProcess = null;
let activePort = 0;
let activeServerUrl = '';

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 34567;
      srv.close(() => resolve(port));
    });
  });
}

let recentServerLogs = [];

function recordServerLog(chunk) {
  const line = String(chunk || '').trim();
  if (!line) return;
  recentServerLogs.push(line);
  if (recentServerLogs.length > 15) {
    recentServerLogs = recentServerLogs.slice(-15);
  }
}

function resolveServerEntryPath() {
  const unpacked = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-server', 'server.mjs')
    : '';
  const localDev = path.join(__dirname, '..', 'dist-server', 'server.mjs');
  const candidates = [unpacked, localDev].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return localDev;
}

function resolveDistDirPath() {
  const unpacked = process.resourcesPath
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist')
    : '';
  const localDev = path.join(__dirname, '..', 'dist');
  const candidates = [unpacked, localDev].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return localDev;
}

function waitForServerReady(url, timeoutMs = 25000) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(`${url}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          scheduleRetry();
        }
      });
      req.on('error', () => scheduleRetry());
      req.setTimeout(1500, () => {
        req.destroy();
        scheduleRetry();
      });
      req.end();
    };

    const scheduleRetry = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Server failed to respond at ${url} within ${timeoutMs}ms`));
      } else {
        setTimeout(probe, 250);
      }
    };

    probe();
  });
}

function resolveBundledModelsDir() {
  const exeModelsDir = path.join(path.dirname(app.getPath('exe')), 'models');
  if (fs.existsSync(exeModelsDir)) {
    return exeModelsDir;
  }
  const devModelsDir = path.join(__dirname, '..', 'models');
  if (fs.existsSync(devModelsDir)) {
    return devModelsDir;
  }
  return exeModelsDir;
}

async function startInternalServer(port) {
  const serverPath = resolveServerEntryPath();
  const distDir = resolveDistDirPath();
  const serverCwd = path.dirname(path.dirname(serverPath));
  const userDataDir = app.getPath('userData');
  const bundledModelsDir = resolveBundledModelsDir();
  fs.mkdirSync(path.join(userDataDir, 'models'), { recursive: true });
  recentServerLogs = [];

  try {
    serverProcess = fork(serverPath, [], {
      cwd: serverCwd,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
        UMBRAS_DESKTOP: '1',
        UMBRAS_APP_VERSION: app.getVersion(),
        UMBRAS_USER_DATA_DIR: userDataDir,
        UMBRAS_BUNDLED_MODELS_DIR: bundledModelsDir,
        UMBRAS_DIST_DIR: distDir,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });

    if (serverProcess.stdout) {
      serverProcess.stdout.on('data', (d) => {
        process.stdout.write(`[Server] ${d}`);
        recordServerLog(d);
      });
    }
    if (serverProcess.stderr) {
      serverProcess.stderr.on('data', (d) => {
        process.stderr.write(`[Server Error] ${d}`);
        recordServerLog(d);
      });
    }

    serverProcess.on('error', (err) => {
      console.error('[Electron] Failed to start internal server:', err);
      recordServerLog(err.message);
    });

    serverProcess.on('exit', (code, signal) => {
      console.log(`[Electron] Internal server exited with code ${code}, signal ${signal}`);
      recordServerLog(`Server exited (code ${code}, signal ${signal})`);
    });
  } catch (err) {
    console.error('[Electron] Could not fork server:', err);
    recordServerLog(err instanceof Error ? err.message : String(err));
  }
}

function registerIpcHandlers() {
  ipcMain.handle('desktop:select-gguf-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: 'Select Local Hugging Face GGUF Model',
      properties: ['openFile'],
      filters: [{ name: 'GGUF AI Models', extensions: ['gguf'] }],
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('desktop:get-info', async () => {
    return {
      isDesktop: true,
      version: app.getVersion(),
      platform: process.platform,
      userDataPath: app.getPath('userData'),
      bundledModelsDir: resolveBundledModelsDir(),
      totalRamGb: Math.max(1, Math.round(os.totalmem() / 1024 ** 3)),
      serverPort: activePort,
    };
  });

  ipcMain.handle('desktop:open-models-folder', async () => {
    const bundledDir = resolveBundledModelsDir();
    if (fs.existsSync(bundledDir)) {
      await shell.openPath(bundledDir);
      return;
    }
    const modelsDir = path.join(app.getPath('userData'), 'models');
    fs.mkdirSync(modelsDir, { recursive: true });
    await shell.openPath(modelsDir);
  });

  ipcMain.handle('desktop:open-updates-folder', async () => {
    const updatesDir = path.join(app.getPath('userData'), 'updates');
    fs.mkdirSync(updatesDir, { recursive: true });
    await shell.openPath(updatesDir);
  });

  ipcMain.handle('desktop:launch-update-installer', async (_event, rawFilePath) => {
    if (typeof rawFilePath !== 'string' || !rawFilePath.trim()) {
      return { ok: false, error: 'Installer path is required.' };
    }
    const updatesDir = path.resolve(path.join(app.getPath('userData'), 'updates'));
    fs.mkdirSync(updatesDir, { recursive: true });
    const resolvedTarget = path.resolve(rawFilePath.trim());
    const normalizeForCmp = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
    if (!normalizeForCmp(resolvedTarget).startsWith(normalizeForCmp(updatesDir + path.sep))) {
      return { ok: false, error: 'Refused to open file outside the verified updates folder.' };
    }
    if (!resolvedTarget.toLowerCase().endsWith('.exe')) {
      return { ok: false, error: 'Only verified .exe installers can be launched.' };
    }
    if (!fs.existsSync(resolvedTarget)) {
      return { ok: false, error: 'Downloaded installer file was not found on disk.' };
    }
    const realUpdatesDir = fs.realpathSync(updatesDir);
    const realTarget = fs.realpathSync(resolvedTarget);
    if (!normalizeForCmp(realTarget).startsWith(normalizeForCmp(realUpdatesDir + path.sep))) {
      return { ok: false, error: 'Refused to open symlinked file outside the verified updates folder.' };
    }
    const openError = await shell.openPath(realTarget);
    if (openError) {
      return { ok: false, error: openError };
    }
    return { ok: true };
  });

  ipcMain.handle('desktop:exit-app', async () => {
    if (serverProcess) {
      try {
        serverProcess.kill('SIGTERM');
      } catch {
        // Ignore server kill errors during shutdown
      }
      serverProcess = null;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeAllListeners('close');
    }
    app.quit();
  });
}

async function createWindow() {
  const iconPath = path.join(
    __dirname,
    '..',
    'public',
    'assets',
    'aistudio',
    'Umbras_pass_v3-removebg-preview_58159528.png'
  );

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#090a0f',
    title: 'Umbras Pass — Indie Magic: The Gathering Deck Analyzer & Playtest Sim',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const revealTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 2500);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(revealTimer);
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const hasSelection = Boolean(params.selectionText && params.selectionText.trim().length > 0);
    if (!params.isEditable && !hasSelection) return;

    const template = [];
    if (params.isEditable) {
      template.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: params.editFlags.canSelectAll }
      );
    } else if (hasSelection) {
      template.push({ role: 'copy' });
    }

    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: mainWindow });
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (!activeServerUrl || !url.startsWith(activeServerUrl)) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', async (event, navigationUrl) => {
    if (navigationUrl.startsWith('http://127.0.0.1:') && navigationUrl.includes('retry=1')) {
      event.preventDefault();
      if (!serverProcess || serverProcess.exitCode !== null) {
        await startInternalServer(activePort);
      }
      try {
        await waitForServerReady(activeServerUrl, 15000);
        if (mainWindow && !mainWindow.isDestroyed()) {
          await mainWindow.loadURL(activeServerUrl);
        }
      } catch (retryErr) {
        console.error('[Electron] Retry connection failed:', retryErr);
      }
    }
  });

  try {
    await waitForServerReady(activeServerUrl);
    await mainWindow.loadURL(activeServerUrl);
  } catch (err) {
    console.error('[Electron] Failed to connect to local server:', err);
    const logsText = recentServerLogs.join('\n') || 'No server stderr output captured.';
    const retryHref = `${activeServerUrl}/?retry=1`;
    mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`
        <body style="background:#090a0f;color:#e2e8f0;font-family:sans-serif;padding:40px;text-align:center;">
          <h2 style="color:#ef4444;">Umbras Pass Local Server Startup Timeout</h2>
          <p>Attempted connection to ${activeServerUrl}.</p>
          <pre style="max-width:760px;margin:16px auto;text-align:left;background:#141821;border:1px solid #2d3546;padding:12px;border-radius:8px;font-size:12px;overflow:auto;color:#fca5a5;">${logsText.replace(/</g, '&lt;')}</pre>
          <a href="${retryHref}" style="display:inline-block;text-decoration:none;background:#29abe2;color:#0b1117;font-weight:bold;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">Retry</a>
        </body>
      `)}`
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerIpcHandlers();

    activePort = process.env.PORT ? Number(process.env.PORT) : await findFreePort();
    activeServerUrl = `http://127.0.0.1:${activePort}`;

    try {
      await waitForServerReady(activeServerUrl, 700);
      console.log('[Electron] Connected to existing server at', activeServerUrl);
    } catch {
      console.log('[Electron] Starting internal server on', activeServerUrl);
      await startInternalServer(activePort);
    }

    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    if (serverProcess) {
      try {
        serverProcess.kill('SIGTERM');
      } catch (err) {
        console.error('[Electron] Error terminating server process:', err);
      }
    }
  });
}
