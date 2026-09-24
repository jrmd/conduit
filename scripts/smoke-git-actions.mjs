import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
const root=process.cwd(),temp=await mkdtemp(path.join(tmpdir(),'vulp-git-actions-')),data=path.join(temp,'data'),repo=path.join(temp,'repo');
let app;
try{
 await mkdir(data);await mkdir(repo);execFileSync('git',['init','-b','main'],{cwd:repo});await writeFile(path.join(repo,'hello.txt'),'hello');
 await writeFile(path.join(data,'state.json'),JSON.stringify({projects:[{id:'p',name:'Menu fixture',path:repo,createdAt:Date.now()}],threads:[],disabledProviders:[]}));
 app=await electron.launch({executablePath:path.join(root,process.env.J2CODE_SMOKE_PACKAGED?'release/linux-unpacked/vulp':'node_modules/.bin/electron'),args:[...(process.env.J2CODE_SMOKE_PACKAGED?[]:[root]),`--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,J2CODE_DATA_DIR:data}});
 const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Toggle changes',exact:true}).click();
 const trigger=page.getByRole('button',{name:'Git actions',exact:true});await expect(trigger).toBeEnabled();await trigger.click();
 await expect(page.getByRole('menuitem',{name:'Push branch',exact:true})).toBeDisabled();await expect(page.getByRole('menuitem',{name:/Commit changes/})).toBeDisabled();
 await page.keyboard.press('Escape');await expect(trigger).toBeFocused();await expect(page.getByRole('menu',{name:'Git actions'})).toHaveCount(0);
 await page.locator('.file-check input').check();await trigger.click();await expect(page.getByRole('menuitem',{name:/Commit changes/})).toBeFocused();
 await page.screenshot({path:path.join(root,'artifacts','vulp-git-actions-dark.png')});
 await page.getByRole('menuitem',{name:/Commit changes/}).click();await expect(page.getByRole('heading',{name:'Commit changes',exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await trigger.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await expect(page.getByRole('menuitem',{name:'Create pull request',exact:true})).toBeFocused();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Create pull request',exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await trigger.click();await page.locator('.panel-title').click();await expect(page.getByRole('menu',{name:'Git actions'})).toHaveCount(0);
 await page.getByRole('button',{name:'Agent settings',exact:true}).click();await page.getByRole('button',{name:'Light',exact:true}).click();await page.getByRole('button',{name:'Back to chat',exact:true}).click();await trigger.click();await page.screenshot({path:path.join(root,'artifacts','vulp-git-actions-light.png')});
 expect(await page.locator('.changes-footer').count()).toBe(0);
 console.log('PASS: header actions, selection/upstream guards, Commit and PR dialogs, keyboard navigation, Escape, outside dismissal, light/dark. No commit/push/PR executed.');
}finally{if(app)await app.close();await rm(temp,{recursive:true,force:true})}
