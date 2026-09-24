import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ComposerItem, ProviderId } from '../shared/api';
const exec = promisify(execFile);
async function command(bin: string, args: string[], cwd: string) {
 return (await exec(bin,args,{cwd,encoding:'utf8',timeout:12000,maxBuffer:8_000_000,windowsHide:true})).stdout;
}
function inside(root: string, target: string) { const rel=path.relative(root,target);return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); }
export async function projectFiles(cwd: string): Promise<ComposerItem[]> {
 let paths: string[];
 try { paths=(await command('git',['ls-files','--cached','--others','--exclude-standard','-z','--','.'],cwd)).split('\0'); }
 catch { paths=(await command('rg',['--files','--hidden','-g','!.git','-g','!node_modules','-g','!dist','-0'],cwd)).split('\0'); }
 const root=await fs.realpath(cwd),items:ComposerItem[]=[];
 for(const name of [...new Set(paths)].filter(Boolean).slice(0,12000)) {
  if(/[\r\n]/.test(name))continue;
  const file=path.resolve(cwd,name);if(!inside(cwd,file))continue;
  // Do not expose symlinks leading outside the selected project.
  try { if(!inside(root,await fs.realpath(file)) || !(await fs.stat(file)).isFile())continue; } catch {continue;}
  items.push({id:`file:${name}`,kind:'file',name,description:path.dirname(name)==='.'?'Project file':path.dirname(name),token:`@${/\s/.test(name)?JSON.stringify(name):name}`,path:file});
 }
 return items;
}
async function skills(root: string, provider: ProviderId, plugin?: string): Promise<ComposerItem[]> {
 const items:ComposerItem[]=[],seen=new Set<string>();let visited=0;
 async function visit(directory:string,depth:number) {
  if(depth>6 || visited++>2000)return;
  let real:string;try{real=await fs.realpath(directory);if(seen.has(real))return;seen.add(real);}catch{return;}
  const file=path.join(directory,'SKILL.md');
  try {
   const stat=await fs.stat(file);if(stat.size>100000)return;
   const text=await fs.readFile(file,'utf8');const front=/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] || '';
   if(/^user-invocable:\s*false\s*$/m.test(front))return;
   const value=(key:string)=>new RegExp(`^${key}:\\s*["']?([^\\r\\n]+?)["']?\\s*$`,'m').exec(front)?.[1]?.trim();
   const name=value('name') || path.basename(directory),qualified=plugin?`${plugin}:${name}`:name;
   if(!/^[\w.:-]+$/.test(qualified))return;
   items.push({id:`skill:${file}`,kind:'skill',name:qualified,description:(value('description') || 'Local skill').slice(0,220),token:`${provider==='codex'?'$':'/'}${qualified}`,path:file});return;
  }catch{/* Not a skill root. */}
  for(const entry of await fs.readdir(directory,{withFileTypes:true}).catch(()=>[]))if(entry.isDirectory() || entry.isSymbolicLink())await visit(path.join(directory,entry.name),depth+1);
 }
 await visit(root,0);return items;
}
export async function capabilities(cwd:string,provider:ProviderId):Promise<{items:ComposerItem[];warning?:string}> {
 const home=os.homedir(),codex=process.env.CODEX_HOME || path.join(home,'.codex');
 const folders=provider==='codex'?['.agents/skills','.codex/skills']:provider==='claude'?['.claude/skills']:provider==='cursor'?['.agents/skills','.cursor/skills']:['.opencode/skills','.claude/skills','.agents/skills'];
 const roots=folders.flatMap(folder=>[path.join(cwd,folder),path.join(home,folder)]);
 if(provider==='codex')roots.push(path.join(codex,'skills'),'/etc/codex/skills');
 if(provider==='opencode')roots.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home,'.config'),'opencode/skills'));
 // Include parent project scopes only as far as the worktree root.
 const gitRoot=await command('git',['rev-parse','--show-toplevel'],cwd).then(s=>s.trim(),()=>cwd);
 for(let parent=path.dirname(cwd);inside(gitRoot,parent)&&parent!==cwd;parent=path.dirname(parent)){
  roots.push(...folders.map(folder=>path.join(parent,folder)));if(parent===gitRoot||parent===path.dirname(parent))break;
 }
 const items=(await Promise.all([...new Set(roots)].map(root=>skills(root,provider)))).flat();let warning:string|undefined;
 if(provider==='codex'||provider==='claude') {
  try {
   const data=JSON.parse(await command(provider,['plugin','list','--json'],cwd));
   const plugins=provider==='codex'?data.installed:Array.isArray(data)?data:data.installed || [];
   for(const plugin of plugins){
    if(plugin.enabled!==true || plugin.installed===false)continue;
    const name=plugin.name || String(plugin.id || plugin.pluginId || '').split('@')[0];if(!/^[\w.-]+$/.test(name))continue;
    items.push({id:`plugin:${name}`,kind:'plugin',name,description:'Enabled CLI plugin',token:`@plugin:${name}`});
    const directory=plugin.installPath || plugin.path || (plugin.source?.source==='local'?plugin.source.path:undefined);
    if(directory)items.push(...await skills(path.join(directory,'skills'),provider,name));
    // Codex registry source can be a marketplace reference; its active version is cached here.
    if(provider==='codex' && plugin.marketplaceName && plugin.version)items.push(...await skills(path.join(codex,'plugins/cache',plugin.marketplaceName,name,plugin.version,'skills'),provider,name));
   }
  } catch {warning='Plugin discovery failed. Check the CLI installation/sign-in; local skills are still listed.';}
 }else warning='Local skills are listed. This CLI does not expose a supported installed-plugin catalogue here.';
 return {items:[...new Map(items.map(item=>[item.id,item])).values()],warning};
}
const cache=new Map<string,{expires:number;value:{items:ComposerItem[];warning?:string}}>();
export async function composerItems(cwd:string,provider:ProviderId,kind:'file'|'capability',query:string) {
 const key=`${cwd}:${provider}:${kind}`;let cached=cache.get(key);
 if(!cached||cached.expires<Date.now()){
  const value=kind==='file'?{items:await projectFiles(cwd)}:await capabilities(cwd,provider);
  if(cache.size>30)cache.clear();cached={expires:Date.now()+15000,value};cache.set(key,cached);
 }
 const q=query.toLowerCase();return { ...cached.value,items:cached.value.items.filter(item=>`${item.name} ${item.description}`.toLowerCase().includes(q)).sort((a,b)=>Number(b.name.toLowerCase().startsWith(q))-Number(a.name.toLowerCase().startsWith(q))||a.name.localeCompare(b.name)).slice(0,40) };
}
export async function resolveReferences(cwd:string,provider:ProviderId,ids:string[],prompt:string) {
 if(!ids.length)return '';
 if(ids.length>30)throw new Error('Choose up to 30 references');
 const available=[...(ids.some(id=>id.startsWith('file:'))?await projectFiles(cwd):[]),...(ids.some(id=>!id.startsWith('file:'))?(await capabilities(cwd,provider)).items:[])];
 const lines:string[]=[];
 for(const id of new Set(ids)){
  const item=available.find(item=>item.id===id);if(!item)throw new Error('A selected file or skill is no longer available. Remove it and select it again.');
  if(!prompt.includes(item.token))continue;
  lines.push(item.kind==='file'?`Referenced project file: ${JSON.stringify(item.name)}.`:item.kind==='skill'?`Explicitly selected skill ${JSON.stringify(item.name)}: read and follow ${JSON.stringify(item.path)}.`:`Explicitly selected enabled plugin: ${JSON.stringify(item.name)}. Use its available capabilities for this request.`);
 }
 return lines.length?'\n\nSelected context:\n'+lines.join('\n'):'';
}
