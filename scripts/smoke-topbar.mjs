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
 execFileSync('git',['init','-b','feature/current'],{cwd:repo});execFileSync('git',['remote','add','origin','git@github.com:jrmd/vulp.git'],{cwd:repo});
 await writeFile(path.join(home,'models_cache.json'),JSON.stringify({models:[{slug:'summary-luna',display_name:'Summary Luna',visibility:'list'}]}));
 const log=path.join(temp,'summary.json'),prFile=path.join(temp,'pr.json');await writeFile(prFile,'[]');
 const codex=`#!${process.execPath}\nif(process.argv.includes('--version')){console.log('fixture 1');process.exit(0)}let input='';for await(const c of process.stdin)input+=c;const fs=await import('node:fs/promises');await fs.writeFile(${JSON.stringify(log)},JSON.stringify({args:process.argv,cwd:process.cwd(),input}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Fixed the parser; regression tests pass.'}}));`;
 const gh=`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[2]!=='pr'||process.argv[3]!=='list'||process.argv[process.argv.indexOf('--head')+1]!=='feature/original'||process.argv[process.argv.indexOf('--repo')+1]!=='https://github.com/jrmd/vulp')process.exit(2);console.log(fs.readFileSync(${JSON.stringify(prFile)},'utf8'));`;
 for(const [name,code] of [['codex',codex],['gh',gh]]){await writeFile(path.join(bin,name),code);await chmod(path.join(bin,name),0o755)}
 const now=Date.now();await writeFile(path.join(data,'state.json'),JSON.stringify({projects:[{id:'p',name:'Thread workspace',path:repo,createdAt:now}],threads:[{id:'t',projectId:'p',provider:'codex',mode:'read',branch:'feature/original',repository:'https://github.com/jrmd/vulp',branches:['feature/original'],title:'Fix parser',messages:[{id:'m',role:'user',text:'Please fix the parser delimiter.',createdAt:now}],createdAt:now,updatedAt:now},{id:'settled',projectId:'p',provider:'codex',mode:'read',settled:true,summary:'Old migration completed',title:'Database migration',messages:[],createdAt:now,updatedAt:now-1}],disabledProviders:['claude','cursor','opencode']}));
 app=await electron.launch({executablePath:path.join(root,process.env.J2CODE_SMOKE_PACKAGED?'release/linux-unpacked/vulp':'node_modules/.bin/electron'),args:[...(process.env.J2CODE_SMOKE_PACKAGED?[]:[root]),...(process.env.J2CODE_VIRTUAL_DISPLAY?['--ozone-platform=x11','--disable-gpu']:[]),`--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,J2CODE_DATA_DIR:data,CODEX_HOME:home,PATH:`${bin}:${process.env.PATH}`}});
 const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900});await expect(page.locator('.thread-pr')).toHaveCount(0);await expect(page.locator('.topbar .branch-pill')).toHaveCount(0);await expect(page.locator('.topbar button[title="Delete thread"]')).toHaveCount(0);
 await writeFile(prFile,JSON.stringify([{number:42,url:'https://github.com/jrmd/vulp/pull/42',state:'OPEN',title:'Fix parser',headRefName:'feature/original'}]));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByRole('button',{name:'#42 View in GitHub',exact:true})).toBeVisible();
 await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.openedPR=url}});await page.getByRole('button',{name:'#42 View in GitHub',exact:true}).click();expect(await app.evaluate(()=>globalThis.openedPR)).toBe('https://github.com/jrmd/vulp/pull/42');
 await writeFile(prFile,'[]');
 await page.getByRole('button',{name:'Refresh thread PR',exact:true}).click();
 await expect(page.locator('.thread-pr')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Toggle changes',exact:true})).toBeVisible();
 await page.screenshot({path:path.join(root,'artifacts/topbar-thread.png')});
 await page.getByRole('button',{name:'Toggle changes',exact:true}).click();
 await page.getByRole('button',{name:'New thread',exact:true}).click();
 await expect(page.getByRole('button',{name:'Toggle changes',exact:true})).toHaveCount(0);
 await expect(page.getByRole('complementary',{name:'Review changes'})).toHaveCount(0);
 await expect(page.locator('.thread-pr, .topbar .branch-pill')).toHaveCount(0);
 await page.screenshot({path:path.join(root,'artifacts/topbar-new-thread.png')});
 console.log('PASS: no PR placeholder or refresh when absent, actual PR link appears and opens, PR controls disappear when removed, no header branch, Changes only in a conversation. GitHub output is a CLI fixture.');
}finally{if(app)await app.close();await rm(temp,{recursive:true,force:true})}
