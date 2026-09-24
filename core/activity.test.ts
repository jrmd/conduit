import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityParser } from './activity';
import { buildProviderInvocation, parseProviderOutputLine, parseOpenCodeModels, validateEffort } from './providers';
import { Store } from './store';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Codex activity tracks reasoning, commands and delegated agents through completion', () => {
  const parse = createActivityParser('codex');
  const event = (type: string, item: object) => parse(JSON.stringify({ type, item }));
  assert.equal(event('item.completed', { id:'r', type:'reasoning', text:'Checking the parser' })[0].detail, 'Checking the parser');
  const started = event('item.started', { id:'cmd', type:'command_execution', command:'pnpm test', status:'in_progress' })[0];
  const done = event('item.completed', { id:'cmd', type:'command_execution', command:'pnpm test', aggregated_output:'4 tests pass', exit_code:0, status:'completed' })[0];
  assert.equal(started.id, done.id); assert.equal(done.status, 'completed'); assert.match(done.detail, /4 tests pass/);
  const spawn = event('item.completed', { id:'spawn', type:'collab_tool_call', tool:'spawn_agent', receiver_thread_ids:['child'], prompt:'Check tests', agents_states:{child:{status:'running'}} });
  assert.equal(spawn[1].kind, 'agent'); assert.equal(spawn[1].status, 'running');
  const wait = event('item.completed', { id:'wait', type:'collab_tool_call', tool:'wait', agents_states:{child:{status:'completed',message:'Tests pass'}} });
  assert.equal(wait[1].id, spawn[1].id); assert.equal(wait[1].status,'completed'); assert.equal(wait[1].detail,'Tests pass');
});

test('Claude subagents keep tool identity, nested output, thinking and final status separate from root text', () => {
  const parse = createActivityParser('claude');
  const line = (value: object) => JSON.stringify(value);
  parse(line({ type:'assistant', message:{ id:'m',content:[{ type:'tool_use',id:'agent1',name:'Agent',input:{description:'Review parser',prompt:'Review it'}}] } }));
  const child = { type:'assistant', parent_tool_use_id:'agent1', session_id:'child-session', message:{id:'m2',content:[{type:'text',text:'Child answer'}]} };
  assert.deepEqual(parseProviderOutputLine('claude',line(child)),[]);
  assert.equal(parse(line(child))[0].parentId,'tool:agent1');
  parse(line({type:'stream_event',event:{type:'message_start',message:{id:'m3'}}}));
  const begin=parse(line({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'thinking'}}}))[0];
  const delta=parse(line({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{thinking:'Inspecting tests'}}}))[0];
  const complete=parse(line({type:'assistant',message:{id:'m3',content:[{type:'thinking',thinking:'Inspecting tests'}]}}))[0];
  assert.equal(begin.id,delta.id);assert.equal(delta.append,true);assert.equal(begin.id,complete.id);
  const end=parse(line({ type:'user', message:{content:[{type:'tool_result',tool_use_id:'agent1',content:'Review complete'}]} }))[0];
  assert.equal(end.kind,'agent'); assert.equal(end.title,'Review parser'); assert.equal(end.status,'completed');
});

test('OpenCode task results and reasoning, Cursor tool lifecycles remain structured', () => {
  const oc=createActivityParser('opencode');
  const row=oc(JSON.stringify({type:'tool_use',part:{id:'t',tool:'task',state:{status:'completed',input:{description:'Explore files'},output:'Done',metadata:{sessionId:'child'}}}}))[0];
  assert.equal(row.kind,'agent');assert.equal(row.agentId,'child');assert.equal(row.status,'completed');
  assert.equal(oc(JSON.stringify({type:'reasoning',part:{id:'r',text:'Summary'}}))[0].kind,'reasoning');
  const cursor=createActivityParser('cursor');
  assert.equal(cursor(JSON.stringify({type:'tool_call',subtype:'completed',call_id:'c',tool_call:{shellToolCall:{result:'ok'}}}))[0].status,'completed');
});

test('empty threads can change provider; sent threads cannot; activity survives restart and coalesces deltas', async () => {
  const dir=await mkdtemp(join(tmpdir(),'j2code-activity-'));
  try {
    const file=join(dir,'state.json');const store=new Store(file);await store.load();const project=await store.addProject(dir);
    const thread=await store.createThread(project.id,'codex','read','model-a');
    await store.configureThread(thread.id,{provider:'claude',mode:'edit',model:'sonnet'});
    assert.equal(store.getThread(thread.id).provider,'claude');
    await store.appendMessage(thread.id,'user','Hello');
    await assert.rejects(store.configureThread(thread.id,{provider:'codex',mode:'edit'}),/first message/);
    const base={id:'thought',kind:'reasoning' as const,title:'Thinking',detail:'First',status:'running' as const};
    store.recordActivity(thread.id,'run',base);store.recordActivity(thread.id,'run',{...base,detail:' second',append:true});
    store.recordActivity(thread.id,'run',{...base,detail:'Complete summary',status:'completed'});
    await store.flush();const restored=new Store(file);await restored.load();
    assert.equal(restored.getThread(thread.id).activity?.length,1);assert.equal(restored.getThread(thread.id).activity?.[0].detail,'Complete summary');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('effort validates exact advertised model capabilities, persists, and maps to each CLI flag', async () => {
  const dir=await mkdtemp(join(tmpdir(),'j2code-effort-'));const previous=process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME=dir;
    await writeFile(join(dir,'models_cache.json'),JSON.stringify({models:[{slug:'sol',visibility:'list',supported_reasoning_levels:[{effort:'low'},{effort:'ultra'}]},{slug:'luna',visibility:'list',supported_reasoning_levels:[{effort:'low'},{effort:'max'}]}]}));
    assert.equal(await validateEffort('codex','sol','ultra'),'ultra');
    await assert.rejects(validateEffort('codex','luna','ultra'),/not advertised/);
    await assert.rejects(validateEffort('codex',undefined,'ultra'),/Choose a model/);
    for(const session of [undefined,'session']) {
      assert.ok(buildProviderInvocation('codex',dir,'hello',session,'read','sol','ultra').args.includes('model_reasoning_effort="ultra"'));
      const claude=buildProviderInvocation('claude',dir,'hello',session,'read','opus','high').args;
      assert.equal(claude[claude.indexOf('--effort')+1],'high');
      const oc=buildProviderInvocation('opencode',dir,'hello',session,'read','openai/model','high').args;
      assert.equal(oc[oc.indexOf('--variant')+1],'high');
    }
    assert.throws(()=>buildProviderInvocation('cursor',dir,'hi',undefined,'read','model','ultra'),/does not expose/);
    const options=parseOpenCodeModels('openai/model\n{\n "name":"Model",\n "variants":{"low":{},"high":{},"hidden":{"disabled":true}}\n}\n');
    assert.deepEqual(options[0].efforts,['low','high']);
    const store=new Store(join(dir,'state.json'));await store.load();const project=await store.addProject(dir);const thread=await store.createThread(project.id,'codex','read','sol','ultra');
    const restored=new Store(join(dir,'state.json'));await restored.load();assert.equal(restored.getThread(thread.id).effort,'ultra');
  } finally { if(previous===undefined) delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await rm(dir,{recursive:true,force:true}); }
});

test('Codex session fallback reads only current public events and explicitly linked children', async () => {
  const { watchCodexActivity } = await import('./codex-activity.js');
  const { mkdir } = await import('node:fs/promises');
  const home=await mkdtemp(join(tmpdir(),'j2code-session-tail-'));
  const root='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222';
  const rows: import('../shared/api').ActivityUpdate[]=[];
  try {
    const dir=join(home,'sessions',...new Date().toISOString().slice(0,10).split('-'));await mkdir(dir,{recursive:true});
    const now=Date.now();const event=(item:object, timestamp=now)=>JSON.stringify({timestamp:new Date(timestamp).toISOString(),type:'event_msg',payload:{type:'item_completed',item}})+'\n';
    await writeFile(join(dir,`rollout-${root}.jsonl`),event({type:'SubAgentActivity',agent_thread_id:child,agent_path:'/root/reviewer',kind:'started'})+event({type:'SubAgentActivity',agent_thread_id:child,agent_path:'/root/reviewer',kind:'completed'}));
    await writeFile(join(dir,`rollout-${child}.jsonl`),event({type:'AgentMessage',id:'old',content:[{type:'Text',text:'Old response'}]},now-10000)+event({type:'AgentMessage',id:'new',phase:'final_answer',content:[{type:'Text',text:'Reviewed'}]})+JSON.stringify({timestamp:new Date(now).toISOString(),type:'response_item',payload:{type:'reasoning',content:'Do not expose raw reasoning'}})+'\n');
    await writeFile(join(dir,'rollout-33333333-3333-4333-8333-333333333333.jsonl'),event({type:'AgentMessage',id:'unrelated',content:[{type:'Text',text:'Do not read unrelated sessions'}]}));
    const watcher=watchCodexActivity(root,now-1,row=>rows.push(row),home);await watcher.stop();
    assert.deepEqual(rows.filter(row=>row.kind==='agent').map(row=>row.status),['running','completed']);
    assert.equal(rows.find(row=>row.title==='Agent response')?.detail,'Reviewed');
    assert.equal(rows.find(row=>row.title==='Agent response')?.parentId,`agent:${child}`);
    assert.doesNotMatch(JSON.stringify(rows),/Old response|raw reasoning|unrelated sessions/);
  }finally{await rm(home,{recursive:true,force:true})}
});
