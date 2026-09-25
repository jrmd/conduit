import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp,mkdir,writeFile,chmod,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
const root=process.cwd(),temp=await mkdtemp(path.join(tmpdir(),'conduit-usage-'));
const data=path.join(temp,'data'),repo=path.join(temp,'repo'),bin=path.join(temp,'bin');let app;
try {
 for(const dir of [data,repo,bin])await mkdir(dir);
 // Limit fixtures answer only the protocol requests Conduit makes; no model or network access.
 const inHours=hours=>Date.now()+hours*3600000;
 await writeFile(path.join(bin,'claude'),`#!${process.execPath}
if(process.argv.includes('--version')){console.log('fixture');process.exit(0)}
let input='';for await(const c of process.stdin)input+=c;
const request=JSON.parse(input.split('\\n')[0]);
if(request.request?.subtype==='get_usage')console.log(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:request.request_id,response:{subscription_type:'max',rate_limits_available:true,rate_limits:{five_hour:{utilization:48,resets_at:${JSON.stringify(new Date(inHours(2.3)).toISOString())}},seven_day:{utilization:93,resets_at:${JSON.stringify(new Date(inHours(100)).toISOString())}},model_scoped:[{display_name:'Fable',utilization:20,resets_at:null}]}}}}));`);
 await writeFile(path.join(bin,'codex'),`#!${process.execPath}
if(process.argv.includes('--version')){console.log('fixture');process.exit(0)}
const send=value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\\n');
const window=(usedPercent,windowDurationMins,hours)=>({usedPercent,windowDurationMins,resetsAt:Math.round((Date.now()+hours*3600000)/1000)});
(await import('node:readline')).createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
 if(m.method==='account/rateLimits/read')return send({id:m.id,result:{ordinaryUsageAllowed:true,rateLimits:{},rateLimitsByLimitId:{codex:{limitId:'codex',planType:'prolite',primary:window(81,10080,31)}},rateLimitResetCredits:{availableCount:1}}});
 send({id:m.id,result:{}});});`);
 for(const name of ['claude','codex'])await chmod(path.join(bin,name),0o755);
 const now=Date.now(),thread=(id,title,usage)=>({id,projectId:'p',title,provider:'claude',mode:'supervised',messages:[{id:`${id}-u`,role:'user',text:'Hello',createdAt:now},{id:`${id}-a`,role:'assistant',text:'Fixture response',createdAt:now}],createdAt:now,updatedAt:now,usage});
 await writeFile(path.join(data,'state.json'),JSON.stringify({projects:[{id:'p',name:'Usage workspace',path:repo,createdAt:now}],threads:[thread('full','Nearly full context',{contextTokens:172400,contextWindow:200000,cost:{amount:1.874,currency:'USD'}}),thread('codex','Context without cost',{contextTokens:22060,contextWindow:258400})],disabledProviders:[]}));
 app=await electron.launch({executablePath:path.join(root,'node_modules/.bin/electron'),args:[root,'--ozone-platform=x11','--disable-gpu',`--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,J2CODE_DATA_DIR:data,PATH:`${bin}:${process.env.PATH}`}});
 const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Agent settings',exact:true}).click();await page.getByRole('button',{name:'Dark',exact:true}).click();await page.getByRole('button',{name:'Back to chat',exact:true}).click();
 await page.getByText('Context without cost').click();
 await expect(page.locator('.usage-meter')).toHaveText('9%');
 await page.getByText('Nearly full context').click();
 const meter=page.locator('.usage-meter');
 await expect(meter).toHaveText('86%$1.87');await expect(meter).toHaveAttribute('data-level','high');
 await expect(meter).toHaveAttribute('title','Context: 172.4K / 200K tokens\nSession cost: $1.87 (CLI estimate)\nClick for plan limits');
 await page.screenshot({path:path.join(root,'artifacts/conduit-usage-meter.png')});
 await meter.click();
 const claude=page.locator('.usage-provider').filter({hasText:'Claude Code'}),codex=page.locator('.usage-provider').filter({hasText:'Codex'});
 await expect(claude.getByRole('meter',{name:'Current session (5-hour)'})).toHaveAttribute('aria-valuenow','48');
 await expect(claude.locator('.usage-plan')).toHaveText('Max');
 await expect(claude.locator('.limit-window[data-level=critical]')).toContainText('Weekly · all models');
 await expect(codex.getByRole('meter',{name:'Weekly limit'})).toHaveAttribute('aria-valuenow','81');
 await expect(codex).toContainText('1 free limit reset available');
 await page.screenshot({path:path.join(root,'artifacts/conduit-usage-limits.png')});
 await page.getByRole('button',{name:'Back to chat',exact:true}).click();
 await page.evaluate(()=>localStorage.setItem('conduit.appearance','light'));
 await page.getByRole('button',{name:'Agent settings',exact:true}).click();await page.getByRole('tab',{name:'Appearance'}).click();await page.getByRole('button',{name:'Light',exact:true}).click();await page.getByRole('button',{name:'Back to chat',exact:true}).click();
 await page.setViewportSize({width:850,height:700});await page.screenshot({path:path.join(root,'artifacts/conduit-usage-meter-light.png')});
 await page.setViewportSize({width:430,height:800});await page.screenshot({path:path.join(root,'artifacts/conduit-usage-meter-narrow.png')});
 console.log('PASS: persisted usage renders context fill, warning level and session cost; Codex-style usage shows context only; the meter opens plan limits for Claude and Codex. Usage and limit values are fixtures.');
} finally {if(app)await app.close();await rm(temp,{recursive:true,force:true});}
