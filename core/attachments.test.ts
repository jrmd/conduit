import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AttachmentStore } from './attachments';
import { buildAttachmentInvocation } from './providers';

test('attachments persist independently of source files and reject invalid IDs, sizes and spoofed images', async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'vulp-attachments-'));
 try {
  const store=new AttachmentStore(dir);
  const item=await store.import('notes.txt',Buffer.from('hello'));
  const [restored]=await new AttachmentStore(dir).resolve([item.id]);
  assert.equal(restored.data.toString(),'hello');assert.equal(restored.name,'notes.txt');
  await assert.rejects(store.resolve(['../../state.json']),/Invalid/);
  await assert.rejects(store.resolve([item.id,item.id]),/10 files/);
  await assert.rejects(store.import('fake.png',Buffer.from('not an image')),/invalid/);
  await assert.rejects(store.import('large.txt',Buffer.alloc(21*1024*1024)),/20 MB/);
  await assert.rejects(store.import('metadata.json',Buffer.from('overwrite')),/rename/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('CLI attachments use native image payloads on new and resumed turns, documents retain literal paths',()=>{
 const image={id:'image',name:'screenshot.png',mime:'image/png',size:3,path:'/tmp/a screenshot.png',data:Buffer.from('png')};
 const doc={id:'doc',name:'notes.txt',mime:'application/octet-stream',size:4,path:'/tmp/notes with spaces.txt',data:Buffer.from('text')};
 for(const session of [undefined,'session']){
  const codex=buildAttachmentInvocation('codex','/tmp','Review',session,'edit',undefined,undefined,[image,doc]);
  assert.equal(codex.args[codex.args.indexOf('--image')+1],image.path);
  if(session)assert.equal(codex.args[1],'resume');
  assert.match(codex.stdin!,/notes with spaces.txt/);
  const claude=buildAttachmentInvocation('claude','/tmp','Review',session,'read',undefined,undefined,[image]);
  const wire=JSON.parse(claude.stdin!);assert.equal(wire.message.content[0].source.data,Buffer.from('png').toString('base64'));assert.equal(wire.type,'user');
  assert.ok(claude.args.includes('stream-json'));
  const oc=buildAttachmentInvocation('opencode','/tmp','Review',session,'read',undefined,undefined,[image,doc]);
  assert.equal(oc.args.filter(arg=>arg==='--file').length,2);
 }
 assert.throws(()=>buildAttachmentInvocation('cursor','/tmp','Review',undefined,'read',undefined,undefined,[image]),/not supported/);
});
