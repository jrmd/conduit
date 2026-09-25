import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverModels, discoverProviders, parseAcpModels, runProvider } from './providers';
import { Store } from './store';

test('Copilot models use advertised config options or legacy model state', () => {
  assert.deepEqual(parseAcpModels({ configOptions: [{ category: 'model', options: [{ name: 'Group', options: [{value:'model-a',name:'Model A'}, {value:'bad id'}] }, {value:'model-a'}] }] }), [{ id:'model-a', label:'Model A', source:'discovered' }]);
  assert.equal(parseAcpModels({ models: { availableModels: [{ modelId:'model-b', name:'Model B' }] } })[0].id, 'model-b');
  assert.deepEqual(parseAcpModels({}), []);
});

test('Copilot discovery, ACP-only routing, model selection, resume, failures and cancellation', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'conduit-copilot-test-'));
  const oldPath = process.env.PATH;
  const executable = join(dir, 'copilot');
  const log = join(dir, 'rpc.jsonl');
  const fixture = `#!/usr/bin/env node
import readline from 'node:readline';
import {appendFileSync} from 'node:fs';
if(process.argv.includes('--version')) { console.log('Copilot fixture'); process.exit(0); }
if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['--acp','--stdio'])) process.exit(9);
const send=m=>console.log(JSON.stringify({jsonrpc:'2.0',...m}));
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); appendFileSync(${JSON.stringify(log)},line+'\\n');
 if(m.method==='initialize') return send({id:m.id,result:{agentCapabilities:{loadSession:true,promptCapabilities:{image:true}}}});
 if(m.method==='session/new'||m.method==='session/load') return send({id:m.id,result:{sessionId:'copilot-session',configOptions:[{id:'allow_all',currentValue:'on'},{id:'model',category:'model',options:[{value:'model-a',name:'Model A'}]}]}});
 if(m.method==='session/prompt') {
  if(m.params.prompt[0].text==='hang') return;
  if(m.params.prompt[0].text==='auth') return send({id:m.id,error:{code:-32000,message:'Authentication required. Run copilot login'}});
  send({method:'session/update',params:{sessionId:'copilot-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'OK'}}}});
  return send({id:m.id,result:{stopReason:'end_turn'}});
 }
 send({id:m.id,result:{}});
});
`;
  try {
    await writeFile(executable, fixture); await chmod(executable, 0o755);
    process.env.PATH = dir + delimiter + oldPath;
    const provider = (await discoverProviders()).find(row => row.id === 'copilot');
    assert.equal(provider?.available, true); assert.equal(provider?.path, executable);
    assert.equal((await discoverModels('copilot')).options[0].id, 'model-a');
    let text = '';
    const input = { provider:'copilot' as const, cwd:dir, prompt:'hello', model:'model-a', signal:AbortSignal.timeout(5000), onEvent:(event:any)=>{if(event.kind==='text') text+=event.text;} };
    // No approval callback and no explicit mode: summaries must also use ACP.
    assert.equal((await runProvider(input)).sessionId, 'copilot-session');
    await runProvider({...input, sessionId:'copilot-session', attachments:[{id:'image',name:'image.png',mime:'image/png',size:3,path:join(dir,'image.png'),data:Buffer.from('png')}]});
    assert.equal(text, 'OKOK');
    const records = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(records.some(row => row.method === 'session/prompt' && row.params.prompt.some((block: {type:string; mimeType?:string; data?:string}) => block.type === 'image' && block.mimeType === 'image/png' && block.data === Buffer.from('png').toString('base64'))));
    assert.ok(records.some(row => row.method === 'session/load' && row.params.sessionId === 'copilot-session'));
    assert.ok(records.some(row => row.method === 'session/set_config_option' && row.params.configId === 'model' && row.params.value === 'model-a'));
    assert.equal(records.filter(row => row.method === 'session/set_config_option' && row.params.configId === 'allow_all' && row.params.value === 'off').length, 2);
    await assert.rejects(runProvider({...input, prompt:'auth'}), /copilot login/);
    await assert.rejects(runProvider({...input, prompt:'hang', signal:AbortSignal.timeout(250)}), /cancelled|aborted/i);
    const store = new Store(join(dir, 'state.json')); await store.load();
    await store.setProviderEnabled('copilot', false);
    const restored = new Store(join(dir, 'state.json')); await restored.load();
    assert.ok(restored.snapshot().disabledProviders.includes('copilot'));
  } finally { process.env.PATH = oldPath; await rm(dir, {recursive:true, force:true}); }
});
