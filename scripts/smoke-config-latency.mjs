import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

delete process.env.ELECTRON_RUN_AS_NODE;
const root = process.cwd(), temp = await mkdtemp(path.join(tmpdir(), 'conduit-config-latency-'));
let app;
try {
  for (const dir of ['data', 'repo', 'bin']) await mkdir(path.join(temp, dir));
  const log = path.join(temp, 'discovery-calls');
  const frame = {type:'control_response',response:{subtype:'success',request_id:'j2code-model-capabilities',response:{models:[{value:'fixture',displayName:'Fixture',supportsEffort:true,supportedEffortLevels:['low','high'],supportsFastMode:true}]}}};
  await writeFile(path.join(temp, 'bin/claude'), `#!/usr/bin/env node
if (process.argv.includes('--version')) console.log('Claude fixture');
else { require('node:fs').appendFileSync(${JSON.stringify(log)}, 'call\\n'); setTimeout(() => console.log(${JSON.stringify(JSON.stringify(frame))}), 500); }
`);
  await chmod(path.join(temp, 'bin/claude'), 0o755);
  const now = Date.now();
  await writeFile(path.join(temp, 'data/state.json'), JSON.stringify({projects:[{id:'p',name:'Latency',path:path.join(temp,'repo'),createdAt:now}],threads:[{id:'t',projectId:'p',provider:'claude',sessionId:'existing-session',model:'fixture',effort:'low',fastMode:false,mode:'supervised',title:'Existing thread',messages:[{id:'m',role:'user',text:'Existing conversation',createdAt:now}],createdAt:now,updatedAt:now}],disabledProviders:['codex','cursor','opencode','copilot']}));
  app = await electron.launch({executablePath:path.join(root,process.env.J2CODE_SMOKE_PACKAGED ? 'release/linux-unpacked/conduit' : 'node_modules/.bin/electron'),args:[...(process.env.J2CODE_SMOKE_PACKAGED ? [] : [root]), `--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,J2CODE_DATA_DIR:path.join(temp,'data'),PATH:`${path.join(temp,'bin')}${path.delimiter}${process.env.PATH}`}});
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', {name:'Reasoning effort',exact:true}).click();
  const high = page.getByRole('group', {name:'Reasoning level',exact:true}).getByRole('button', {name:'High',exact:true});
  await expect(high).toBeVisible();
  const before = await readFile(log, 'utf8');
  const started = performance.now();
  await high.click();
  await expect(high).toHaveAttribute('aria-pressed','true');
  const effortMs = Math.round(performance.now() - started);
  await page.getByRole('button', {name:'Approval mode',exact:true}).click();
  const permissionStarted = performance.now();
  await page.getByRole('button', {name:/^Full access Allow tools/}).click();
  await expect(page.getByRole('button', {name:'Approval mode',exact:true})).toContainText('Full access');
  const permissionMs = Math.round(performance.now() - permissionStarted);
  expect(await readFile(log, 'utf8')).toBe(before);
  const thread = await page.evaluate(async () => (await window.j2code.getSnapshot()).threads[0]);
  expect([thread.effort,thread.mode,thread.sessionId]).toEqual(['high','full-access','existing-session']);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({result:'PASS',effortMs,permissionMs,additionalClaudeProcesses:0}));
} finally { if (app) await app.close(); await rm(temp, {recursive:true,force:true}); }
