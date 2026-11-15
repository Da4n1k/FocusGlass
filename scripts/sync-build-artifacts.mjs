import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies freshly built Windows release binaries and NSIS installer to the
 * shared build output directory (`..\FocusGlass-build` by default).
 */
function parseArgs(argv) {
  let binaryOnly = false;
  let outDirOverride = '';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--binary-only') {
      binaryOnly = true;
    } else if (arg === '--out-dir') {
      const next = argv[i + 1];
      if (!next) {
        throw new Error('Missing value after --out-dir');
      }
      outDirOverride = next;
      i += 1;
    } else if (arg.startsWith('--out-dir=')) {
      outDirOverride = arg.slice('--out-dir='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { binaryOnly, outDirOverride };
}

function copyArtifact(src, dst, copied) {
  try {
    fs.copyFileSync(src, dst);
  } catch (err) {
    if (err && (err.code === 'EBUSY' || err.code === 'EPERM')) {
      throw new Error(
        `Cannot overwrite ${dst} because it is locked (${err.code}). Close running FocusGlass.exe and retry.`,
      );
    }
    throw err;
  }
  const { size } = fs.statSync(dst);
  copied.push({ name: path.basename(dst), size });
}

function findNewestNsisInstaller(nsisDir) {
  if (!fs.existsSync(nsisDir)) {
    throw new Error(`NSIS bundle directory not found: ${nsisDir}`);
  }
  const candidates = fs
    .readdirSync(nsisDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('-setup.exe'))
    .map((entry) => {
      const fullPath = path.join(nsisDir, entry.name);
      return {
        name: entry.name,
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (candidates.length === 0) {
    throw new Error(`No *-setup.exe installer found in ${nsisDir}`);
  }
  return candidates[0];
}

function removeStaleInstallers(outDir, keepName) {
  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('-setup.exe') && entry.name !== keepName) {
      fs.unlinkSync(path.join(outDir, entry.name));
    }
  }
}

function main() {
  if (process.platform !== 'win32') {
    return;
  }

  const { binaryOnly, outDirOverride } = parseArgs(process.argv.slice(2));

  if (process.env.FOCUSGLASS_SKIP_ARTIFACT_SYNC === '1') {
    return;
  }
  if (process.env.CI === 'true' && !outDirOverride && !process.env.FOCUSGLASS_BUILD_OUT_DIR) {
    return;
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const releaseDir = path.join(repoRoot, 'src-tauri', 'target', 'release');
  const outDir = path.resolve(
    repoRoot,
    outDirOverride || process.env.FOCUSGLASS_BUILD_OUT_DIR || path.join('..', 'FocusGlass-build'),
  );

  const exeSrc = path.join(releaseDir, 'focusglass.exe');
  if (!fs.existsSync(exeSrc)) {
    throw new Error(`Release executable not found: ${exeSrc}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const copied = [];

  copyArtifact(exeSrc, path.join(outDir, 'FocusGlass.exe'), copied);

  const neuroSdkRelease = path.join(releaseDir, 'neurosdk2-x64.dll');
  const neuroSdkVendor = path.join(repoRoot, 'src-tauri', 'vendor', 'neurosdk2-x64.dll');
  const neuroSdkSrc = fs.existsSync(neuroSdkRelease)
    ? neuroSdkRelease
    : fs.existsSync(neuroSdkVendor)
      ? neuroSdkVendor
      : null;
  if (neuroSdkSrc) {
    copyArtifact(neuroSdkSrc, path.join(outDir, 'neurosdk2-x64.dll'), copied);
  }

  const webViewSrc = path.join(releaseDir, 'WebView2Loader.dll');
  if (fs.existsSync(webViewSrc)) {
    copyArtifact(webViewSrc, path.join(outDir, 'WebView2Loader.dll'), copied);
  }

  if (!binaryOnly) {
    const nsisDir = path.join(releaseDir, 'bundle', 'nsis');
    const installer = findNewestNsisInstaller(nsisDir);
    removeStaleInstallers(outDir, installer.name);
    copyArtifact(installer.fullPath, path.join(outDir, installer.name), copied);
  }

  console.log(`[sync-build-artifacts] Synced ${copied.length} file(s) -> ${outDir}`);
  for (const item of copied) {
    console.log(`  - ${item.name} (${item.size} bytes)`);
  }
}

try {
  main();
} catch (err) {
  console.error(`[sync-build-artifacts] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
