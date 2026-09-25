import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let executable = electron;

// macOS reads the Dock/menu identity from the bundle before main.ts runs.
// Copy the runtime so pnpm's shared Electron installation stays untouched.
if (process.platform === 'darwin') {
  const cache = path.join(root, 'node_modules', '.cache', 'conduit-electron');
  const bundle = path.join(cache, 'Conduit.app');
  const stamp = path.join(cache, 'fingerprint');
  const icon = path.join(root, 'assets', 'icon.png');
  const sourceBundle = path.resolve(electron, '../../..');
  const fingerprint = createHash('sha256')
    .update(electron)
    .update(await readFile(path.join(sourceBundle, 'Contents', 'Info.plist')))
    .update(await readFile(icon))
    .update(await readFile(fileURLToPath(import.meta.url)))
    .digest('hex');
  executable = path.join(bundle, 'Contents', 'MacOS', 'Electron');
  const previous = await readFile(stamp, 'utf8').catch(() => '');
  if (previous !== fingerprint || !existsSync(executable)) {
    await rm(cache, { recursive: true, force: true });
    await mkdir(cache, { recursive: true });
    const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
    run('/usr/bin/ditto', [sourceBundle, bundle]);
    const plist = path.join(bundle, 'Contents', 'Info.plist');
    for (const [key, value] of Object.entries({
      CFBundleName: 'Conduit', CFBundleDisplayName: 'Conduit',
      CFBundleIdentifier: 'dev.jrmd.conduit.dev', CFBundleIconFile: 'conduit.icns',
    })) run('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
    const iconset = path.join(cache, 'conduit.iconset');
    await mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const pixels = String(size * scale);
        run('/usr/bin/sips', ['-z', pixels, pixels, icon, '--out',
          path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)]);
      }
    }
    run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(bundle, 'Contents', 'Resources', 'conduit.icns')]);
    // Editing bundle resources invalidates the downloaded runtime's signature.
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags', bundle]);
    await rm(iconset, { recursive: true });
    await writeFile(stamp, fingerprint);
  }
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [root, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
