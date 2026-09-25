// Linux-runnable check of the real renderer with the macOS platform response.
// This verifies layout, not native traffic-light rendering or Dock identity.
import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), 'conduit-mac-header-'));
let app;
try {
  app = await electron.launch({ executablePath: path.join(root, 'node_modules/.bin/electron'), args: [root, `--user-data-dir=${path.join(temp, "profile")}`], env: { ...process.env, J2CODE_DATA_DIR: temp } });
  await app.evaluate(({ ipcMain, app }) => {
    ipcMain.removeHandler('app-info');
    ipcMain.handle('app-info', () => ({ version: app.getVersion(), platform: 'darwin' }));
  });
  const page = await app.firstWindow();
  await page.reload();
  await expect(page.locator('.platform-darwin')).toBeVisible();
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  for (const width of [1440, 850, 430]) {
    await page.setViewportSize({ width, height: 800 });
    if (width === 430) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    const header = await page.locator('.sidebar-top').boundingBox();
    const brand = await page.locator('.brand').boundingBox();
    const control = await page.locator(width === 430 ? '.sidebar-close' : '.sidebar-collapse').boundingBox();
    await page.screenshot({ path: path.join(root, `artifacts/mac-header-${width}.png`) });
    expect(Math.round(header.height), 'Header stays on one row').toBe(56);
    expect(Math.round(brand.x - header.x), 'Brand clears the native window controls').toBeGreaterThanOrEqual(94);
    expect(control.x - (brand.x + brand.width), 'Brand has room before sidebar control').toBeGreaterThanOrEqual(16);
    expect(Math.abs((brand.y + brand.height / 2) - (control.y + control.height / 2))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  }
  await page.setViewportSize({ width: 850, height: 800 });
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible();
  const reopen = await page.getByRole('button', { name: 'Expand sidebar', exact: true }).boundingBox();
  expect(reopen.x).toBeGreaterThanOrEqual(94);
  console.log('PASS: macOS renderer header keeps compact branding beside native controls, spaces branding/control, fits 1440/850/430, and preserves collapsed control clearance. Native macOS is not exercised.');
} finally {
  if (app) await app.close();
  await rm(temp, { recursive: true, force: true });
}
