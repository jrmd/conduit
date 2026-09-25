// Opt-in network check against this project's real private GitHub release feed.
import { _electron as electron } from 'playwright';
import { expect } from 'playwright/test';
import { mkdtemp, copyFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
if(process.env.CONDUIT_LIVE_UPDATE_CHECK !== '1') throw new Error('Set CONDUIT_LIVE_UPDATE_CHECK=1 to check the private GitHub release feed');
const temp=await mkdtemp(path.join(tmpdir(),'conduit-update-check-'));
let desktop;
try {
 const env={...process.env,APPIMAGE_EXTRACT_AND_RUN:'1',XDG_CACHE_HOME:path.join(temp,'cache'),APPIMAGE:path.join(temp,'Conduit.AppImage')};delete env.J2CODE_DATA_DIR;
 const version=JSON.parse(await readFile(path.resolve('package.json'),'utf8')).version;
 const image=process.env.CONDUIT_APPIMAGE || path.resolve(`release/Conduit-${version}-linux-x86_64.AppImage`);
 await copyFile(image,env.APPIMAGE);
 desktop=await electron.launch({executablePath:env.APPIMAGE,args:[`--user-data-dir=${path.join(temp,'profile')}`],env});
 const page=await desktop.firstWindow();await expect(page.getByRole('button',{name:'Agent settings',exact:true})).toBeVisible();
 expect(await desktop.evaluate(({app})=>app.getPath('userData'))).toBe(path.join(temp,'profile'));
 const current=await page.evaluate(()=>window.j2code.checkForUpdates());expect(current.state).toBe('current');
 console.log(`PASS: real private GitHub feed authenticated through gh; installed version ${current.version} is current.`);
 if(process.env.CONDUIT_TEST_UPDATE_DOWNLOAD==='1') {
  // Simulate an older installed version, leaving production version and files untouched.
  await desktop.evaluate(async({app})=>{const {createRequire}=process.getBuiltinModule('node:module');const require=createRequire(app.getAppPath()+'/package.json');const {autoUpdater}=require('electron-updater');autoUpdater.currentVersion=new autoUpdater.currentVersion.constructor('0.0.1');autoUpdater.disableDifferentialDownload=true;});
  await page.evaluate(()=>window.j2code.checkForUpdates());
  await expect.poll(async()=>page.evaluate(()=>window.j2code.getUpdateStatus()),{timeout:120000,intervals:[1000,2000,4000]}).toMatchObject({state:'ready',version:current.version});
  console.log('PASS: real release asset downloaded and checksum-verified into an isolated cache. Older version was simulated; no installation or restart was requested.');
 }
}finally{if(desktop)await desktop.close();await rm(temp,{recursive:true,force:true})}
