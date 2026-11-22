# Building from Source & Releases

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite (`vite-plugin-pwa`), Tailwind CSS v4, Lucide Icons, Motion, Recharts
- **Backend & AI Runtime:** Node.js v20+, Express, `node-llama-cpp` (local `.gguf` CPU/GPU inference), Scryfall API proxy
- **Desktop Packaging & Optional Sync:** Electron (`electron-builder` NSIS + Portable), Firebase

---

## Available `npm` Scripts

| Command | Description |
| --- | --- |
| `npm run setup:gguf` | Installs dependencies and downloads `Qwen3-4B-Q4_K_M.gguf` into `./models/` |
| `npm run dev` | Starts the Express + Vite development server on `http://localhost:3000` |
| `npm run build` | Builds the production web frontend (`dist/`) |
| `npm run build:server` | Bundles the Node/Express backend (`dist-server/server.mjs`) via `esbuild` |
| `npm run lint` | Runs TypeScript type checking (`tsc --noEmit`) |
| `npm run electron` | Launches Umbras Pass inside Electron |
| `npm run download:qwen4b` | Downloads only `Qwen3-4B-Q4_K_M.gguf` into `./models/` |
| `npm run dist:win` | Builds standalone Windows NSIS installer (`Umbras-Pass-Setup-*.exe`) & Portable `.exe` in `dist-electron/` |
| `npm run dist:win:installer` | Builds only the Windows NSIS installer (`Umbras-Pass-Setup-*.exe`) in `dist-electron/` |
| `npm run dist:win:bundle` | Builds unpacked `dist-electron/win-unpacked/` and copies `./models/*.gguf` side-by-side |
| `npm run dist:win:qwen4b` | Downloads `Qwen3-4B-Q4_K_M.gguf` (if missing) and packages an offline desktop bundle |
| `npm run clean` | Cleans `dist`, `dist-server`, `server.js`, and `dist-electron` |

---

## Packaging Windows `.exe` Installers

Windows executables are packaged via `electron-builder` on Windows (or via the GitHub Actions workflow `.github/workflows/build-desktop-exe.yml` on `windows-latest`):

- `public/icon.ico` (6-resolution `.ico`, 256×256 through 16×16) is configured for:
  - `win.icon` (`Umbras Pass.exe` via `rcedit` with `signAndEditExecutable: true`)
  - `nsis.installerIcon`, `nsis.uninstallerIcon`, and `nsis.installerHeaderIcon` (`Umbras-Pass-Setup-${version}.exe` & uninstaller)
  - Desktop & Start Menu shortcuts (`Umbras Pass`)
- To trigger a CI build & GitHub Release automatically, push a semantic tag such as `v1.0.0`:
  ```bash
  git tag v1.0.0
  git push origin v1.0.0
  ```

---

## Publishing Updates to the GitHub Wiki

Ready-to-publish Markdown files for this Wiki are stored inside `docs/wiki/` in the main repository. To sync them to GitHub's Wiki tab:

1. In your GitHub repository, open **Settings → Features** and make sure **Wikis** is enabled.
2. Open the **Wiki** tab once on GitHub and click **Create the first page** (GitHub requires at least one initial page before `.wiki.git` exists).
3. Clone the wiki repository and copy the files from `docs/wiki/`:
   ```bash
   git clone https://github.com/bssman89/umbras-pass.wiki.git
   cp path/to/umbras-pass/docs/wiki/*.md umbras-pass.wiki/
   cd umbras-pass.wiki
   git add *.md
   git commit -m "Publish Umbras Pass GitHub Wiki"
   git push
   ```
