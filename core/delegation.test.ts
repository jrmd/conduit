import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Delegation, callProviderTool, runWithDelegation, type ProviderRunner } from './delegation';
import type { ProviderRunEvent, RunProviderArgs } from './providers';
import { createClaudeToolServer } from './interactive-provider';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

function setup(run: ProviderRunner, enabled: ('claude' | 'codex')[] = ['claude','codex']) {
  const controller = new AbortController();
  const events: ProviderRunEvent[] = [];
  const parent: RunProviderArgs = {provider:'codex',cwd:'/workspace',prompt:'parent private context',model:'parent-model',sessionId:'parent-session',mode:'full-access',signal:controller.signal,onEvent:e=>events.push(e)};
  const delegation = new Delegation(parent,enabled,run);
  const call = async (name: string, args: unknown) => {
    const result = await callProviderTool(delegation.tools,`vulp_${name}_agent`,args);
    return {success:result.success,...JSON.parse(result.text)};
  };
  return {parent,controller,events,delegation,call};
}

test('child context is explicit, results stay separate, nested identities cannot collide',async()=>{
  const s = setup(async input=>{
    assert.equal(input.provider,'claude');
    assert.equal(input.model,'child-model');
    assert.equal(input.cwd,'/workspace');
    assert.equal(input.readOnlyChild,true);
    assert.equal(input.sessionId,undefined);
    assert.equal(input.tools,undefined);
    assert.equal(input.attachments,undefined);
    assert.ok(!input.prompt.includes('parent private context'));
    assert.equal(await input.onApproval?.('edit','file'),false);
    input.onEvent({kind:'text',text:'Child evidence',sessionId:'child-session'});
    input.onEvent({kind:'activity',text:'Read',activity:{id:'tool',kind:'tool',title:'Read',detail:'file',status:'completed'}});
    input.onEvent({kind:'activity',text:'Nested',activity:{id:'nested',parentId:'tool',kind:'status',title:'Nested',detail:'',status:'completed'}});
    return {sessionId:'child-session'};
  });
  try {
    const spawned = await s.call('spawn',{provider:'claude',model:'child-model',task:'Review file'});
    const result = await s.call('wait',{agentId:spawned.agentId,timeoutMs:100});
    assert.equal(result.status,'completed');
    assert.equal(result.result,'Child evidence');
    assert.ok(s.events.every(e=>e.kind==='activity' && !e.sessionId));
    const nested=s.events.find(e=>e.activity?.title==='Nested')!.activity!;
    assert.equal(nested.parentId,`${spawned.agentId}:tool`);
    assert.equal(s.events.at(-1)?.activity?.sessionId,'child-session');
    assert.equal((await s.call('wait',{agentId:spawned.agentId,timeoutMs:0})).result,'Child evidence');
  } finally {await s.delegation.close();}
});

test('concurrent children are bounded, waits time out, cancel and parent abort stop descendants',async()=>{
  const signals: AbortSignal[] = [];
  const s=setup(input=>new Promise(resolve=>{signals.push(input.signal);input.signal.addEventListener('abort',()=>resolve({}),{once:true});}));
  try {
    const children=[];
    for(let i=0;i<3;i++) children.push(await s.call('spawn',{provider:'claude',task:`task ${i}`}));
    assert.equal((await s.call('spawn',{provider:'codex',task:'fourth'})).success,false);
    assert.equal((await s.call('wait',{agentId:children[0].agentId,timeoutMs:0})).status,'running');
    assert.equal((await s.call('cancel',{agentId:children[0].agentId})).status,'interrupted');
    assert.equal(signals[0].aborted,true);
    s.controller.abort();
    await s.delegation.close();
    assert.ok(signals.every(signal=>signal.aborted));
    assert.equal((await s.call('spawn',{provider:'claude',task:'late'})).success,false);
  } finally {await s.delegation.close();}
});

test('tool validation and parent ownership reject malformed, disabled and foreign requests',async()=>{
  let runs=0;
  const s=setup(async()=>{runs++;return {};},['codex']);
  try {
    for(const args of [{provider:'claude',task:'disabled'}, {provider:'cursor',task:'unsupported'}, {provider:'codex',task:''}, {provider:'codex',task:'task',cwd:'/other'}, {provider:'codex',task:'task',model:'--bad'}]) {
      assert.equal((await s.call('spawn',args)).success,false);
    }
    assert.equal((await s.call('wait',{agentId:'other-parent-child'})).success,false);
    assert.equal((await s.call('wait',{agentId:'other',timeoutMs:30001})).success,false);
    assert.equal(runs,0);
  } finally {await s.delegation.close();}
});

test('provider failure and empty output are explicit results, never successful completion',async()=>{
  for(const run of [async()=>{throw new Error('not authenticated');},async()=>({})]) {
    const s=setup(run);
    try {
      const child=await s.call('spawn',{provider:'claude',task:'review'});
      const result=await s.call('wait',{agentId:child.agentId});
      assert.equal(result.status,'failed');
      assert.ok(result.error);
    } finally {await s.delegation.close();}
  }
});

test('parent completion and failure clean up abandoned children',async()=>{
  for(const fail of [false,true]) {
    let childSignal: AbortSignal | undefined;
    const s=setup(async()=>({}));
    const run: ProviderRunner = async input=>{
      if(input.readOnlyChild) return new Promise(resolve=>{childSignal=input.signal;input.signal.addEventListener('abort',()=>resolve({}),{once:true});});
      assert.ok(input.tools);
      await callProviderTool(input.tools,'vulp_spawn_agent',{provider:'claude',task:'review'});
      if(fail) throw new Error('parent failed');
      return {sessionId:'root'};
    };
    try {
      const result=runWithDelegation(s.parent,['claude'],run);
      if(fail) await assert.rejects(result,/parent failed/); else await result;
      assert.equal(childSignal?.aborted,true);
    } finally {await s.delegation.close();}
  }
});

test('Claude SDK MCP adapter advertises tools and returns actual child results and tool errors',async()=>{
  const s=setup(async input=>{input.onEvent({kind:'text',text:'Codex findings'});return {};});
  const server=await createClaudeToolServer(s.delegation.tools);
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:'vulp-test',version:'1'});
  await server.instance.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    assert.equal((await client.listTools()).tools.length,3);
    const spawned=await client.callTool({name:'vulp_spawn_agent',arguments:{provider:'codex',task:'review'}});
    const content=spawned.content as {type:string;text:string}[];
    const {agentId}=JSON.parse(content[0].text);
    const result=await client.callTool({name:'vulp_wait_agent',arguments:{agentId,timeoutMs:100}});
    assert.match(JSON.stringify(result),/Codex findings/);
    const error=await client.callTool({name:'vulp_wait_agent',arguments:{agentId:'foreign'}});
    assert.equal(error.isError,true);
  } finally {await client.close();await server.instance.close();await s.delegation.close();}
});
