import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp,mkdir,writeFile,chmod,readFile,rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
const root=process.cwd(),temp=await mkdtemp(path.join(tmpdir(),'vulp-threads-'));
const data=path.join(temp,'data'),repo=path.join(temp,'repo'),bin=path.join(temp,'bin'),home=path.join(temp,'codex');let app;
try{
 for(const p of [data,repo,bin,home])await mkdir(p);
 execFileSync('git',['init','-b','feature/current'],{cwd:repo});execFileSync('git',['remote','add','origin','git@github.com:jrmd/conduit.git'],{cwd:repo});
 await writeFile(path.join(home,'models_cache.json'),JSON.stringify({models:[{slug:'summary-luna',display_name:'Summary Luna',visibility:'list'}]}));
 const log=path.join(temp,'summary.json'),prFile=path.join(temp,'pr.json');await writeFile(prFile,'[]');
 const codex=`#!${process.execPath}\nif(process.argv.includes('--version')){console.log('fixture 1');process.exit(0)}if(process.argv.includes('app-server')){const {createInterface}=await import('node:readline');const send=m=>console.log(JSON.stringify({jsonrpc:'2.0',...m}));createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{thread:{id:'fixture-session'}}});else if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'fixture-turn'}}});send({method:'item/agentMessage/delta',params:{delta:'Fixture complete'}});send({method:'turn/completed',params:{turn:{status:'completed'}}});}else send({id:m.id,result:{}});});}else{let input='';for await(const c of process.stdin)input+=c;const fs=await import('node:fs/promises');await fs.writeFile(${JSON.stringify(log)},JSON.stringify({args:process.argv,cwd:process.cwd(),input}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Fixed the parser; regression tests pass.'}}));}`;
 const gh=`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]!=='pr'||process.argv[3]!=='list'||process.argv[process.argv.indexOf('--head')+1]!=='feature/original'||process.argv[process.argv.indexOf('--repo')+1]!=='https://github.com/jrmd/conduit')process.exit(2);console.log(fs.readFileSync(${JSON.stringify(prFile)},'utf8'));`;
 for(const [name,code] of [['codex',codex],['gh',gh]]){await writeFile(path.join(bin,name),code);await chmod(path.join(bin,name),0o755)}
 const now=Date.now();await writeFile(path.join(data,'state.json'),JSON.stringify({projects:[{id:'p',name:'Thread workspace',path:repo,createdAt:now}],threads:[{id:'t',projectId:'p',provider:'codex',mode:'read',branch:'feature/original',repository:'https://github.com/jrmd/conduit',branches:['feature/original'],title:'Fix parser',messages:[{id:'m',role:'user',text:'Please fix the parser delimiter.',createdAt:now}],createdAt:now,updatedAt:now},{id:'settled',projectId:'p',provider:'codex',mode:'read',settled:true,summary:'Old migration completed',title:'Database migration',messages:[],createdAt:now,updatedAt:now-1}],disabledProviders:['claude','cursor','opencode']}));
 app=await electron.launch({executablePath:path.join(root,process.env.J2CODE_SMOKE_PACKAGED?'release/linux-unpacked/conduit':'node_modules/.bin/electron'),args:[...(process.env.J2CODE_SMOKE_PACKAGED?[]:[root]),...(process.env.J2CODE_VIRTUAL_DISPLAY?['--ozone-platform=x11','--disable-gpu']:[]),`--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,J2CODE_DATA_DIR:data,CODEX_HOME:home,PATH:`${bin}:${process.env.PATH}`}});
 const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900});await expect(page.locator('.thread-pr')).toHaveCount(0);await expect(page.locator('.topbar .branch-pill')).toHaveCount(0);await expect(page.locator('.topbar button[title="Delete thread"]')).toHaveCount(0);
 await writeFile(prFile,JSON.stringify([{number:42,url:'https://github.com/jrmd/conduit/pull/42',state:'OPEN',title:'Fix parser',headRefName:'feature/original'}]));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('button',{name:'#42 View in GitHub',exact:true})).toBeVisible();
 await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.openedPR=url}});await page.getByRole('button',{name:'#42 View in GitHub',exact:true}).click();expect(await app.evaluate(()=>globalThis.openedPR)).toBe('https://github.com/jrmd/conduit/pull/42');
 await page.getByRole('button',{name:'Agent settings',exact:true}).click();await page.getByRole('tab',{name:'Thread titles',exact:true}).click();await page.getByLabel('Title provider',{exact:true}).selectOption('codex');await page.getByLabel('Title model',{exact:true}).selectOption('summary-luna');await page.getByRole('button',{name:'Back to chat',exact:true}).click();
 await page.locator('.thread-item').filter({hasText:'Fix parser'}).click({button:'right'});await page.getByRole('menuitem',{name:'Regenerate title',exact:true}).click();await expect(page.locator('.thread-item-title').filter({hasText:'Fixed the parser; regression tests pass.'})).toHaveCount(1);
 const invocation=JSON.parse(await readFile(log,'utf8'));expect(invocation.args).toContain('summary-luna');expect(invocation.cwd).not.toBe(repo);expect(invocation.input).toContain('Please fix the parser delimiter.');expect((await page.evaluate(()=>window.j2code.getSnapshot())).threads.find(t=>t.id==='t').messages).toHaveLength(1);
 await page.getByRole('button',{name:'Settle Fixed the parser; regression tests pass.',exact:true}).focus();await page.getByRole('button',{name:'Settle Fixed the parser; regression tests pass.',exact:true}).click();await expect(page.locator('.thread-item')).toHaveCount(0);
 await page.getByRole('button',{name:/^Settled/}).click();await expect(page.locator('.thread-item')).toHaveCount(2);
 await page.getByLabel('Search threads',{exact:true}).fill('delimiter');await expect(page.locator('.thread-item')).toHaveCount(1);await page.getByLabel('Clear thread search').click();
 await page.getByRole('button',{name:'Restore Fixed the parser; regression tests pass.',exact:true}).focus();await page.getByRole('button',{name:'Restore Fixed the parser; regression tests pass.',exact:true}).click();await page.getByRole('button',{name:/^Settled/}).click();await expect(page.locator('.thread-item')).toHaveCount(1);
 await page.screenshot({path:path.join(root,'artifacts','vulp-thread-metadata.png')});
 // New threads pin their own creation branch, independently from older threads.
 const created=await page.evaluate(()=>window.j2code.createThread('p','codex','read'));expect(created.branch).toBe('feature/current');expect(created.repository).toBe('https://github.com/jrmd/conduit');
 await page.evaluate(()=>window.j2code.send('t','Record a run on the current branch'));
 await expect.poll(async()=> (await page.evaluate(()=>window.j2code.getSnapshot())).threads.find(t=>t.id==='t').running).toBe(false);
 expect((await page.evaluate(()=>window.j2code.getSnapshot())).threads.find(t=>t.id==='t').branches.at(-1)).toBe('feature/current');
 execFileSync('git',['symbolic-ref','HEAD','refs/heads/feature/original'],{cwd:repo});
 await page.evaluate(()=>window.j2code.send('t','Record a run back on the original branch'));
 await expect.poll(async()=> (await page.evaluate(()=>window.j2code.getSnapshot())).threads.find(t=>t.id==='t').running).toBe(false);
 const history=(await page.evaluate(()=>window.j2code.getSnapshot())).threads.find(t=>t.id==='t');expect(history.branches.at(-1)).toBe('feature/original');expect(history.branch).toBe('feature/original');
 await page.reload();await expect(page.locator('.thread-item-title').filter({hasText:'Fixed the parser; regression tests pass.'})).toHaveCount(1);
 await page.getByRole('button',{name:'Agent settings',exact:true}).click();await page.getByRole('tab',{name:'Thread titles',exact:true}).click();await expect(page.getByLabel('Title model',{exact:true})).toHaveValue('summary-luna');
 console.log('PASS: original-branch gh lookup and PR appearance, external URL, chosen CLI summary with isolated session, metadata capture, search across settled conversations, settle/restore, preference persistence. GitHub and summary output were CLI replay fixtures.');
}finally{if(app)await app.close();await rm(temp,{recursive:true,force:true})}
