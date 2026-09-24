import { build } from 'esbuild';
await build({ entryPoints: ['electron/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron', 'electron-updater'], sourcemap: true });
await build({ entryPoints: ['electron/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron', 'electron-updater'], sourcemap: true });
