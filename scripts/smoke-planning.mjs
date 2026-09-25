import {_electron as electron} from 'playwright';
import {expect} from 'playwright/test';
import {mkdtemp,mkdir,copyFile,chmod,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const root=process.cwd(),temp=await mkdtemp(path.join(tmpdir(),'conduit-plan-ui-'));let app;
try {
 const data=path.join(temp,'data'),bin=path.join(temp,'bin');await mkdir(data);await mkdir(bin);
 for(const provider of ['codex','cursor-agent']) {await copyFile('scripts/fixtures/planning-provider.mjs',path.join(bin,provider));await chmod(path.join(bin,provider),0o755);}
 const now=Date.now();await writeFile(path.join(data,'state.json'),JSON.stringify({projects:[{id:'p',name:'Planning checks',path:temp,createdAt:now}],disabledProviders:['claude','opencode','copilot'],threads:[{id:'t',projectId:'p',provider:'codex',mode:'supervised',title:'Plan persistence',messages:[{id:'u',role:'user',text:'Fixture conversation',createdAt:now}],createdAt:now,updatedAt:now}]}));
 app=await electron.launch({executablePath:path.join(root,process.env.J2CODE_SMOKE_PACKAGED?'release/linux-unpacked/conduit':'node_modules/.bin/electron'),args:[...(process.env.J2CODE_SMOKE_PACKAGED?[]:[root]),...(process.env.J2CODE_VIRTUAL_DISPLAY?['--ozone-platform=x11','--disable-gpu']:[]),`--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,J2CODE_DATA_DIR:data,CONDUIT_PROTOCOL_LOG:path.join(temp,'protocol.jsonl')}});
 const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewportSize({width:1440,height:900});
 const toggle=page.getByRole('button',{name:'Plan mode',exact:true});await toggle.click();await expect(toggle).toHaveAttribute('aria-pressed','true');
 const message=page.getByRole('textbox',{name:'Message',exact:true});await message.fill('Plan persistence');await message.press('Enter');
 const question=page.getByRole('form',{name:'Questions from agent'});await expect(question).toBeVisible();await expect(question.getByRole('button',{name:'Submit answers'})).toBeDisabled();
 await page.reload();await expect(question).toBeVisible();await question.getByLabel('SQLite').check();await page.screenshot({path:'artifacts/planning-question.png'});await question.getByRole('button',{name:'Submit answers'}).click();
 const plan=page.getByRole('region',{name:'Implementation plan'});await expect(plan).toContainText('1/2 complete');await expect(toggle).toBeEnabled();await plan.getByText('Handoff brief',{exact:true}).click();await expect(plan).toContainText('Decision: use SQLite');await page.screenshot({path:'artifacts/planning-checklist.png'});
 await plan.getByRole('button',{name:'Start fresh from plan'}).click();await expect(plan).toContainText('Fresh context ready');
 const state=JSON.parse(await readFile(path.join(data,'state.json'),'utf8'));const fresh=state.threads.find(t=>t.sourceThreadId==='t');expect(fresh.sessionId).toBeUndefined();expect(fresh.messages).toEqual([]);expect(fresh.handoff).toContain('Decision: use SQLite');
 await page.evaluate(async id=>{await window.j2code.updateThreadConfig(id,{provider:'cursor',mode:'supervised'});},fresh.id);
 await expect(page.locator('.composer')).toContainText('Cursor');
 await page.setViewportSize({width:430,height:800});await expect.poll(async()=>{const box=await page.locator('.sidebar').boundingBox();return box.x+box.width;}).toBeLessThanOrEqual(0);await page.screenshot({path:'artifacts/planning-mobile.png'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.reload();await expect(plan).toContainText('Fresh context ready');
 await message.fill('Implement the saved plan.');await message.press('Enter');await expect(question).toBeVisible();
 await question.getByLabel('SQLite').check();await question.getByRole('button',{name:'Submit answers'}).click();await expect(question).toBeHidden();
 const records=(await readFile(path.join(temp,'protocol.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 expect(records.some(r=>r.method==='session/new')).toBe(true);expect(records.some(r=>r.method==='session/load')).toBe(false);
 expect(records.find(r=>r.method==='session/prompt').params.prompt[0].text).toContain('Decision: use SQLite');
 expect(errors).toEqual([]);
 console.log('PASS: Plan mode, question reload/answer, saved checklist/brief, fresh session, provider change, restart and mobile. Fixture provider.');
} finally {await app?.close();await rm(temp,{recursive:true,force:true});}
