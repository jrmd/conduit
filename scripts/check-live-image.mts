import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AttachmentStore } from '../core/attachments.js';
import { runProvider } from '../core/providers.js';
if(process.env.CONDUIT_LIVE_IMAGE_CHECK !== '1') throw new Error('Set CONDUIT_LIVE_IMAGE_CHECK=1 to send one read-only Codex image prompt');
const folder=await fs.mkdtemp(path.join(tmpdir(),'conduit-vision-'));
const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),60000);
try{
 const store=new AttachmentStore(path.join(folder,'attachments'));
 const image=await store.import('fox.png',await fs.readFile(path.resolve('assets/icon.png')));
 const files=await store.resolve([image.id]);let reply='';
 await runProvider({provider:'codex',cwd:folder,prompt:'Look only at the attached image. Name the animal depicted. Reply with one word. Do not run tools.',mode:'read',attachments:files,signal:abort.signal,onEvent:event=>{if(event.kind==='text')reply+=event.text}});
 console.log(JSON.stringify({provider:'codex',nativeImageInput:true,reply:reply.trim(),matchesFox:/fox/i.test(reply)}));
 if(!/fox/i.test(reply))process.exitCode=1;
}finally{clearTimeout(timer);await fs.rm(folder,{recursive:true,force:true})}
