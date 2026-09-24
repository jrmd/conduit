import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp,mkdir,writeFile,chmod,readFile,rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
const root=process.cwd(),temp=await mkdtemp(path.join(tmpdir(),'vulp-composer-'));
const data=path.join(temp,'data'),repo=path.join(temp,'repo'),bin=path.join(temp,'bin'),home=path.join(temp,'codex'),log=path.join(temp,'calls.jsonl');let app;
try {
 for(const dir of [data,repo,bin,home])await mkdir(dir);
 execFileSync('git',['init','-q'],{cwd:repo});
 await writeFile(path.join(repo,'hello world.ts'),'export {};');
 await mkdir(path.join(repo,'.agents/skills/review-fixture'),{recursive:true});
 await writeFile(path.join(repo,'.agents/skills/review-fixture/SKILL.md'),'---\nname: review-fixture\ndescription: Review the test project\n---\nReview code.');
 await writeFile(path.join(home,'models_cache.json'),JSON.stringify({models:[{slug:'title-luna',display_name:'Title Luna',visibility:'list'}]}));
 const cli=`#!${process.execPath}
if(process.argv.includes('--version')){console.log('fixture');process.exit(0)}
if(process.argv.includes('plugin')){console.log(JSON.stringify({installed:[{name:'fixture-plugin',enabled:true,installed:true},{name:'disabled-plugin',enabled:false,installed:true}]}));process.exit(0)}
let input='';for await(const c of process.stdin)input+=c;
const fs=await import('node:fs/promises');await fs.appendFile(${JSON.stringify(log)},JSON.stringify({cwd:process.cwd(),args:process.argv,input})+'\\n');
const title=process.cwd().includes('vulp-title-');
if(title)await new Promise(resolve=>setTimeout(resolve,400));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:title?'Review project context':'Completed fixture response'}}));`;
 await writeFile(path.join(bin,'codex'),cli);await chmod(path.join(bin,'codex'),0o755);
 const now=Date.now();await writeFile(path.join(data,'state.json'),JSON.stringify({projects:[{id:'p',name:'Composer workspace',path:repo,createdAt:now}],threads:[],disabledProviders:['claude','cursor','opencode']}));
 app=await electron.launch({executablePath:path.join(root,process.env.J2CODE_SMOKE_PACKAGED?'release/linux-unpacked/vulp':'node_modules/.bin/electron'),args:[...(process.env.J2CODE_SMOKE_PACKAGED?[]:[root]),'--ozone-platform=x11','--disable-gpu',`--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,J2CODE_DATA_DIR:data,CODEX_HOME:home,PATH:`${bin}:${process.env.PATH}`}});
 const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Agent settings',exact:true}).click();
 await page.getByRole('button',{name:'Dark',exact:true}).click();
 await page.getByLabel('Title provider',{exact:true}).selectOption('codex');await page.getByLabel('Title model',{exact:true}).selectOption('title-luna');
 await page.getByRole('button',{name:'Back to chat',exact:true}).click();
 const input=page.getByLabel('Message',{exact:true});await input.fill('Review @hello');
 await expect(page.getByRole('option',{name:/hello world/})).toBeVisible();
 await page.screenshot({path:path.join(root,'artifacts/vulp-file-autocomplete.png')});
 await input.press('Enter');await expect(input).toHaveValue('Review @"hello world.ts" ');
 expect((await page.evaluate(()=>window.j2code.getSnapshot())).threads).toHaveLength(0);
 await input.pressSequentially('/review-fixture');await expect(page.getByRole('option',{name:/review-fixture/})).toBeVisible();await input.press('Tab');
 await expect(input).toHaveValue('Review @"hello world.ts" $review-fixture ');
 await input.press('End');await input.pressSequentially('/fixture-plugin');await expect(page.getByRole('option',{name:/fixture-plugin/})).toBeVisible();
 await page.screenshot({path:path.join(root,'artifacts/vulp-skill-autocomplete.png')});await input.press('Enter');
 await input.press('Enter');
 await expect(page.locator('.thread-item-title')).toHaveText('Review project context');
 const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
 expect(calls).toHaveLength(2);const title=calls.find(call=>call.cwd!==repo),run=calls.find(call=>call.cwd===repo);
 expect(title.args).toContain('title-luna');expect(run.input).toContain('Referenced project file: "hello world.ts"');expect(run.input).toContain('Explicitly selected skill "review-fixture"');expect(run.input).toContain('Explicitly selected enabled plugin: "fixture-plugin"');
 const state=await page.evaluate(()=>window.j2code.getSnapshot());expect(state.threads[0].messages[0].text).not.toContain('Selected context:');
 await input.fill('Follow up');await input.press('Enter');await expect(input).toBeEnabled();
 expect((await readFile(log,'utf8')).trim().split('\n')).toHaveLength(3);
 await input.fill('@hello');await expect(page.getByRole('listbox')).toBeVisible();await input.press('Escape');await expect(page.getByRole('listbox')).toHaveCount(0);
 await page.evaluate(()=>{localStorage.setItem('vulp.appearance','light')});
 await page.getByRole('button',{name:'Agent settings',exact:true}).click();await page.getByRole('button',{name:'Light',exact:true}).click();await page.getByRole('button',{name:'Back to chat',exact:true}).click();
 await input.fill('@hell');await expect(page.getByRole('option',{name:/hello world/})).toBeVisible();await page.setViewportSize({width:850,height:700});await page.screenshot({path:path.join(root,'artifacts/vulp-autocomplete-light.png')});
 console.log('PASS: first-message title with selected model, once only; file/skill/plugin autocomplete, keyboard selection, real IPC context expansion, light and narrow layout. Provider outputs are fixtures.');
} catch(error) {console.error(error);throw error;} finally {if(app)await app.close();await rm(temp,{recursive:true,force:true});}
