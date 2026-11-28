import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';

export function prepareNative() {
  if (process.platform !== 'linux') return;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const kwin = process.env.FOCUSGLASS_BUILD_KWIN !== undefined
    ? process.env.FOCUSGLASS_BUILD_KWIN === '1'
    : /KDE/i.test(process.env.XDG_CURRENT_DESKTOP ?? '');
  let cmake = process.env.CMAKE ?? 'cmake';
  let buildEnv = process.env;
  if (spawnSync(cmake, ['--version'], { stdio: 'ignore' }).status !== 0) {
    // Reuse the CMake that configured this checkout, including an isolated SDK
    // prefix. Do not require a system-wide tools installation just for dev.
    const cache = resolve(root, 'native/build/CMakeCache.txt');
    const cached = existsSync(cache)
      ? readFileSync(cache, 'utf8').match(/^CMAKE_COMMAND:INTERNAL=(.+)$/m)?.[1] : undefined;
    if (!cached || !existsSync(cached)) {
      throw new Error('CMake is required for Linux development. Installed FocusGlass packages include prebuilt effects.');
    }
    cmake = cached;
    const libraries = resolve(cmake, '../../lib');
    buildEnv = { ...process.env, LD_LIBRARY_PATH: [libraries, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
  }
  const run = (args) => {
    const result = spawnSync(cmake, args, { cwd: root, stdio: 'inherit', env: buildEnv });
    if (result.error) throw new Error(`Cannot build Linux native effects: ${result.error.message}`);
    if (result.status !== 0) throw new Error('Linux native effects build failed. See the build output above.');
  };
  run(['-S', 'native', '-B', 'native/build', '-DCMAKE_BUILD_TYPE=RelWithDebInfo',
    `-DFOCUSGLASS_BUILD_KWIN=${kwin ? 'ON' : 'OFF'}`,
    '-DCMAKE_INSTALL_PREFIX=/usr', '-DKDE_INSTALL_USE_QT_SYS_PATHS=ON']);
  run(['--build', resolve(root, 'native/build'), '--parallel', '2']);
  const bundle = resolve(root, 'native/bundle');
  mkdirSync(bundle, { recursive: true });
  copyFileSync(resolve(root, 'native/build/focusglass-x11'), resolve(bundle, 'focusglass-x11'));
  for (const [source, name] of [
    ['plugins/kwin/effects/plugins/focusglass.so', 'focusglass.so'],
    ['focusglass-native-setup', 'focusglass-native-setup'],
  ]) {
    const destination = resolve(bundle, name);
    if (kwin) copyFileSync(resolve(root, 'native/build', source), destination);
    else rmSync(destination, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareNative();
