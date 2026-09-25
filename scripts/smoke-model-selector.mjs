import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'j2code-model-smoke-'));
const projectDir = path.join(tempRoot, 'project');
const dataDir = path.join(tempRoot, 'data');
let app;

try {
  await mkdir(projectDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'model-smoke'], { cwd: projectDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'J2Code Model Smoke'], { cwd: projectDir });
  execFileSync('git', ['config', 'user.email', 'j2code-model-smoke@example.invalid'], { cwd: projectDir });
  await writeFile(path.join(projectDir, 'README.md'), 'Disposable model picker fixture.\n');
  execFileSync('git', ['add', 'README.md'], { cwd: projectDir });
  execFileSync('git', ['commit', '-m', 'Model picker fixture'], { cwd: projectDir, stdio: 'ignore' });

  app = await electron.launch({
    executablePath: path.join(root, 'release', 'linux-unpacked', 'conduit'),
    args: [],
    env: { ...process.env, J2CODE_DATA_DIR: dataDir, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 30_000,
  });
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, projectDir);
  const page = await app.firstWindow();
  await expect(page.getByText('j2code', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Open project folder' }).click();
  await expect(page.getByText('project', { exact: true }).first()).toBeVisible({ timeout: 10_000 });

  const modelPicker = page.getByTestId('model-selector')
    .or(page.getByRole('button', { name: 'Select model', exact: true }));
  try {
    await expect(modelPicker.first()).toBeVisible({ timeout: 3_000 });
  } catch {
    const buttons = await page.getByRole('button').evaluateAll(items => items.map(item => ({
      name: item.getAttribute('aria-label') || item.textContent?.trim(),
      html: item.outerHTML,
    })));
    await page.screenshot({ path: path.join(root, 'artifacts', 'model-picker-missing-current.png'), fullPage: true, scale: 'css' });
    console.error(`Model picker candidates on current packaged screen: ${JSON.stringify(buttons)}`);
    throw new Error('Missing model selector: no visible [data-testid="model-selector"] or exact accessible button name "Select model".');
  }
  console.log('Model selector is visible in the packaged app.');
} finally {
  if (app) await app.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}
