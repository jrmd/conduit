import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'j2code-model-functional-'));
const dataDir = path.join(tempRoot, 'data');
const projectDir = path.join(tempRoot, 'fixture-project');
const wrapperDir = path.join(tempRoot, 'bin');
const argLog = path.join(tempRoot, 'codex-argv.log');
let app;
const realCodex = execFileSync('which', ['codex'], { encoding: 'utf8' }).trim();

function makeRepo() {
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'J2Code Fixture'], { cwd: projectDir });
  execFileSync('git', ['config', 'user.email', 'j2code-fixture@example.invalid'], { cwd: projectDir });
  execFileSync('git', ['add', '.'], { cwd: projectDir });
  execFileSync('git', ['commit', '-m', 'Fixture baseline'], { cwd: projectDir, stdio: 'ignore' });
}

async function launch(withCodexWrapper = false) {
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules', '.bin', 'electron'),
    args: [root],
    env: {
      ...process.env,
      J2CODE_DATA_DIR: dataDir,
      ...(withCodexWrapper ? { PATH: `${wrapperDir}${path.delimiter}${process.env.PATH}`, J2CODE_REAL_CODEX: realCodex, J2CODE_ARG_LOG: argLog } : {}),
    },
    timeout: 30_000,
  });
  const page = await app.firstWindow();
  await expect(page.getByTestId('model-selector')).toBeVisible({ timeout: 20_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  return page;
}

try {
  await mkdir(dataDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await mkdir(wrapperDir, { recursive: true });
  await writeFile(path.join(wrapperDir, 'codex'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$J2CODE_ARG_LOG"\nexec "$J2CODE_REAL_CODEX" "$@"\n');
  await chmod(path.join(wrapperDir, 'codex'), 0o755);
  await writeFile(path.join(projectDir, 'README.md'), '# Isolated model picker fixture\n');
  makeRepo();
  const now = Date.now();
  const project = { id: 'model-fixture-project', name: 'Fixture: Model Selection', path: projectDir, createdAt: now };
  const threads = [
    { id: 'model-fixture-one', projectId: project.id, title: 'Thread A model persistence', provider: 'codex', mode: 'read', model: undefined, messages: [], createdAt: now, updatedAt: now },
    { id: 'model-fixture-two', projectId: project.id, title: 'Thread B independent model', provider: 'codex', mode: 'read', model: undefined, messages: [], createdAt: now + 1, updatedAt: now + 1 },
  ];
  await writeFile(path.join(dataDir, 'state.json'), JSON.stringify({ projects: [project], threads }, null, 2));

  let page = await launch();
  const catalogue = await page.evaluate(() => window.j2code.getModels('codex'));
  if (!catalogue || catalogue.provider !== 'codex' || !Array.isArray(catalogue.options)) throw new Error('getModels(codex) returned an invalid result');
  if (catalogue.options.some(option => !['discovered', 'alias'].includes(option.source))) throw new Error('Model list contains an unclassified option');
  if (catalogue.options.some(option => /fixture|smoke|test-model/i.test(option.id))) throw new Error('Fixture/test model leaked into the local CLI catalogue');

  let picker = page.getByTestId('model-selector');
  await page.getByRole('button', { name: 'Thread A model persistence' }).click();
  await picker.click();
  await expect(page.getByRole('button', { name: 'CLI default', exact: false })).toBeVisible();
  await expect(page.getByLabel('Search models or enter exact model ID')).toBeVisible();
  await page.getByRole('button', { name: 'CLI default', exact: false }).click();
  await expect.poll(async () => (await page.evaluate(() => window.j2code.getSnapshot())).threads.find(thread => thread.id === 'model-fixture-one')?.model).toBeUndefined();
  const threadA = 'model-fixture-one';
  if (catalogue.options.length) {
    const discovered = catalogue.options[0];
    await picker.click();
    await page.getByRole('button', { name: new RegExp(discovered.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await expect.poll(async () => (await page.evaluate(() => window.j2code.getSnapshot())).threads.find(thread => thread.id === threadA)?.model).toBe(discovered.id);
  }

  const customModel = 'j2code-smoke-custom-exact-id';
  await picker.click();
  const search = page.getByLabel('Search models or enter exact model ID');
  await search.fill(customModel);
  await page.getByRole('button', { name: `Use exact ID: ${customModel}`, exact: false }).click();
  await expect.poll(async () => (await page.evaluate(() => window.j2code.getSnapshot())).threads.find(thread => thread.id === threadA)?.model).toBe(customModel);
  await picker.click();
  await page.getByRole('button', { name: 'CLI default', exact: false }).click();
  await expect.poll(async () => (await page.evaluate(() => window.j2code.getSnapshot())).threads.find(thread => thread.id === threadA)?.model).toBeUndefined();
  await picker.click();
  const restoreSearch = page.getByLabel('Search models or enter exact model ID');
  await restoreSearch.fill(customModel);
  await page.getByRole('button', { name: `Use exact ID: ${customModel}`, exact: false }).click();
  await expect.poll(async () => (await page.evaluate(() => window.j2code.getSnapshot())).threads.find(thread => thread.id === threadA)?.model).toBe(customModel);

  const threadB = 'model-fixture-two';
  await page.getByRole('button', { name: 'Thread B independent model' }).click();
  await expect.poll(async () => await picker.innerText()).toContain('CLI default');
  if (catalogue.options.length) {
    const other = catalogue.options.find(option => option.id !== customModel) ?? catalogue.options[0];
    await picker.click();
    await page.getByRole('button', { name: new RegExp(other.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await expect.poll(async () => (await page.evaluate(() => window.j2code.getSnapshot())).threads.find(thread => thread.id === threadB)?.model).toBe(other.id);
  }

  await app.close();
  app = undefined;
  page = await launch(true);
  picker = page.getByTestId('model-selector');
  const restored = await page.evaluate(() => window.j2code.getSnapshot());
  const restoredA = restored.threads.find(thread => thread.id === threadA);
  const restoredB = restored.threads.find(thread => thread.id === threadB);
  expect(restoredA?.model).toBe(customModel);
  if (catalogue.options.length) expect(restoredB?.model).toBe(catalogue.options.find(option => option.id !== customModel)?.id ?? catalogue.options[0].id);
  await page.getByRole('button', { name: 'Thread A model persistence' }).click();
  await expect.poll(async () => await page.getByTestId('model-selector').innerText()).toContain(customModel);

  // Exercise one benign, authenticated local Codex turn and a same-session follow-up.
  // The wrapper delegates to the real installed CLI and records argv only, proving the selected model reaches new and resumed invocations.
  const liveThreadId = 'model-fixture-one';
  const nonce = `J2CODE_MODEL_CONTEXT_${Date.now().toString(36)}`;
  const selectModel = async modelId => {
    await picker.click();
    const option = catalogue.options.find(item => item.id === modelId);
    if (option) {
      await page.getByRole('button', { name: new RegExp(option.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    } else {
      const input = page.getByLabel('Search models or enter exact model ID');
      await input.fill(modelId);
      await page.getByRole('button', { name: `Use exact ID: ${modelId}`, exact: false }).click();
    }
    await expect.poll(async () => (await page.evaluate(() => window.j2code.getSnapshot())).threads.find(thread => thread.id === liveThreadId)?.model).toBe(modelId);
  };
  await selectModel('gpt-6-sol');
  await page.getByRole('textbox', { name: 'Message' }).fill(`Reply exactly J2CODE_MODEL_SMOKE_OK:${nonce}. Do not run tools or modify files.`);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(async () => (await page.evaluate(() => window.j2code.getSnapshot())).threads.find(thread => thread.id === liveThreadId)?.running ?? false, { timeout: 120_000 }).toBe(true);
  await expect(picker).toBeDisabled();
  await expect.poll(async () => (await page.evaluate(() => window.j2code.getSnapshot())).threads.find(thread => thread.id === liveThreadId)?.running ?? true, { timeout: 120_000 }).toBe(false);
  await expect(page.locator('.message-assistant').filter({ hasText: nonce })).toBeVisible({ timeout: 10_000 });
  const firstTurn = await page.evaluate(() => window.j2code.getSnapshot());
  const sessionId = firstTurn.threads.find(thread => thread.id === liveThreadId)?.sessionId;
  if (!sessionId) throw new Error('Codex response did not save a resumable session ID');

  await selectModel('gpt-6-luna');
  await page.getByRole('textbox', { name: 'Message' }).fill('What was the exact nonce in my prior message? Reply with only that nonce. Do not run tools or modify files.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.j2code.getSnapshot());
    const thread = state.threads.find(item => item.id === liveThreadId);
    return Boolean(thread?.running && thread.messages.filter(message => message.role === 'user').length === 2);
  }, { timeout: 30_000 }).toBe(true);
  await expect(picker).toBeDisabled();
  await expect.poll(async () => (await page.evaluate(() => window.j2code.getSnapshot())).threads.find(thread => thread.id === liveThreadId)?.running ?? true, { timeout: 120_000 }).toBe(false);
  const secondTurn = await page.evaluate(() => window.j2code.getSnapshot());
  const assistantReplies = secondTurn.threads.find(thread => thread.id === liveThreadId)?.messages.filter(message => message.role === 'assistant') ?? [];
  expect(assistantReplies).toHaveLength(2);
  expect(assistantReplies.at(-1)?.text.trim()).toBe(nonce);
  await expect(page.locator('.message-assistant').last()).toContainText(nonce, { timeout: 10_000 });
  if (secondTurn.threads.find(thread => thread.id === liveThreadId)?.sessionId !== sessionId) throw new Error('Codex follow-up did not resume the same session');
  const args = await readFile(argLog, 'utf8');
  const newInvocation = args.split('\n').find(line => line.startsWith('exec --json '));
  const resumeInvocation = args.split('\n').find(line => line.startsWith('exec resume --json '));
  if (!newInvocation?.includes('--model gpt-6-sol')) throw new Error('Real Codex new-thread invocation omitted --model gpt-6-sol');
  if (!resumeInvocation?.includes('--model gpt-6-luna')) throw new Error('Real Codex resume invocation omitted --model gpt-6-luna');
  await page.screenshot({ path: path.join(root, 'artifacts', 'model-picker-functional-1440.png'), fullPage: true, scale: 'css' });
  await page.setViewportSize({ width: 850, height: 600 });
  await page.getByRole('button', { name: 'Toggle changes' }).click().catch(() => {});
  await expect(page.getByTestId('model-selector')).toBeVisible();
  await page.screenshot({ path: path.join(root, 'artifacts', 'model-picker-functional-850.png'), fullPage: true, scale: 'css' });

  console.log(JSON.stringify({
    result: 'passed',
    catalogueCount: catalogue.options.length,
    catalogueSources: [...new Set(catalogue.options.map(option => option.source))],
    discoveredSelection: catalogue.options[0]?.id ?? 'skipped: CLI returned no options',
    customIdPersistedAcrossRestart: restoredA.model === customModel,
    threadBModelPersistedAcrossRestart: restoredB.model ?? 'CLI default',
    liveCodex: { firstModel: 'gpt-6-sol', resumeModel: 'gpt-6-luna', sameSession: true, runningDisabledPicker: true, nonceRecall: true, argvVerified: true },
    screenshots: ['artifacts/model-picker-functional-1440.png', 'artifacts/model-picker-functional-850.png'],
    providerTurns: 2,
  }, null, 2));
} finally {
  if (app) await app.close().catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}
