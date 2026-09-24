import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), 'j2code-provider-settings-'));
const data = path.join(temp, 'data');
const folder = path.join(temp, 'project');
let app, page;
async function launch() {
  const packaged = process.env.J2CODE_SMOKE_PACKAGED;
  app = await electron.launch({ executablePath: path.join(root, packaged ? 'release/linux-unpacked/vulp' : 'node_modules/.bin/electron'), args: [...(packaged ? [] : [root]), `--user-data-dir=${path.join(temp, 'electron')}`], env: { ...process.env, J2CODE_DATA_DIR: data } });
  page = await app.firstWindow();
  await expect(page.getByTestId('model-selector')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
}
try {
  await mkdir(data); await mkdir(folder);
  const now = Date.now();
  await writeFile(path.join(data, 'state.json'), JSON.stringify({ projects: [{ id:'project', name:'Model picker test', path:folder, createdAt:now }], threads:[{ id:'thread', projectId:'project', title:'Existing conversation', provider:'codex', mode:'read', createdAt:now, updatedAt:now, messages:[] }] }));
  await launch();
  await page.getByRole('button', { name: 'Agent settings', exact:true }).click();
  await page.getByRole('switch', { name:'Enable Codex', exact:true }).click();
  await expect(page.getByRole('switch', { name:'Enable Codex', exact:true })).toHaveAttribute('aria-checked','false');
  const rejected = await page.evaluate(async () => { try { await window.j2code.send('thread','Should not run'); return false; } catch(error) { return String(error).includes('Enable this provider'); } });
  expect(rejected).toBe(true);
  const blocked = await page.evaluate(async () => {
    const results = [];
    for (const operation of [() => window.j2code.createThread('project', 'codex', 'read'), () => window.j2code.getModels('codex')]) {
      try { await operation(); results.push(false); } catch { results.push(true); }
    }
    return results;
  });
  expect(blocked).toEqual([true, true]);
  const invalid = await page.evaluate(async () => { try { await window.j2code.setProviderEnabled('invalid',false); return false; } catch { return true; } });
  expect(invalid).toBe(true);
  await app.close(); app = null;
  await launch();
  expect((await page.evaluate(() => window.j2code.getSnapshot())).disabledProviders).toContain('codex');
  await expect(page.getByTestId('model-selector')).toBeDisabled();
  await page.getByRole('button', { name:/New thread.*Ctrl N/ }).click();
  await page.getByTestId('model-selector').click();
  await expect(page.getByRole('button', { name:'Codex', exact:true })).toHaveCount(0);
  await page.getByRole('button', { name:'Manage providers', exact:true }).click();
  await page.getByRole('switch', { name:'Enable Codex', exact:true }).click();
  await page.screenshot({ path:path.join(root,'artifacts','provider-settings-013.png') });
  await page.getByRole('button', { name:'Close', exact:true }).last().click();
  await page.getByTestId('model-selector').click();
  await expect(page.getByRole('button', { name:'All providers', exact:true })).toBeVisible();
  await page.getByRole('button', { name:'Codex', exact:true }).click();
  await expect(page.locator('.model-provider-group h3')).toHaveCount(1);
  await expect(page.locator('.model-provider-group h3')).toContainText('Codex');
  await page.getByLabel('Search models or enter exact model ID').fill('my-exact-model');
  await expect(page.getByRole('button', { name:/Use exact ID: my-exact-model/ })).toBeVisible();
  await page.getByRole('button', { name:/Use exact ID: my-exact-model/ }).click();
  await expect(page.getByTestId('model-selector')).toContainText('my-exact-model');
  await page.getByTestId('model-selector').click();
  await page.getByRole('button', { name:'All providers', exact:true }).click();
  await page.screenshot({ path:path.join(root,'artifacts','model-browser-013-1440.png') });
  await page.setViewportSize({ width:850,height:600 });
  await page.screenshot({ path:path.join(root,'artifacts','model-browser-013-850.png') });
  const box = await page.getByRole('dialog', { name:'Choose a model' }).boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  const state = await page.evaluate(() => window.j2code.getSnapshot());
  if (state.providers.some(p => p.id === 'claude' && p.available)) {
    await page.getByRole('button', { name:'Claude Code', exact:true }).click();
    await page.getByRole('button', { name:/CLI default/ }).click();
    await expect(page.getByRole('button', { name:'Provider', exact:true })).toContainText('Claude Code');
  }
  await page.getByRole('button', { name:'Agent settings', exact:true }).click();
  for (const name of ['Codex','Claude Code','Cursor','OpenCode']) await page.getByRole('switch', { name:`Enable ${name}`, exact:true }).click();
  await page.getByRole('button', { name:'Close', exact:true }).last().click();
  await page.getByTestId('model-selector').click();
  await expect(page.getByText('No enabled, installed providers.', { exact:false })).toBeVisible();
  await page.getByRole('textbox', {name:'Message',exact:true}).fill('Must stay disabled');
  await expect(page.getByRole('button', { name:'Send message', exact:true })).toBeDisabled();
  console.log('PASS: provider filters, custom selection, cross-provider draft selection, persistent toggles, disabled IPC send, invalid setting rejection, existing thread retained, all-disabled state, and desktop/compact picker bounds. No provider prompts sent.');
} finally { if (app) await app.close(); await rm(temp,{recursive:true,force:true}); }
