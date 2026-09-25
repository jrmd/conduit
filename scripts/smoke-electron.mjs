import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'j2code-electron-smoke-'));
const projectDir = path.join(tempRoot, 'project');
const dataDir = path.join(tempRoot, 'data');
const smokePrompt = process.env.J2CODE_SMOKE_PROVIDER === '1';
const screenshotPrefix = process.env.J2CODE_SMOKE_SCREENSHOT_PREFIX;
const packaged = process.env.J2CODE_SMOKE_PACKAGED === '1';
const pageErrors = [];
let app;

function git(...args) {
  return execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' }).trim();
}

async function waitForText(page, text) {
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
}

async function launchApp() {
  const instance = await electron.launch({
    executablePath: packaged
      ? path.join(root, 'release', 'linux-unpacked', 'conduit')
      : path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron'),
    args: packaged ? [] : [root],
    env: {
      ...process.env,
      J2CODE_DATA_DIR: dataDir,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: 30_000,
  });
  await instance.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, projectDir);
  return instance;
}

try {
  await mkdir(projectDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  git('init', '-b', 'smoke');
  git('config', 'user.name', 'J2Code Smoke');
  git('config', 'user.email', 'j2code-smoke@example.invalid');
  await writeFile(path.join(projectDir, 'tracked.txt'), 'before\n');
  git('add', 'tracked.txt');
  git('commit', '-m', 'Initial fixture');
  await writeFile(path.join(projectDir, 'tracked.txt'), 'after\n');
  await writeFile(path.join(projectDir, 'unrelated-staged.txt'), 'keep staged\n');
  git('add', 'unrelated-staged.txt');

  if (process.env.J2CODE_SMOKE_SKIP_BUILD !== '1') execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
  app = await launchApp();

  const page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(String(error)));
  await expect(page.getByText('j2code', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Add the disposable project through the real IPC path and native dialog stub.
  await page.getByRole('button', { name: /Choose a project|Open a local folder/ }).click();
  await page.getByRole('button', { name: /Open folder/ }).click();
  await waitForText(page, 'project');

  // Settings shows discovered local CLIs and current install state.
  await page.getByRole('button', { name: /Agent settings/i }).click();
  const settingsDialog = page.getByRole('dialog');
  await expect(settingsDialog).toBeVisible();
  await expect(settingsDialog.getByText('Agent settings', { exact: true })).toBeVisible();
  await expect(settingsDialog.getByText('Codex', { exact: true })).toBeVisible();
  await settingsDialog.getByRole('button', { name: 'Close', exact: true }).last().click();

  // Verify provider discovery and expose which local CLIs are available.
  const providers = await page.evaluate(() => window.j2code.discover());
  if (!providers.some(provider => provider.id === 'codex' && provider.available)) {
    throw new Error('Codex CLI is unavailable; cannot exercise thread creation.');
  }
  await page.locator('.provider-select').click();
  const cursorOption = page.getByRole('button', { name: /Cursor/ });
  await expect(cursorOption).toBeVisible();
  const cursorInfo = providers.find(provider => provider.id === 'cursor');
  if (cursorInfo?.available) await expect(cursorOption).toBeEnabled();
  else await expect(cursorOption).toBeDisabled();
  await page.locator('.provider-select').click();

  await page.getByRole('button', { name: /New thread/i }).click();
  // The empty composer is a draft. Create an empty local thread through the same
  // exposed API the first send uses so persistence can be checked without a provider call.
  const projectId = (await page.evaluate(() => window.j2code.getSnapshot())).projects[0].id;
  const thread = await page.evaluate(id => window.j2code.createThread(id, 'codex', 'edit'), projectId);
  await expect(page.locator('.thread-item')).toHaveCount(1, { timeout: 10_000 });

  // Verify persistence by reopening the app against the same isolated state file.
  const snapshotBeforeRestart = await page.evaluate(() => window.j2code.getSnapshot());
  if (snapshotBeforeRestart.projects.length !== 1 || snapshotBeforeRestart.threads.length !== 1 || thread.messages.length !== 0) {
    throw new Error(`Unexpected snapshot before restart: ${JSON.stringify(snapshotBeforeRestart)}`);
  }
  await app.close();
  app = await launchApp();
  const resumedPage = await app.firstWindow();
  resumedPage.on('pageerror', error => pageErrors.push(String(error)));
  await expect(resumedPage.getByText('j2code', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(resumedPage.locator('.thread-item')).toHaveCount(1, { timeout: 10_000 });
  const snapshotAfterRestart = await resumedPage.evaluate(() => window.j2code.getSnapshot());
  if (snapshotAfterRestart.projects.length !== 1 || snapshotAfterRestart.threads.length !== 1) {
    throw new Error(`Project/thread did not persist after app restart: ${JSON.stringify(snapshotAfterRestart)}`);
  }
  // Continue assertions against the restarted app and persisted project state.
  const restartedPage = resumedPage;

  const rows = restartedPage.locator('.file-row');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });
  const trackedRow = rows.filter({ hasText: 'tracked.txt' });
  await trackedRow.locator('input[type="checkbox"]').check();
  await restartedPage.getByRole('button', { name: /Commit changes \(1\)/ }).click();
  await restartedPage.getByLabel('Commit message').fill('Smoke selected file only');
  await restartedPage.getByRole('button', { name: 'Commit', exact: true }).click();
  await expect(restartedPage.getByText('Changes committed', { exact: true })).toBeVisible({ timeout: 10_000 });

  const headFiles = git('show', '--pretty=format:', '--name-only', 'HEAD').split('\n').filter(Boolean);
  if (headFiles.length !== 1 || headFiles[0] !== 'tracked.txt') {
    throw new Error(`Commit included unexpected files: ${headFiles.join(', ')}`);
  }
  if (git('status', '--short') !== 'A  unrelated-staged.txt') {
    throw new Error(`Pre-staged unrelated file was changed: ${git('status', '--short')}`);
  }

  if (smokePrompt) {
    const currentProviders = await restartedPage.evaluate(() => window.j2code.discover());
    if (!currentProviders.some(provider => provider.id === 'codex' && provider.available)) {
      throw new Error('J2CODE_SMOKE_PROVIDER=1 requires an available Codex CLI.');
    }
    const thread = (await restartedPage.evaluate(() => window.j2code.getSnapshot())).threads[0];
    const nonce = `J2CODE_CONTEXT_${Date.now().toString(36)}`;
    const promptAndWait = async prompt => {
      await restartedPage.getByRole('textbox', { name: 'Message' }).fill(prompt);
      await restartedPage.getByRole('button', { name: 'Send message' }).click();
      await expect.poll(async () => {
        const state = await restartedPage.evaluate(() => window.j2code.getSnapshot());
        return state.threads.find(item => item.id === thread.id)?.running ?? true;
      }, { timeout: 120_000 }).toBe(false);
    };
    try {
      await promptAndWait(`Reply exactly J2CODE_SMOKE_OK:${nonce}. Do not run tools or modify files.`);
      await expect(restartedPage.locator('.message-assistant').filter({ hasText: nonce })).toBeVisible({ timeout: 10_000 });
      const firstTurn = await restartedPage.evaluate(() => window.j2code.getSnapshot());
      const sessionId = firstTurn.threads.find(item => item.id === thread.id)?.sessionId;
      if (!sessionId) throw new Error('Codex completed its first turn without yielding a resumable session id.');
      await promptAndWait('What was the exact nonce in my prior message? Reply with only that nonce. Do not run tools or modify files.');
      await expect(restartedPage.locator('.message-assistant').last()).toContainText(nonce, { timeout: 10_000 });
      const secondTurn = await restartedPage.evaluate(() => window.j2code.getSnapshot());
      if (secondTurn.threads.find(item => item.id === thread.id)?.sessionId !== sessionId) {
        throw new Error('Codex follow-up did not reuse the same session id.');
      }
      console.log('Provider prompt/resume: live Codex CLI confirmed with same session id and nonce recall (local account auth; no files changed).');
    } catch (error) {
      const safe = String(error).replace(/\b(?:sk|key|token|secret)-[A-Za-z0-9_-]{12,}\b/gi, '[redacted]');
      throw new Error(`Live Codex prompt/resume proof failed: ${safe}`);
    }
  }

  if (screenshotPrefix) {
    await restartedPage.waitForTimeout(5000); // Let success/error toast disappear before review capture.
    await restartedPage.setViewportSize({ width: 1440, height: 900 });
    await restartedPage.screenshot({ path: `${screenshotPrefix}.desktop.png`, fullPage: true, scale: 'css' });
  }
  await restartedPage.setViewportSize({ width: 850, height: 600 });
  if (screenshotPrefix) await restartedPage.screenshot({ path: `${screenshotPrefix}.compact-open.png`, fullPage: true, scale: 'css' });
  await expect(restartedPage.locator('.main-area')).toBeVisible();
  const changesPanel = restartedPage.locator('.changes-panel');
  await expect(changesPanel).toHaveClass(/changes-visible/);
  await restartedPage.locator('.changes-close').click();
  await expect(changesPanel).not.toHaveClass(/changes-visible/);
  if (screenshotPrefix) await restartedPage.screenshot({ path: `${screenshotPrefix}.compact-closed.png`, fullPage: true, scale: 'css' });
  await restartedPage.locator('.changes-toggle').click();
  await expect(changesPanel).toHaveClass(/changes-visible/);
  await restartedPage.locator('.changes-close').click();
  await expect(changesPanel).not.toHaveClass(/changes-visible/);
  await restartedPage.setViewportSize({ width: 430, height: 850 });
  await expect(restartedPage.locator('.main-area')).toBeVisible();
  await expect(changesPanel).not.toHaveClass(/changes-visible/);
  await restartedPage.getByRole('button', { name: /Open sidebar/i }).click();
  await expect(restartedPage.locator('.sidebar')).toHaveClass(/sidebar-open/);
  await restartedPage.getByRole('button', { name: /Close sidebar/i }).last().click();
  if (screenshotPrefix) await restartedPage.screenshot({ path: `${screenshotPrefix}.mobile.png`, fullPage: true, scale: 'css' });

  const persisted = await readFile(path.join(dataDir, 'state.json'), 'utf8');
  if (!JSON.parse(persisted).threads?.length) throw new Error('App state was not persisted to J2CODE_DATA_DIR.');
  if (pageErrors.length) throw new Error(`Renderer errors: ${pageErrors.join('\n')}`);
  console.log(`${packaged ? 'Packaged ' : ''}Electron smoke passed (${process.platform}; data isolated under ${dataDir}).`);
} finally {
  if (app) await app.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}
