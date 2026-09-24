import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'j2code-model-ui-fixture-'));
const dataDir = path.join(tempRoot, 'data');
const firstProject = path.join(tempRoot, 'fixture-atlas-payment');
const secondProject = path.join(tempRoot, 'fixture-launchpad-cli');
let app;

function makeRepo(directory) {
  execFileSync('git', ['init', '-b', 'main'], { cwd: directory, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'J2Code Fixture'], { cwd: directory });
  execFileSync('git', ['config', 'user.email', 'j2code-fixture@example.invalid'], { cwd: directory });
  execFileSync('git', ['add', '.'], { cwd: directory });
  execFileSync('git', ['commit', '-m', 'Fixture baseline'], { cwd: directory, stdio: 'ignore' });
}

try {
  for (const directory of [dataDir, firstProject, secondProject]) await mkdir(directory, { recursive: true });
  await writeFile(path.join(firstProject, 'README.md'), '# Fixture: Atlas Payment\n');
  await writeFile(path.join(firstProject, 'src.ts'), 'export async function charge() { return "fixture"; }\n');
  await writeFile(path.join(secondProject, 'README.md'), '# Fixture: Launchpad CLI\n');
  await writeFile(path.join(secondProject, 'src.rs'), 'fn main() { println!("fixture"); }\n');
  makeRepo(firstProject);
  makeRepo(secondProject);

  const now = Date.now();
  const projectOne = { id: 'fixture-atlas', name: 'Fixture: Atlas Payment', path: firstProject, createdAt: now - 2000 };
  const projectTwo = { id: 'fixture-launchpad', name: 'Fixture: Launchpad CLI', path: secondProject, createdAt: now - 1000 };
  const threadOne = {
    id: 'fixture-thread-retries', projectId: projectOne.id, title: 'Retry failed invoice requests', provider: 'codex', mode: 'edit', model: 'gpt-6-sol',
    messages: [
      { id: 'fixture-user-1', role: 'user', text: 'Add bounded retries to invoice requests. Keep existing error handling intact.', createdAt: now - 120000 },
      { id: 'fixture-assistant-1', role: 'assistant', text: 'Added a bounded exponential backoff with jitter. The retry stops after the configured limit and preserves the final response for callers.\n\n```ts\nfor (let attempt = 0; attempt <= maxRetries; attempt++) {\n  try { return await sendInvoice(); }\n  catch (error) { if (attempt === maxRetries) throw error; await delay(backoff(attempt)); }\n}\n```', createdAt: now - 90000 },
      { id: 'fixture-user-2', role: 'user', text: 'Can you explain how the delay grows?', createdAt: now - 60000 },
      { id: 'fixture-assistant-2', role: 'assistant', text: 'Each failed attempt doubles the base delay, adds a small random jitter, and respects the maximum delay. This spreads concurrent retries over time.', createdAt: now - 30000 },
    ], createdAt: now - 180000, updatedAt: now - 30000,
  };
  const threadTwo = {
    id: 'fixture-thread-export', projectId: projectTwo.id, title: 'Export CLI configuration', provider: 'codex', mode: 'read', model: undefined,
    messages: [
      { id: 'fixture-user-3', role: 'user', text: 'Where does the CLI read its configuration?', createdAt: now - 240000 },
      { id: 'fixture-assistant-3', role: 'assistant', text: 'The loader checks the project config first, then falls back to the user config. Missing optional values keep their defaults.', createdAt: now - 210000 },
    ], createdAt: now - 250000, updatedAt: now - 210000,
  };
  await writeFile(path.join(dataDir, 'state.json'), JSON.stringify({ projects: [projectOne, projectTwo], threads: [threadOne, threadTwo] }, null, 2));

  app = await electron.launch({
    executablePath: process.env.J2CODE_SMOKE_PACKAGED ? path.join(root, 'release', 'linux-unpacked', 'j2code') : path.join(root, 'node_modules', '.bin', 'electron'),
    args: [...(process.env.J2CODE_SMOKE_PACKAGED ? [] : [root]), `--user-data-dir=${path.join(tempRoot, 'electron')}`],
    env: { ...process.env, J2CODE_DATA_DIR: dataDir, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  await expect(page.getByTestId('model-selector')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Fixture: Atlas Payment', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Fixture: Launchpad CLI', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Added a bounded exponential backoff', { exact: false })).toBeVisible();

  // The app reads only the local installed CLI/cache. This does not start an agent turn.
  const catalogue = await page.evaluate(() => window.j2code.getModels('codex'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.changes-panel')).toBeHidden();
  await page.screenshot({ path: path.join(root, 'artifacts', 'workspace-012-1440.png'), scale: 'css' });
  await page.getByTestId('model-selector').click();
  await expect(page.getByRole('button', { name: /CLI default/i })).toBeVisible();
  await expect(page.getByLabel('Search models or enter exact model ID')).toBeVisible();
  if (catalogue.options.length) {
    await expect(page.getByRole('button', { name: new RegExp(catalogue.options[0].id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeVisible();
  }
  await page.evaluate(() => window.j2code.getSnapshot());

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(root, 'artifacts', 'model-ui-fixture-1440.png'), fullPage: true, scale: 'css' });
  await page.setViewportSize({ width: 850, height: 600 });
  await expect(page.getByTestId('model-selector')).toBeVisible();
  await page.screenshot({ path: path.join(root, 'artifacts', 'model-ui-fixture-850.png'), fullPage: true, scale: 'css' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.model-menu')).toBeHidden();
  await page.screenshot({ path: path.join(root, 'artifacts', 'workspace-012-850.png'), scale: 'css' });
  await page.getByTestId('model-selector').click();
  await page.locator('.topbar-left').click();
  await expect(page.locator('.model-menu')).toBeHidden();
  await page.getByRole('button', { name: 'Toggle changes', exact: true }).click();
  await expect(page.locator('.changes-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Close changes', exact: true }).click();
  await expect(page.locator('.changes-panel')).toBeHidden();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.getByRole('button', { name: /New thread.*Ctrl N/ }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Message' }).fill('A short prompt\nwith another line\nand another line');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
  console.log(`Model UI fixture screenshots saved; local Codex catalogue has ${catalogue.options.length} listed options. No prompts/provider turns were run.`);
} finally {
  if (app) await app.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}
