// Opt-in live test: uses the installed CLIs and their existing authentication.
// No repository files are passed to the models; each run gets a disposable fixture.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { runWithDelegation } from '../core/delegation';
import { runProvider } from '../core/providers';
import type { ActivityUpdate } from '../shared/api';

const childOnly=process.argv.includes('--codex-child');
for (const provider of (childOnly ? ['codex'] : process.argv.includes('--claude-parent') ? ['claude'] : ['codex', 'claude']) as ('codex'|'claude')[]) {
  const cwd = await mkdtemp(join(tmpdir(), 'conduit-delegation-'));
  const token = randomUUID();
  await writeFile(join(cwd, 'marker.txt'), token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
  let text = '';
  const children = new Map<string, ActivityUpdate>();
  const childProvider = provider === 'codex' ? 'claude' : 'codex';
  try {
    if(childOnly) {
      await runProvider({provider:'codex',cwd,mode:'supervised',readOnlyChild:true,signal:controller.signal,onApproval:async()=>false,prompt:'Read marker.txt and return its exact contents. Do not modify files.',onEvent:e=>{if(e.kind==='text')text+=e.text;}});
      assert.ok(text.includes(token),text);
      console.log('Codex restricted child: live file read passed');
      continue;
    }
    const result = await runWithDelegation({provider,cwd,mode:'supervised',signal:controller.signal,onApproval:async()=>false,
      prompt:`Use the Conduit delegation tools to spawn exactly one ${childProvider} child. Its task is: Read marker.txt in the working directory and return its exact contents. Do not read the file yourself or use native subagents. Use conduit_wait_agent repeatedly until completed. Reply with the exact marker returned by the child. If delegation fails, report the error.`,
      onEvent:event=>{
        if(event.kind==='text') text+=event.text;
        if(event.kind==='activity' && event.activity?.kind==='agent' && event.activity.provider) {
          const a=event.activity;
          if(children.get(a.id)?.status!==a.status) console.log(`${provider} → ${a.provider}: ${a.status}`);
          children.set(a.id,a);
        }
      },
    },['codex','claude'],runProvider);
    assert.ok(result.sessionId);
    assert.equal(children.size,1,`Expected a Conduit child; parent said: ${text}`);
    assert.equal([...children.values()][0].status,'completed',JSON.stringify([...children.values()]));
    assert.ok(text.includes(token),`Parent did not use the child's answer: ${text}`);
    console.log(`${provider} → ${childProvider}: live round trip passed`);
  } catch(error) {
    console.error(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode=1;
  } finally {clearTimeout(timer);await rm(cwd,{recursive:true,force:true});}
}
