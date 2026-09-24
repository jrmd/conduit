import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root=process.cwd(), temp=await mkdtemp(path.join(tmpdir(),'vulp-appearance-'));
const data=path.join(temp,'data'), project=path.join(temp,'project');
await mkdir(data);await mkdir(project);
let app,page;
async function launch(){
 const packaged=process.env.J2CODE_SMOKE_PACKAGED;
 app=await electron.launch({executablePath:path.join(root,packaged?'release/linux-unpacked/vulp':'node_modules/.bin/electron'),args:[...(packaged?[]:[root]),`--user-data-dir=${path.join(temp,'profile')}`],env:{...process.env,J2CODE_DATA_DIR:data}});
 page=await app.firstWindow();await expect(page.getByRole('heading',{name:'Open a project',exact:true})).toBeVisible();
 await page.setViewportSize({width:1440,height:900});
}
async function shader(mode){
 await expect.poll(()=>page.locator('.new-thread-shader').evaluate(canvas=>{const gl=canvas.getContext('webgl2'),p=gl?.getParameter(gl.CURRENT_PROGRAM);return p?gl.getUniform(p,gl.getUniformLocation(p,'uLightMode')):null})).toBe(mode);
}
async function aligned(name){
 const offset=await page.getByRole('button',{name,exact:true}).evaluate(button=>{
  const icon=button.querySelector('svg').getBoundingClientRect();
  const text=Array.from(button.childNodes).find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim());
  const range=document.createRange();range.selectNode(text);const label=range.getBoundingClientRect();
  return Math.abs(icon.y+icon.height/2-label.y-label.height/2);
 });expect(offset).toBeLessThan(3);
}
try{
 await launch();await aligned('Open folder');
 await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');await shader(1);
 await page.screenshot({path:path.join(root,'artifacts','vulp-open-project-light.png')});
 await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await shader(0);
 await page.screenshot({path:path.join(root,'artifacts','vulp-open-project-dark.png')});
 await page.getByRole('button',{name:'Agent settings',exact:true}).click();await aligned('Back to chat');await page.getByRole('tab',{name:'Agents',exact:true}).click();await aligned('Refresh discovery');await page.getByRole('tab',{name:'Appearance',exact:true}).click();
 await expect(page.getByRole('button',{name:'System',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Light',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 expect(await app.evaluate(({nativeTheme})=>nativeTheme.themeSource)).toBe('light');
 await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.screenshot({path:path.join(root,'artifacts','vulp-settings-light.png')});
 await app.close();app=null;await launch();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await shader(1);
 await page.getByRole('button',{name:'Agent settings',exact:true}).click();await expect(page.getByRole('button',{name:'Light',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Dark',exact:true}).click();await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.getByRole('button',{name:'System',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 expect(await app.evaluate(({nativeTheme})=>nativeTheme.themeSource)).toBe('system');
 await page.getByRole('button',{name:'Back to chat',exact:true}).click();await shader(1);
 await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]})},project);
 await page.getByRole('button',{name:'Open folder',exact:true}).click();await expect(page.getByTestId('model-selector')).toBeVisible();await shader(1);
 await page.getByTestId('model-selector').click();await page.screenshot({path:path.join(root,'artifacts','vulp-models-light.png')});await page.keyboard.press('Escape');
 await page.setViewportSize({width:850,height:600});await page.screenshot({path:path.join(root,'artifacts','vulp-new-thread-light-850.png')});
 console.log('PASS: empty-project shader in both themes, icon/text centerlines, system changes, explicit overrides, native theme, saved preference after restart, new-project shader and light model picker.');
}finally{if(app)await app.close();await rm(temp,{recursive:true,force:true})}
