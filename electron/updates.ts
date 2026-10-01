import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/api';

export function createUpdates(isBusy: () => boolean) {
  let status: UpdateStatus = {state:'idle',version:app.getVersion()};
  let checking: Promise<UpdateStatus> | undefined;
  const supported = app.isPackaged && !process.env.J2CODE_DATA_DIR && (process.platform !== 'linux' || !!process.env.APPIMAGE);
  if (!supported) status = {state:'unsupported',message:process.platform === 'linux' ? 'Run the AppImage to enable automatic updates.' : 'Updates are available in installed builds.'};
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.on('checking-for-update',()=>{status={state:'checking'};});
  autoUpdater.on('update-available',info=>{status={state:'downloading',version:info.version,percent:0};});
  autoUpdater.on('download-progress',progress=>{status={...status,state:'downloading',percent:Math.round(progress.percent)};});
  autoUpdater.on('update-downloaded',info=>{status={state:'ready',version:info.version};});
  autoUpdater.on('update-not-available',()=>{status={state:'current',version:app.getVersion()};});
  autoUpdater.on('error',()=>{status={state:'error',message:'Update unavailable. Check your connection, then retry.'};});
  async function check(): Promise<UpdateStatus> {
    if (!supported || status.state === 'ready' || status.state === 'downloading') return {...status};
    if (checking) return checking;
    status = {state:'checking'};
    checking = (async () => {
      autoUpdater.setFeedURL({provider:'github',owner:'jrmd',repo:'conduit'});
      try { await autoUpdater.checkForUpdates(); }
      catch { status={state:'error',message:'No update could be retrieved. Check your connection and that a release exists.'}; }
      return {...status};
    })().finally(()=>{checking=undefined;});
    return checking;
  }
  function install() {
    if(status.state !== 'ready') throw new Error('No downloaded update is ready');
    if(isBusy()) throw new Error('Finish or stop running agents before restarting to update');
    autoUpdater.quitAndInstall(false,true);
  }
  function start() {
    if(!supported) return;
    const initial=setTimeout(()=>void check(),15000);initial.unref();
    const timer=setInterval(()=>void check(),4*60*60*1000);timer.unref();
    app.once('before-quit',()=>{clearTimeout(initial);clearInterval(timer);});
  }
  return {getStatus:()=>({...status}),check,install,start};
}
