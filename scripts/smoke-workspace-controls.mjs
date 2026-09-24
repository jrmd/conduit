import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root=process.cwd(), temp=await mkdtemp(path.join(tmpdir(),'j2code-controls-'));
const data=path.join(temp,'data'), folder=path.join(temp,'project'), bin=path.join(temp,'bin'), home=path.join(temp,'codex');
const reply = 'Fixture: the answer is 437.\n\n## Verification\n\nThe command completed and the reviewer confirmed the result.\n\n- Preserve the current project.\n- Keep the original input.\n\n```typescript\nconst result = 19 * 23;\nconsole.log(result);\n```\n\n| Check | Result |\n| --- | --- |\n| Arithmetic | Passed |\n| Review | Passed |';
let app,page;
async function launch(){
 const packaged=process.env.J2CODE_SMOKE_PACKAGED;
 app=await electron.launch({executablePath:path.join(root,packaged?'release/linux-unpacked/vulp':'node_modules/.bin/electron'),args:[...(packaged?[]:[root]),`--user-data-dir=${path.join(temp,'electron')}`],env:{...process.env,J2CODE_DATA_DIR:data,CODEX_HOME:home,PATH:`${bin}:${process.env.PATH}`}});
 page=await app.firstWindow();await expect(page.getByTestId('model-selector')).toBeVisible();await page.setViewportSize({width:1440,height:900});
}
async function model(id){await page.getByTestId('model-selector').click();await page.getByRole('tab',{name:'Codex',exact:true}).click();await page.getByRole('button',{name:new RegExp(`^${id} ${id}$`)}).click();}
try{
 for(const dir of [data,folder,bin,home])await mkdir(dir);
 await writeFile(path.join(home,'models_cache.json'),JSON.stringify({models:[{slug:'test-sol',display_name:'test-sol',visibility:'list',supported_reasoning_levels:['low','medium','high','xhigh','max','ultra'].map(effort=>({effort}))},{slug:'test-luna',display_name:'test-luna',visibility:'list',supported_reasoning_levels:['low','medium','high','max'].map(effort=>({effort}))}]}));
 const fixture=`#!${process.execPath}
if(process.argv.includes('--version')) {console.log('fixture-cli 1.0');process.exit(0)}
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
if(process.argv.includes('--input-format')) {console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:'j2code-model-capabilities',response:{models:[{value:'sonnet',displayName:'Sonnet',supportsEffort:true,supportedEffortLevels:['low','medium','high','max']}]}}}));process.exit(0)}
const emit=value=>console.log(JSON.stringify(value));
const fs=await import('node:fs/promises');const path=await import('node:path');
const rootId='11111111-1111-4111-8111-111111111111',childId='22222222-2222-4222-8222-222222222222';
const logDir=path.join(process.env.CODEX_HOME,'sessions',...new Date().toISOString().slice(0,10).split('-'));
await fs.mkdir(logDir,{recursive:true});
const rootFile=path.join(logDir,'rollout-'+rootId+'.jsonl'),childFile=path.join(logDir,'rollout-'+childId+'.jsonl');
const item=value=>JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type:'item_completed',item:value}})+'\\n';
await fs.writeFile(rootFile,item({type:'SubAgentActivity',agent_thread_id:childId,agent_path:'/root/fixture-reviewer',kind:'started'}));
await fs.writeFile(childFile,'');
emit({type:'thread.started',thread_id:rootId});
emit({type:'item.started',item:{id:'r',type:'reasoning',text:'Fixture: checking the multiplication.'}});
emit({type:'item.completed',item:{id:'r',type:'reasoning',text:'Fixture: checking the multiplication.'}});
emit({type:'item.started',item:{id:'c',type:'command_execution',command:'node arithmetic-check',status:'in_progress'}});
emit({type:'item.started',item:{id:'w',type:'collab_tool_call',tool:'wait',receiver_thread_ids:[],agents_states:{},status:'in_progress'}});
await new Promise(resolve=>setTimeout(resolve,prompt.includes('cancel')?30000:2500));
emit({type:'item.completed',item:{id:'c',type:'command_execution',command:'node arithmetic-check',aggregated_output:'437',exit_code:0,status:'completed'}});
await fs.appendFile(childFile,item({type:'AgentMessage',id:'reply',phase:'final_answer',content:[{type:'Text',text:'Fixture: verified 437'}]}));
await fs.appendFile(rootFile,item({type:'SubAgentActivity',agent_thread_id:childId,agent_path:'/root/fixture-reviewer',kind:'completed'}));
emit({type:'item.completed',item:{id:'w',type:'collab_tool_call',tool:'wait',receiver_thread_ids:[],agents_states:{},status:'completed'}});
emit({type:'item.completed',item:{id:'a',type:'agent_message',text:'Fixture: the answer is 437.'}});
emit({type:'item.completed',item:{id:'b',type:'agent_message',text:${JSON.stringify(reply.split('\n\n').slice(1).join('\n\n'))}}});
emit({type:'turn.completed'});
`;
 for(const name of ['codex','claude']){await writeFile(path.join(bin,name),fixture);await chmod(path.join(bin,name),0o755)}
 const now=Date.now();await writeFile(path.join(data,'state.json'),JSON.stringify({projects:[{id:'p',name:'Fixture workspace',path:folder,createdAt:now},{id:'p2',name:'Second project',path:folder,createdAt:now}],threads:[{id:'t',projectId:'p',provider:'codex',mode:'read',title:'Empty saved thread',messages:[],createdAt:now,updatedAt:now}],disabledProviders:['cursor','opencode']}));
 await launch();
 await expect(page).toHaveTitle('Vulp');
 const appInfo=await page.evaluate(()=>window.j2code.getAppInfo());
 await expect(page.locator('.app-version')).toHaveText(`v${appInfo.version}`);
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Keep this draft');
 await page.getByRole('button',{name:'Agent settings',exact:true}).click();
 await expect(page.getByRole('region',{name:'Settings',exact:true})).toBeVisible();
 await expect(page.locator('.modal-backdrop')).toHaveCount(0);
 await expect(page.getByRole('switch',{name:'Enable Codex',exact:true})).toBeChecked();
 await page.getByRole('switch',{name:'Enable Cursor',exact:true}).click();
 await expect(page.getByRole('switch',{name:'Enable Cursor',exact:true})).toBeChecked();
 await page.getByRole('switch',{name:'Enable Cursor',exact:true}).click();
 await page.screenshot({path:path.join(root,'artifacts','vulp-settings-screen.png')});

 await page.setViewportSize({width:850,height:600});
 await page.getByRole('button',{name:'Refresh discovery',exact:true}).scrollIntoViewIfNeeded();
 await expect(page.getByRole('button',{name:'Refresh discovery',exact:true})).toBeVisible();
 expect(await page.locator('.settings-screen').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:path.join(root,'artifacts','vulp-settings-850.png')});
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Back to chat',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Keep this draft');
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('');


 // Check Mac CSS clearance only. Native traffic lights/dragging need macOS.
 await page.locator('.app-shell').evaluate(el=>el.classList.add('platform-darwin'));
 const brandBounds=await page.locator('.brand').boundingBox();expect(brandBounds.x).toBeGreaterThanOrEqual(94);
 expect(await page.locator('.topbar').evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('drag');
 expect(await page.getByRole('button',{name:'Send message',exact:true}).evaluate(el=>getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('no-drag');
 await page.screenshot({path:path.join(root,'artifacts','vulp-mac-layout-simulation.png')});
 await page.locator('.app-shell').evaluate(el=>el.classList.remove('platform-darwin'));
 await expect(page.locator('.new-thread-shader')).toBeVisible();
 await expect.poll(()=>page.locator('.new-thread-shader').evaluate(canvas=>{const gl=canvas.getContext('webgl2');const program=gl?.getParameter(gl.CURRENT_PROGRAM);return !!program&&gl.getProgramParameter(program,gl.LINK_STATUS)&&gl.getError()===0})).toBe(true);
 await page.emulateMedia({reducedMotion:'reduce'});
 const shaderTime=()=>page.locator('.new-thread-shader').evaluate(canvas=>{const gl=canvas.getContext('webgl2');const p=gl.getParameter(gl.CURRENT_PROGRAM);return gl.getUniform(p,gl.getUniformLocation(p,'iTime'))});
 await page.waitForTimeout(100);const stillTime=await shaderTime();await page.waitForTimeout(200);expect(await shaderTime()).toBe(stillTime);
 await page.screenshot({path:path.join(root,'artifacts','vulp-shader-1440.png')});
 await page.emulateMedia({reducedMotion:'no-preference'});await expect.poll(shaderTime).toBeGreaterThan(stillTime);
await expect(page.getByText('One chat. Any model.',{exact:true})).toHaveCount(0);await expect(page.locator('.brand')).not.toContainText('Vulp');await page.screenshot({path:path.join(root,'artifacts','vulp-home-1440.png')});await page.getByRole('button',{name:'Explore this project'}).click();await expect(page.getByRole('textbox',{name:'Message',exact:true})).toContainText('Explain the architecture');await page.getByRole('textbox',{name:'Message',exact:true}).fill('');
 await page.getByRole('button',{name:'Choose project',exact:true}).click();await page.screenshot({path:path.join(root,'artifacts','vulp-project-picker.png')});await page.getByRole('dialog',{name:'Switch project'}).getByRole('button',{name:/Second project/}).click();await expect(page.locator('.hero-project')).toContainText('Second project');await page.getByRole('button',{name:'Choose project',exact:true}).click();await page.getByRole('dialog',{name:'Switch project'}).getByRole('button',{name:/Fixture workspace/}).click();await page.locator('.thread-item').filter({hasText:'Empty saved thread'}).click();
 await page.locator('.thread-item').filter({hasText:'Empty saved thread'}).click({button:'right'});await expect(page.getByRole('menuitem',{name:'Delete thread…'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);
 await app.evaluate(({Menu})=>{const original=Menu.prototype.popup;Menu.prototype.popup=function(options){globalThis.__contextRoles=this.items.map(item=>item.role);return original.call(this,options)}});
 await page.getByRole('textbox',{name:'Message',exact:true}).click({button:'right'});expect(await app.evaluate(()=>globalThis.__contextRoles)).toContain('paste');await page.keyboard.press('Escape');
 await page.getByTestId('model-selector').click();
 await expect(page.getByRole('tab',{name:'Claude Code',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Claude Code',exact:true}).click();await page.getByRole('button',{name:/^Sonnet/}).click();
 expect((await page.evaluate(()=>window.j2code.getSnapshot())).threads[0].provider).toBe('claude');
 await model('test-sol');await page.getByRole('button',{name:'Reasoning effort',exact:true}).click();await page.getByRole('button',{name:'ultra',exact:true}).click();
 await expect(page.getByRole('button',{name:'Reasoning effort',exact:true})).toContainText('ultra');
 await model('test-luna');await expect(page.getByRole('button',{name:'Reasoning effort',exact:true})).toContainText('Auto');
 await page.getByRole('button',{name:'Reasoning effort',exact:true}).click();await expect(page.getByRole('button',{name:'ultra',exact:true})).toHaveCount(0);await page.keyboard.press('Escape');
 const denied=await page.evaluate(async()=>{try{await window.j2code.updateThreadConfig('t',{provider:'codex',mode:'read',model:'test-luna',effort:'ultra'});return false}catch{return true}});expect(denied).toBe(true);
 await model('test-sol');await page.getByRole('button',{name:'Reasoning effort',exact:true}).click();await page.getByRole('button',{name:'ultra',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Message',exact:true})).toBeFocused();expect(await page.locator('.composer [data-testid="model-selector"]').count()).toBe(1);const modelBounds=await page.getByTestId('model-selector').boundingBox(),sendBounds=await page.getByRole('button',{name:'Send message',exact:true}).boundingBox(),inputBounds=await page.getByRole('textbox',{name:'Message',exact:true}).boundingBox();expect(modelBounds.y).toBeGreaterThanOrEqual(inputBounds.y+inputBounds.height);expect(Math.abs(modelBounds.y+modelBounds.height/2-sendBounds.y-sendBounds.height/2)).toBeLessThan(2);expect(await page.locator('.composer .attach-button').count()).toBe(1);await page.screenshot({path:path.join(root,'artifacts','composer-inline-1440.png')});await page.getByTestId('model-selector').click();await page.screenshot({path:path.join(root,'artifacts','vulp-picker-1440.png')});
 await page.setViewportSize({width:850,height:600});const bounds=await page.getByRole('dialog',{name:'Choose a model'}).boundingBox();expect(bounds.width).toBeLessThanOrEqual(341);expect(bounds.height).toBeLessThanOrEqual(321);expect(bounds.x+bounds.width).toBeLessThanOrEqual(850);expect(bounds.y).toBeGreaterThanOrEqual(0);await page.screenshot({path:path.join(root,'artifacts','vulp-picker-850.png')});await page.keyboard.press('Escape');
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[process.cwd()+'/assets/icon.png']})});
 await page.getByRole('button',{name:'Attach files',exact:true}).click();await expect(page.locator('.draft-attachments img')).toBeVisible();const attachmentBounds=await page.locator('.draft-attachments').boundingBox(),composerBounds=await page.locator('.composer').boundingBox();expect(attachmentBounds.y+attachmentBounds.height).toBeLessThanOrEqual(composerBounds.y+1);await page.screenshot({path:path.join(root,'artifacts','vulp-attachment-draft.png')});
 await page.locator('.new-thread-shader').evaluate(canvas=>canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
 await expect(page.locator('.new-thread-shader')).toHaveClass(/shader-fallback/);
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('Run the replay fixture');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByRole('button',{name:'Stop generation',exact:true})).toBeVisible();await expect(page.locator('.new-thread-shader')).toHaveCount(0);await expect(page.getByRole('button',{name:'Read only',exact:false})).toBeDisabled();await expect(page.locator('.activity-item.activity-running').filter({hasText:'/root/fixture-reviewer'})).toBeVisible();await page.screenshot({path:path.join(root,'artifacts','vulp-activity-live.png')});
 await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeVisible({timeout:15000});await expect(page.locator('.activity-toggle')).toHaveAttribute('aria-expanded','false');await page.screenshot({path:path.join(root,'artifacts','vulp-activity-complete.png')});
 expect(await page.locator('.messages-inner').evaluate(el => Array.from(el.children).map(child => child.className).filter(name => /message-user|activity-inline|message-assistant/.test(name)))).toEqual(['message message-user','activity-feed activity-inline ','message message-assistant']);await expect(page.locator('.message-attachments img')).toBeVisible();
 await page.getByRole('button',{name:'Copy response',exact:true}).click();expect(await app.evaluate(({clipboard})=>clipboard.readText())).toBe(reply);
 await page.getByRole('button',{name:'Copy code',exact:true}).click();expect(await app.evaluate(({clipboard})=>clipboard.readText())).toBe('const result = 19 * 23;\nconsole.log(result);');
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(root,'artifacts','vulp-rich-response.png')});
 await page.getByRole('button',{name:'Read only',exact:false}).click();await expect(page.getByRole('button',{name:'Edit files',exact:false})).toBeEnabled();expect((await page.evaluate(()=>window.j2code.getSnapshot())).threads[0].mode).toBe('edit');await page.getByRole('button',{name:'Edit files',exact:false}).click();
 await page.locator('.activity-toggle').click();await expect(page.getByText('Thinking',{exact:true})).toBeVisible();
 await page.locator('.activity-item').filter({has:page.getByText('node arithmetic-check',{exact:true})}).locator('summary').click();await expect(page.getByText('437',{exact:true})).toBeVisible();
 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:path.join(root,'artifacts','vulp-activity-expanded.png')});
 expect(await page.evaluate(async()=>{try{await window.j2code.updateThreadConfig('t',{provider:'claude',mode:'read'});return false}catch{return true}})).toBe(true);
 await app.close();app=null;await launch();const restored=await page.evaluate(()=>window.j2code.getSnapshot());expect(restored.threads[0].messages[0].attachments[0].name).toBe('icon.png');expect(restored.threads[0].effort).toBe('ultra');expect(restored.threads[0].activity.some(item=>item.kind==='agent'&&item.status==='completed')).toBe(true);
 await page.getByRole('textbox',{name:'Message',exact:true}).fill('cancel this replay');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('button',{name:'Stop generation',exact:true})).toBeVisible();await page.getByRole('button',{name:'Stop generation',exact:true}).click();await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeVisible({timeout:10000});
 console.log('PASS: empty-thread provider changes, sent-thread lock, advertised effort validation/reset/persistence, compact picker geometry, streamed tool and subagent lifecycle, persisted activity and cancellation. CLI subprocesses were deterministic replay fixtures, not authenticated providers.');
}finally{if(app)await app.close();await rm(temp,{recursive:true,force:true})}
