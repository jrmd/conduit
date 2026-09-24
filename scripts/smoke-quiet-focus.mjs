import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
  app = await electron.launch({executablePath:path.join(root,process.env.J2CODE_SMOKE_PACKAGED?'release/linux-unpacked/vulp':'node_modules/.bin/electron'),args:[...(process.env.J2CODE_SMOKE_PACKAGED?[]:[root]),`--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,J2CODE_DATA_DIR:data}});
  const page = await app.firstWindow(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Agent settings',exact:true}).click();
  await page.getByRole('button',{name:'Light',exact:true}).click();
  await page.getByRole('button',{name:'Back to chat',exact:true}).click();
  await page.getByRole('button',{name:'Select model',exact:true}).click();
  const picker = page.getByRole('dialog',{name:'Choose a model'});
  await expect(picker.getByRole('group',{name:'Model filters'}).getByRole('button')).toHaveCount(2); // Favourites + locked Codex provider.
  await picker.getByRole('button',{name:'Favourite Codex CLI default',exact:true}).click();
  await expect(picker).toBeVisible();
  await picker.getByRole('button',{name:'Favourites',exact:true}).click();
  await expect(picker.locator('.model-choice')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button',{name:'Select model',exact:true}).click();
  await picker.getByRole('button',{name:'Favourites',exact:true}).click();
  await expect(picker.getByRole('button',{name:'Unfavourite Codex CLI default',exact:true})).toHaveAttribute('aria-pressed','true');
  expect(await picker.locator('.model-provider-filters button>svg').evaluateAll(nodes=>nodes.every(node=>Math.abs(parseFloat(getComputedStyle(node).width)-16)<0.1 && Math.abs(parseFloat(getComputedStyle(node).height)-16)<0.1))).toBe(true);
  await page.screenshot({path:path.join(root,'artifacts/model-picker-implemented.png')});
  await picker.getByRole('button',{name:'Unfavourite Codex CLI default',exact:true}).click();
  await expect(picker).toContainText('Star models in a provider tab');
  await picker.getByRole('button',{name:'Codex',exact:true}).click();
  await picker.locator('.model-choice').filter({hasText:'CLI default'}).click();
  await expect(picker).toBeHidden();
  const composer = page.getByRole('textbox',{name:'Message',exact:true});
  await composer.fill('Keep this draft while reviewing.');
  await page.getByRole('button',{name:'Toggle changes',exact:true}).click();
  await page.locator('.file-open').filter({hasText:'picker.ts'}).click();
  await expect(page.locator('.diff-content')).toContainText('Find a project');
  await page.locator('.file-check input').check();
  await page.getByRole('group',{name:'Review view'}).getByRole('button',{name:'Activity',exact:true}).click();
  await page.locator('.review-activity .activity-toggle').click();
  await expect(page.locator('.review-activity')).toContainText('Read project picker');
  await page.getByRole('group',{name:'Review view'}).getByRole('button',{name:/Files/}).click();
  await expect(page.locator('.file-check input')).toBeChecked();
  await expect(page.locator('.diff-content')).toContainText('Find a project');
  await page.screenshot({path:path.join(root,'artifacts/quiet-focus-app-review.png')});
  await page.getByRole('button',{name:'Close changes',exact:true}).click();
  await expect(composer).toHaveValue('Keep this draft while reviewing.');
  for (const width of [850,430]) {
    await page.setViewportSize({width,height:800});
    await page.getByRole('button',{name:'Toggle changes',exact:true}).click();
    await expect(page.locator('.diff-content')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth)).toBe(false);
    if(width === 430) await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    await page.screenshot({path:path.join(root,`artifacts/quiet-focus-app-${width}.png`)});
    await page.getByRole('button',{name:'Close changes',exact:true}).click();
    await expect(composer).toHaveValue('Keep this draft while reviewing.');
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Toggle changes',exact:true}).click();
  await page.getByRole('button',{name:'New thread',exact:true}).click();
  await expect(page.getByRole('button',{name:'Toggle changes',exact:true})).toHaveCount(0);
  await expect(page.getByRole('complementary',{name:'Review changes'})).toHaveCount(0);
  await expect(page.locator('.new-thread-shader')).toBeVisible();
  await expect.poll(()=>page.locator('.new-thread-shader').evaluate(canvas=>!!canvas.getContext('webgl2')?.getParameter(canvas.getContext('webgl2').CURRENT_PROGRAM))).toBe(true);
  await expect(page.locator('.starter-prompts')).toHaveCount(0);
  await page.getByRole('button',{name:'Select model',exact:true}).click();
  await expect(picker).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const menu = document.querySelector('.model-menu');
    const heading = document.querySelector('.new-thread-heading');
    const a = menu.getBoundingClientRect(), b = heading.getBoundingClientRect();
    const left = Math.max(a.left,b.left), right = Math.min(a.right,b.right);
    const top = Math.max(a.top,b.top), bottom = Math.min(a.bottom,b.bottom);
    return right > left && bottom > top && menu.contains(document.elementFromPoint((left+right)/2,(top+bottom)/2));
  })).toBe(true);
  await page.screenshot({path:path.join(root,'artifacts/new-thread-picker-layering.png')});
  await page.getByRole('button',{name:'Select model',exact:true}).click();

  await expect(page.locator('.empty-conversation').getByRole('heading',{name:/What should we build in/})).toBeVisible();
  await page.getByRole('button',{name:'Switch project from Vulp',exact:true}).click();
  await page.getByRole('dialog',{name:'Switch project'}).getByRole('button',{name:/Second project/}).click();
  await expect(page.getByRole('button',{name:'Switch project from Second project',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Switch project from Second project',exact:true}).click();
  await page.getByRole('dialog',{name:'Switch project'}).getByRole('button',{name:/Vulp/}).click();
  await page.screenshot({path:path.join(root,'artifacts/quiet-focus-app-new-thread.png')});
  await page.getByRole('button',{name:'Agent settings',exact:true}).click();
  const tabs = page.getByRole('tablist',{name:'Settings sections'});
  await tabs.getByRole('tab',{name:'Agents',exact:true}).click();
  await expect(page.getByRole('switch',{name:'Enable Codex'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Light',exact:true})).toBeHidden();
  await tabs.getByRole('tab',{name:'Thread titles',exact:true}).click();
  await expect(page.getByLabel('Title provider',{exact:true})).toBeVisible();
  await tabs.getByRole('tab',{name:'Updates',exact:true}).click();
  await expect(page.getByRole('button',{name:'Check for updates',exact:true})).toBeVisible();
  await page.screenshot({path:path.join(root,'artifacts/quiet-focus-settings-tabs.png')});
  await tabs.getByRole('tab',{name:'Updates',exact:true}).press('Home');
  await expect(tabs.getByRole('tab',{name:'Appearance',exact:true})).toBeFocused();
  await expect(page.getByRole('tabpanel',{name:'Appearance',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Dark',exact:true}).click();
  await page.getByRole('button',{name:'Back to chat',exact:true}).click();
  await page.screenshot({path:path.join(root,'artifacts/quiet-focus-app-dark.png')});
  await page.setViewportSize({width:430,height:800});
  await expect(composer).toBeVisible();
  await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
  await page.screenshot({path:path.join(root,'artifacts/quiet-focus-new-thread-430.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({width:1440,height:900});
  await expect(page.getByRole('button',{name:'Toggle changes',exact:true})).toHaveCount(0);
  await expect(page.getByRole('complementary',{name:'Review changes'})).toHaveCount(0);
  await expect(page.locator('.topbar .branch-pill')).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log('PASS: real Git diff, review tabs, selected files and draft preserved, 1440/850/430 layouts, live WebGL new-thread program, new-thread header has no Changes or branch, no renderer errors. Agent content is fixture data.');
} finally {
  if(app) await app.close();
  await rm(temp,{recursive:true,force:true});
}
