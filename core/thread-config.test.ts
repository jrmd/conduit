import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { clearModelCatalogues, discoverModels, validateEffort, validateModelSettings } from './providers';
import { validateThreadConfig } from './thread-config';
import type { ThreadConfig } from '../shared/api';

test('Claude settings reuse discovered capabilities instead of starting a CLI for every validation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'conduit-config-'));
  const originalPath = process.env.PATH;
  const log = join(dir, 'calls');
  try {
    const executable = join(dir, 'claude');
    const frame = {type:'control_response',response:{subtype:'success',request_id:'j2code-model-capabilities',response:{models:[{value:'fixture',supportsEffort:true,supportedEffortLevels:['low','high'],supportsFastMode:true}]}}};
    await writeFile(executable, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, 'call\\n');\nsetTimeout(() => console.log(${JSON.stringify(JSON.stringify(frame))}), 100);\n`);
    await chmod(executable, 0o755);
    process.env.PATH = `${dir}${delimiter}${originalPath}`;
    const [catalogue] = await Promise.all([discoverModels('claude'), discoverModels('claude')]);
    catalogue.options.length = 0;
    await validateEffort('claude', 'fixture', 'high');
    await validateModelSettings('claude', 'fixture', {fastMode:false});
    await validateEffort('claude', 'fixture', 'low');
    await assert.rejects(validateEffort('claude', 'fixture', 'invalid'), /not advertised/);
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1, 'warm settings must not launch additional CLI processes');
    const current: ThreadConfig = {provider:'claude',model:'fixture',effort:'high',fastMode:false,mode:'supervised'};
    assert.equal((await validateThreadConfig(current, {...current,effort:'low'})).effort, 'low');
    clearModelCatalogues();
    assert.equal((await validateThreadConfig(current, {...current,mode:'full-access'})).mode, 'full-access');
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 1, 'permission-only changes must not discover capabilities even with a cold cache');
    await discoverModels('claude');
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 2, 'explicit discovery refresh must invalidate the cache');
    await assert.rejects(validateThreadConfig(current, {...current,model:'unknown'}), /not advertised/);
    await assert.rejects(validateThreadConfig(current, {...current,contextWindow:999}), /not advertised/);
    const reset = await validateThreadConfig(current, {provider:'claude',model:'fixture',mode:'supervised'});
    assert.equal(reset.effort, undefined);
    assert.equal(reset.fastMode, undefined);
    const now = Date.now;
    try {
      const expired = now() + 6 * 60 * 1000;
      Date.now = () => expired;
      await discoverModels('claude');
    } finally { Date.now = now; }
    assert.equal((await readFile(log, 'utf8')).trim().split('\n').length, 3, 'expired capabilities must be refreshed');
  } finally {
    clearModelCatalogues();
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    await rm(dir, {recursive:true,force:true});
  }
});
