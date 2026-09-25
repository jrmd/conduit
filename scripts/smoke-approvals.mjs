import {_electron as electron} from "playwright";
import {expect} from "playwright/test";
import {mkdtemp,mkdir,copyFile,chmod,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
const root=process.cwd();const temp=await mkdtemp(path.join(tmpdir(),"vulp-approval-ui-"));let app;
try {
 const data=path.join(temp,"data"),bin=path.join(temp,"bin");await mkdir(data);await mkdir(bin);
 await copyFile("scripts/fixtures/approval-provider.mjs",path.join(bin,"codex"));await chmod(path.join(bin,"codex"),0o755);
 const now=Date.now();await writeFile(path.join(data,"state.json"),JSON.stringify({projects:[{id:"p",name:"Approval checks",path:temp,createdAt:now}],disabledProviders:[],threads:[{id:"t",projectId:"p",provider:"codex",mode:"supervised",title:"Approval test",messages:[{id:"u",role:"user",text:"Fixture conversation",createdAt:now}],createdAt:now,updatedAt:now}]}));
 app=await electron.launch({executablePath:path.join(root,process.env.J2CODE_SMOKE_PACKAGED?"release/linux-unpacked/vulp":"node_modules/.bin/electron"),args:[...(process.env.J2CODE_SMOKE_PACKAGED?[]:[root]),...(process.env.J2CODE_VIRTUAL_DISPLAY?["--ozone-platform=x11","--disable-gpu"]:[]),`--user-data-dir=${path.join(temp,"profile")}`],env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,J2CODE_DATA_DIR:data}});
 const page=await app.firstWindow();const errors=[];page.on("pageerror",error=>errors.push(error.message));await page.setViewportSize({width:1440,height:900});
 const mode=page.getByRole("button",{name:"Approval mode",exact:true});
 for(const [id,label] of [["auto-edits","Auto accept edits"],["auto","Auto"],["full-access","Full access"],["supervised","Supervised"]]) {
  await mode.click();const menu=page.getByRole("dialog",{name:"Choose approval mode"});await expect(menu.getByRole("button")).toHaveCount(4);
  await menu.getByRole("button").filter({has:page.locator("strong",{hasText:new RegExp(`^${label}$`)})}).click();
  await expect(mode).toHaveText(label);await expect.poll(async()=>JSON.parse(await readFile(path.join(data,"state.json"),"utf8")).threads[0].mode).toBe(id);
 }
 await mode.click();await page.screenshot({path:"artifacts/approval-mode-menu.png"});await page.keyboard.press("Escape");
 const message=page.getByRole("textbox",{name:"Message",exact:true});
 for(const action of ["Deny","Allow once","cancel"]){
  await message.fill("Request a fixture action");await message.press("Enter");
  const request=page.getByRole("region",{name:"Approval required"});await expect(request).toBeVisible();await expect(request).toContainText("echo fixture");await expect(mode).toBeDisabled();
  const thought=page.locator(".activity-item").last();await thought.locator("summary").click();await expect(thought.locator("pre")).toHaveText("Checking ");await page.screenshot({path:"artifacts/thinking-stream.png"});
  await page.reload();await expect(request).toBeVisible(); // Pending approvals rehydrate from the main process.
  await page.screenshot({path:"artifacts/approval-request.png"});
  if(action==="cancel") await page.evaluate(()=>window.j2code.cancel("t"));else await request.getByRole("button",{name:action,exact:true}).click();
  await expect(request).toBeHidden();await expect(mode).toBeEnabled();
  if(action!=="cancel") { await expect(page.locator(".message-assistant").last()).toContainText(action==="Deny"?"Denied":"Allowed"); const feed=page.locator(".activity-feed").last();await feed.locator(".activity-toggle").click();await feed.locator("summary").click();await expect(feed.locator("pre")).toHaveText("Checking files"); }
 }
 await page.setViewportSize({width:430,height:800});await mode.click();const box=await page.getByRole("dialog",{name:"Choose approval mode"}).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(430);
 await page.screenshot({path:"artifacts/approval-mode-mobile.png"});expect(errors).toEqual([]);
 console.log("PASS: four modes persist; live IPC approve/deny/cancel; pending request survives renderer reload; running mode lock; mobile menu fits. Provider protocol is a fixture.");
}finally{await app?.close();await rm(temp,{recursive:true,force:true});}
