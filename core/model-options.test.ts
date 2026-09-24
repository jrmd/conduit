import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelFamilies } from '../shared/model-options';
import { parseListedModels } from './providers';
test('Cursor variants become one family retaining exact executable IDs', () => {
  const options = parseListedModels('Available models\ngpt-5.3-codex-low - GPT-5.3 Codex Low\ngpt-5.3-codex-high - GPT-5.3 Codex High\ngpt-5.3-codex-high-fast - GPT-5.3 Codex High Fast\ngpt-5.3-codex-high-1m - GPT-5.3 Codex High 1M', 'cursor');
  const families = modelFamilies('cursor', options);
  assert.equal(families.length, 1);
  assert.equal(families[0].label, 'GPT-5.3 Codex');
  assert.deepEqual(families[0].variants.map(v => [v.id, v.effort, v.context, v.fast]), [
    ['gpt-5.3-codex-low', 'low', '', false], ['gpt-5.3-codex-high', 'high', '', false],
    ['gpt-5.3-codex-high-fast', 'high', '', true], ['gpt-5.3-codex-high-1m', 'high', '1m', false]
  ]);
});

import { mkdtemp, writeFile, rm, copyFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverModels, validateModelSettings, parseClaudeModels } from './providers';
import { runInteractiveProvider } from './interactive-provider';
test('capability discovery and validation reject unsupported context and speed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vulp-capabilities-'));
  const original = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = dir;
    await writeFile(join(dir,'models_cache.json'), JSON.stringify({models:[{slug:'example',visibility:'list',context_window:200000,max_context_window:1000000,service_tiers:[{id:'priority'}]}]}));
    const option = (await discoverModels('codex')).options[0];
    assert.deepEqual(option.contextWindows, [200000,1000000]);
    assert.equal(option.supportsFastMode,true);
    assert.deepEqual(await validateModelSettings('codex','example',{contextWindow:1000000,fastMode:false}), {contextWindow:1000000,fastMode:false});
    await assert.rejects(validateModelSettings('codex','example',{contextWindow:999999}));
    await assert.rejects(validateModelSettings('codex','missing',{fastMode:true}));
    await assert.rejects(validateModelSettings('codex','example',{fastMode:'true'}));
    const claude = parseClaudeModels(JSON.stringify({type:'control_response',response:{subtype:'success',request_id:'j2code-model-capabilities',response:{models:[{value:'opus',supportsFastMode:true}]}}}));
    assert.equal(claude[0].supportsFastMode,true);
  } finally { if(original === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = original; await rm(dir,{recursive:true,force:true}); }
});
test('Codex receives context override and explicit speed on new and resumed turns', async () => {
  const dir = await mkdtemp(join(tmpdir(),'vulp-model-wire-'));
  try {
    const executable = join(dir,'provider'); await copyFile('scripts/fixtures/approval-provider.mjs',executable); await chmod(executable,0o755);
    for(const fast of [true,false]) {
      const log = join(dir,`wire-${fast}.jsonl`);
      await runInteractiveProvider({provider:'codex',cwd:dir,prompt:'test',mode:'supervised',model:'example',effort:'high',contextWindow:1000000,fastMode:fast,sessionId:fast?undefined:'existing',signal:AbortSignal.timeout(5000),onEvent:()=>{},onApproval:async()=>false},executable,{...process.env,VULP_PROTOCOL_LOG:log});
      const records = (await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
      const start = records.find(row => row.method === (fast?'thread/start':'thread/resume'));
      assert.equal(start.params.config.model_context_window,1000000);
      const turn = records.find(row => row.method === 'turn/start');
      assert.equal(turn.params.serviceTierForTurn,fast?'priority':'default');
      assert.equal(turn.params.effort,'high');
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('Claude context aliases group without crossing providers or dropping unknown models', () => {
  const rows = [{id:'opus',label:'Opus',source:'discovered' as const},{id:'opus[1m]',label:'Opus 1M',source:'discovered' as const}];
  assert.equal(modelFamilies('claude',rows).length,1);
  assert.equal(modelFamilies('opencode',rows).length,2);
  assert.equal(modelFamilies('cursor',[{id:'grok-code-fast-1',label:'Grok Code Fast 1',source:'discovered'}])[0].label,'Grok Code Fast 1');
});
