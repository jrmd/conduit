import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
delete process.env.ELECTRON_RUN_AS_NODE;
const root = process.cwd(), temp = await mkdtemp(path.join(tmpdir(), 'conduit-model-options-'));
let app;
try {
  for (const dir of ['data', 'repo', 'bin', 'codex']) await mkdir(path.join(temp, dir));
  await writeFile(path.join(temp, 'codex/models_cache.json'), JSON.stringify({models:[{slug:'fixture-model',display_name:'Fixture Model',visibility:'list',supported_reasoning_levels:['low','medium','high','xhigh','max','ultra'].map(effort=>({effort})),context_window:200000,max_context_window:1000000,service_tiers:[{id:'priority'}]}]}));
  const cursorListing = 'Available models\nfixture-low - Fixture Low\nfixture-high - Fixture High\nfixture-high-fast - Fixture High Fast\nfixture-high-1m - Fixture High 1M';
  await writeFile(path.join(temp, 'bin/cursor-agent'), `#!/usr/bin/env node
if(process.argv.includes('--version')) console.log('Cursor fixture');
else if(process.argv.includes('models')) console.log(${JSON.stringify(cursorListing)});
`);
  await chmod(path.join(temp,'bin/cursor-agent'),0o755);
  const now=Date.now();
  await writeFile(path.join(temp,'data/state.json'),JSON.stringify({projects:[{id:'p',name:'Model options',path:path.join(temp,'repo'),createdAt:now}],threads:[{id:'t',projectId:'p',provider:'codex',model:'fixture-model',mode:'supervised',title:'Model settings',messages:[{id:'u',role:'user',text:'Existing conversation',createdAt:now}],createdAt:now,updatedAt:now}]}));
  app=await electron.launch({executablePath:path.join(root,process.env.J2CODE_SMOKE_PACKAGED?'release/linux-unpacked/conduit':'node_modules/.bin/electron'),args:[...(process.env.J2CODE_SMOKE_PACKAGED?[]:[root]),`--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,J2CODE_DATA_DIR:path.join(temp,'data'),CODEX_HOME:path.join(temp,'codex'),PATH:`${path.join(temp,'bin')}:${process.env.PATH}`}});
  const page=await app.firstWindow(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Reasoning effort',exact:true}).click();
  await page.locator('.effort-menu').evaluate(async el => {await Promise.all(el.getAnimations().map(animation=>animation.finished));});
  const initial = await page.locator('.effort-menu').evaluate(el => ({height:el.clientHeight, content:el.scrollHeight, top:el.getBoundingClientRect().top, bottom:el.getBoundingClientRect().bottom}));
  await page.evaluate(() => {
    const menu = document.querySelector('.effort-menu');
    const permission = document.querySelector('.approval-mode-wrap .mode-select');
    const rect = permission.getBoundingClientRect();
    window.menuProbe = {menu, minOpacity:1, detached:false, permission, initialX:rect.x, initialWidth:rect.width, maxShift:0};
    window.menuObserver = new MutationObserver(() => {
      window.menuProbe.detached ||= !menu.isConnected;
      const rect = window.menuProbe.permission.getBoundingClientRect();
      window.menuProbe.maxShift = Math.max(window.menuProbe.maxShift, Math.abs(rect.x-window.menuProbe.initialX), Math.abs(rect.width-window.menuProbe.initialWidth));
      for(const button of menu.querySelectorAll('button')) window.menuProbe.minOpacity = Math.min(window.menuProbe.minOpacity,Number(getComputedStyle(button).opacity));
    });
    window.menuObserver.observe(document.querySelector('.composer-bottom'),{subtree:true,attributes:true,childList:true});
  });
  await page.getByRole('group',{name:'Reasoning level',exact:true}).getByRole('button',{name:'High',exact:true}).click();
  await expect.poll(()=>page.evaluate(async()=>(await window.j2code.getSnapshot()).threads[0].effort)).toBe('high');
  const probe = await page.evaluate(()=>{window.menuObserver.disconnect();return {minOpacity:window.menuProbe.minOpacity,detached:window.menuProbe.detached,maxShift:window.menuProbe.maxShift};});
  console.log(JSON.stringify({initial,probe}));
  expect({unnecessaryScroll:initial.content > initial.height, fadedDuringSave:probe.minOpacity < 1}).toEqual({unnecessaryScroll:false,fadedDuringSave:false});
  expect(probe.detached).toBe(false);
  expect(probe.maxShift, 'Permissions trigger must keep its position and width during option saves').toBeLessThan(0.5);
  await expect(page.locator('.model-controls')).toHaveAttribute('aria-busy','false');
  await page.screenshot({path:path.join(root,'artifacts/model-menu-stable-thread.png')});
  await page.setViewportSize({width:850,height:500});
  await expect.poll(()=>page.locator('.effort-menu').evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(11);
  const compact = await page.locator('.effort-menu').evaluate(el=>({height:el.clientHeight,content:el.scrollHeight,bottom:el.getBoundingClientRect().bottom}));
  expect(compact.content).toBeGreaterThan(compact.height);
  expect(compact.bottom).toBeLessThanOrEqual(500);
  await page.getByRole('group',{name:'Service tier',exact:true}).getByRole('button',{name:'Fast',exact:false}).click();
  await expect.poll(()=>page.evaluate(async()=>(await window.j2code.getSnapshot()).threads[0].fastMode)).toBe(true);
  await page.screenshot({path:path.join(root,'artifacts/model-menu-short-viewport.png')});
  expect(errors).toEqual([]);
} finally {if(app) await app.close(); await rm(temp,{recursive:true,force:true});}
