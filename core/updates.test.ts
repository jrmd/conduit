import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import type { createUpdates } from '../electron/updates';

test('installed builds check the public release feed without GitHub CLI or credentials', async () => {
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL(feed: unknown) {
      assert.deepEqual(JSON.parse(JSON.stringify(feed)), {
        provider: 'github', owner: 'jrmd', repo: 'conduit',
      });
    },
    async checkForUpdates() { updater.emit('update-not-available'); },
  });
  const bundle = buildSync({
    entryPoints: ['electron/updates.ts'], bundle: true, platform: 'node',
    format: 'cjs', write: false, packages: 'external',
  }).outputFiles[0].text;
  const module = { exports: {} as { createUpdates: typeof createUpdates } };
  runInNewContext(bundle, {
    module, exports: module.exports,
    process: { platform: 'linux', env: { APPIMAGE: '/tmp/Conduit.AppImage' } },
    require(name: string) {
      if (name === 'electron') return { app: { isPackaged: true, getVersion: () => '0.8.0' } };
      if (name === 'electron-updater') return { autoUpdater: updater };
      throw new Error(`Update checks must not load ${name}`);
    },
  });
  const status = await module.exports.createUpdates(() => false).check();
  assert.equal(status.state, 'current');
  assert.equal(status.version, '0.8.0');
  const config = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(config.build.publish[0].private, undefined);
});
