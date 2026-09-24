import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Real renderer, IPC, and Git diff against an isolated repository; no provider run.
const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), 'vulp-quiet-focus-'));
const data = path.join(temp, 'data'), repo = path.join(temp, 'repo');
let app;
try {
  await mkdir(data); await mkdir(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], {cwd:repo});
  await writeFile(path.join(repo, 'picker.ts'), "export const placeholder = 'Select a project';\n");
  execFileSync('git', ['add', 'picker.ts'], {cwd:repo});
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Fixture'], {cwd:repo});
  await writeFile(path.join(repo, 'picker.ts'), "export const placeholder = 'Find a project';\n");
  const now = Date.now();
  await writeFile(path.join(data, 'state.json'), JSON.stringify({
    projects:[{id:'p',name:'Vulp',path:repo,createdAt:now},{id:'p2',name:'Second project',path:temp,createdAt:now}], disabledProviders:[],
    threads:[{id:'t',projectId:'p',provider:'codex',mode:'read',title:'Project picker',branch:'main',createdAt:now,updatedAt:now,
      messages:[{id:'u',role:'user',text:'Can we make the project picker easier to use?',createdAt:now},
        {id:'a',role:'assistant',text:'The picker now keeps the current project at the top. Search sits underneath, and “Open folder” stays at the bottom.\n\nI also tightened the spacing so longer folder names fit without pushing the menu wider.',createdAt:now+2}],
      activity:[{id:'check',runId:'fixture',kind:'tool',title:'Read project picker',detail:'Sample activity for the renderer test.',status:'completed',createdAt:now+1,updatedAt:now+1}]}]
  }));
  const state = JSON.parse(await readFile(path.join(data, 'state.json'), 'utf8'));
  state.threads.push(
    {...state.threads[0], id:'t2', projectId:'p2', title:'Refine the workspace navigation and session details', provider:'claude', updatedAt:now-540000},
    {...state.threads[0], id:'t3', title:'Simplify the onboarding flow', branch:undefined, branches:[], updatedAt:now-1380000},
    {...state.threads[0], id:'t4', title:'Archived exploration', settled:true, updatedAt:now-86400000}
  );
  await writeFile(path.join(data, 'state.json'), JSON.stringify(state));
  app = await electron.launch({executablePath:path.join(root,process.env.J2CODE_SMOKE_PACKAGED?'release/linux-unpacked/vulp':'node_modules/.bin/electron'),args:[...(process.env.J2CODE_SMOKE_PACKAGED?[]:[root]),`--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,J2CODE_DATA_DIR:data}});
  const page = await app.firstWindow(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:900});
  await expect(page.locator('.session-card')).toHaveCount(3);
  const projectCard = page.locator('.session-card').filter({hasText:'Project picker'});
  const legacyCard = page.locator('.session-card').filter({hasText:'Simplify the onboarding flow'});
  await expect(legacyCard.locator('.session-branch')).toHaveText('main');
  await expect(page.locator('.session-card').filter({hasText:'Second project'}).locator('.session-branch')).toHaveCount(0);
  execFileSync('git', ['checkout', '-qb', 'feature/sidebar'], {cwd:repo});
  await expect(projectCard.locator('.session-branch')).toHaveText('feature/sidebar', {timeout:10000});
  await expect(legacyCard.locator('.session-branch')).toHaveText('feature/sidebar');
  execFileSync('git', ['checkout', '--detach', '-q'], {cwd:repo});
  await expect(projectCard.locator('.session-branch')).toHaveText(/^Detached · /, {timeout:10000});
  execFileSync('git', ['checkout', '-q', 'main'], {cwd:repo});
  await expect(projectCard.locator('.session-branch')).toHaveText('main', {timeout:10000});
  await page.mouse.move(700, 400);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const metaBefore = await projectCard.locator('.session-project-name').boundingBox();
  await projectCard.hover();
  await page.mouse.move(700, 400);
  await page.waitForTimeout(400);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await projectCard.hover();
  await expect(page.getByRole('tooltip')).toContainText('Project picker');
  expect(await projectCard.locator('.session-project-name').boundingBox()).toEqual(metaBefore);
  await expect(page.getByRole('tooltip')).toContainText('Vulp');
  await expect(page.getByRole('tooltip')).toContainText('main');
  await expect(page.getByRole('tooltip')).toContainText('Codex · Default');
  await page.screenshot({path:path.join(root,'artifacts/sidebar-hover.png')});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await legacyCard.hover();
  await page.getByRole('button',{name:'Pin Simplify the onboarding flow',exact:true}).click();
  await expect(page.locator('.session-list .session-card').first()).toContainText('Simplify the onboarding flow');
  expect(JSON.parse(await readFile(path.join(data, 'state.json'), 'utf8')).threads.find(t=>t.id==='t3').pinned).toBe(true);
  await page.reload();
  await expect(page.locator('.session-list .session-card').first()).toContainText('Simplify the onboarding flow');
  await page.getByRole('button',{name:'Unpin Simplify the onboarding flow',exact:true}).focus();
  await page.getByRole('button',{name:'Unpin Simplify the onboarding flow',exact:true}).click();
  await expect(page.locator('.session-list .session-card').first()).toContainText('Project picker');
  await projectCard.hover();
  await page.getByRole('button',{name:'Settle Project picker',exact:true}).click();
  await expect(page.locator('.session-list .session-card')).toHaveCount(2);
  await page.getByRole('button',{name:'Settled (2)',exact:true}).click();
  await page.getByRole('button',{name:'Restore Project picker',exact:true}).focus();
  await page.getByRole('button',{name:'Restore Project picker',exact:true}).click();
  await page.getByRole('button',{name:'Settled (1)',exact:true}).click();
  await page.getByRole('textbox',{name:'Search threads'}).fill('Second project');
  await expect(page.locator('.session-card')).toHaveCount(1);
  await page.getByRole('button',{name:'Clear thread search'}).click();
  await page.getByRole('button',{name:'Settled (1)',exact:true}).click();
  await expect(page.locator('.session-list .session-card')).toHaveCount(3);
  await expect(page.locator('.settled-list .session-card')).toHaveCount(1);
  await expect(page.locator('.settled-list')).toContainText('Archived exploration');
  const toggleBottom = await page.locator('.settled-toggle').evaluate(el=>el.getBoundingClientRect().bottom);
  expect(await page.locator('.settled-list').evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(toggleBottom);
  await expect(page.locator('.settled-card .session-meta, .settled-card .session-details')).toHaveCount(0);
  await expect(page.locator('.settled-card time')).toHaveText('1d');
  expect(await page.locator('.settled-card').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(40);
  await page.screenshot({path:path.join(root,'artifacts/sidebar-settled-expanded.png')});
  await page.getByRole('button',{name:'Restore Archived exploration',exact:true}).focus();
  await page.getByRole('button',{name:'Restore Archived exploration',exact:true}).click();
  await expect(page.locator('.settled-list .session-card')).toHaveCount(0);
  await page.getByRole('button',{name:'Settled (0)',exact:true}).click();
  await expect(page.locator('.session-card')).toHaveCount(4);
  await page.getByRole('button',{name:'Show projects'}).click();
  await expect(page.locator('.sidebar-projects')).toContainText('Second project');
  await page.getByRole('button',{name:'Show projects'}).click();
  const draft = page.getByRole('textbox',{name:'Message',exact:true});
  await draft.fill('Keep this draft while collapsing.');
  await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(draft).toHaveValue('Keep this draft while collapsing.');
  await page.screenshot({path:path.join(root,'artifacts/sidebar-collapsed.png')});
  await page.reload();
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button',{name:'Expand sidebar',exact:true}).click();
  await expect(page.locator('.sidebar')).toBeVisible();
  for (const theme of ['Dark','Light']) {
    await page.getByRole('button',{name:'Agent settings',exact:true}).click();
    await page.getByRole('button',{name:theme,exact:true}).click();
    await page.getByRole('button',{name:'Back to chat',exact:true}).click();
    await page.screenshot({path:path.join(root,'artifacts/sidebar-'+theme.toLowerCase()+'.png')});
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await projectCard.hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  expect(await page.getByRole('tooltip').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  expect(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'no-preference'});
  for (const width of [850,430]) {
    await page.setViewportSize({width,height:800});
    if(width===430) {
      await page.getByRole('button',{name:'Open sidebar',exact:true}).click();
      await expect.poll(()=>page.locator('.sidebar').evaluate(el=>Math.round(el.getBoundingClientRect().left))).toBe(0);
    }
    await expect(page.locator('.session-card').first()).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    await page.screenshot({path:path.join(root,'artifacts/sidebar-'+width+'.png')});
    await page.locator('.session-card').first().locator('.thread-item').click();
    if(width===430) await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
  console.log('PASS: stable hover layout, cancelled brief hovers, reduced motion, hover metadata and Escape dismissal, direct settle/restore, pin order and disk persistence, compact settled rows below heading, live Git branch changes including legacy threads and detached HEAD, restore via IPC, collapse persistence and draft preservation, project search and controls, light/dark, 850/430 layouts, mobile selection, no renderer errors. Fixture sessions; no live provider run.');
} finally {
  if(app) await app.close();
  await rm(temp,{recursive:true,force:true});
}
