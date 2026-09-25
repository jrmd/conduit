// Rasterize the editable logo for Electron and desktop packaging.
import { chromium } from 'playwright';
import { readFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${await readFile(path.join(root, 'assets/icon.svg'), 'utf8')}`);
  await page.screenshot({ path: path.join(root, 'assets/icon.png'), omitBackground: true });
  await copyFile(path.join(root, 'assets/icon.svg'), path.join(root, 'public/conduit-mark.svg'));
  await copyFile(path.join(root, 'assets/icon.png'), path.join(root, 'public/conduit-mark.png'));
} finally { await browser.close(); }
