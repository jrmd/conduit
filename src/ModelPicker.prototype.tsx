// Throwaway comparison: three model pickers on /?picker-sketch&variant=A.
// Sample catalogues; all selection is in memory and no provider is invoked.
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, Folder, Plus, Search, Settings2, Star, X } from 'lucide-react';
import { SimpleIconsOpenai } from './icons/openai';
import { SimpleIconsClaude } from './icons/claude';
import { SimpleIconsOpencode } from './icons/opencode';
import { JrmdShader } from './JrmdShader.webgl';
import './ModelPicker.prototype.css';
const providers = ['Codex', 'Claude Code', 'OpenCode'] as const;
type Provider = typeof providers[number];
const icons = {Codex:SimpleIconsOpenai, 'Claude Code':SimpleIconsClaude, OpenCode:SimpleIconsOpencode};
const models = ['CLI default', 'GPT-6-Astra', 'GPT-6-Sol', 'GPT-6-Luna', 'GPT-5.6-Sol', 'GPT-5.6-Terra', 'GPT-5.6-Luna'];
const titles = ['Quick switch', 'Provider first', 'Provider tabs'];
const descriptions = [
  'One searchable list across providers. Recent choices first; model IDs stay out of the way.',
  'Pick a provider from the dropdown, then a model. A small menu with one job at a time.',
  'The star tab collects favourite models across providers. Each provider keeps its full model list.',
];
type Choice = {provider:Provider; model:string};
const idFor = (model:string) => model === 'CLI default' ? 'CLI default' : model.toLowerCase();
export function ModelPickerSketch() {
 const initial = new URLSearchParams(location.search).get('variant');
 const [variant,setVariant] = useState(['A','B','C'].includes(initial || '') ? initial! : 'A');
 const [dark,setDark] = useState(true);
 const [open,setOpen] = useState(true);
 const [query,setQuery] = useState('');
 const [favouritesTab,setFavouritesTab] = useState(false);
 const [provider,setProvider] = useState<Provider>('Codex');
 const [choice,setChoice] = useState<Choice>({provider:'Codex',model:'GPT-6-Luna'});
 const [preview,setPreview] = useState<Choice>(choice);
 const [recent,setRecent] = useState<Choice[]>([{provider:'Codex',model:'GPT-6-Luna'},{provider:'Codex',model:'GPT-6-Sol'}]);
 const [favourites,setFavourites] = useState<Choice[]>([{provider:'Codex',model:'GPT-6-Luna'},{provider:'Codex',model:'GPT-6-Sol'}]);
 const isFavourite = (model:string,p:Provider) => favourites.some(c=>c.model===model&&c.provider===p);
 const toggleFavourite = (model:string,p:Provider) => setFavourites(items=>items.some(c=>c.model===model&&c.provider===p)?items.filter(c=>c.model!==model||c.provider!==p):[...items,{model,provider:p}]);
 const [context,setContext] = useState(false);
 const index = ['A','B','C'].indexOf(variant);
 const Icon = icons[choice.provider];
 const ProviderIcon = icons[provider];
 const PreviewIcon = icons[preview.provider];
 const select = (next:Choice) => {setChoice(next);setRecent([next,...recent.filter(c=>c.model!==next.model||c.provider!==next.provider)].slice(0,3));setOpen(false);};
 const cycle = (by:number) => {setVariant(['A','B','C'][(index+by+3)%3]);setQuery('');setOpen(true);};
 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';},[dark]);
 useEffect(()=>{const url=new URL(location.href);url.searchParams.set('variant',variant);history.replaceState(null,'',url);},[variant]);
 useEffect(()=>{const handler=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);return;}if((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();cycle(e.key==='ArrowLeft'?-1:1);}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[variant]);
 const matches=(model:string,p:Provider)=>`${p} ${model} ${idFor(model)}`.toLowerCase().includes(query.toLowerCase());
 const catalogue=(p:Provider)=>p==='Codex'?models:['CLI default'];
 const search=<label className="mp-search"><Search size={15}/><input aria-label="Find a model" placeholder={variant==='A'?'Search models and providers…':'Find a model…'} value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="Clear search" onClick={()=>setQuery('')}><X size={13}/></button>}</label>;
 const row=(model:string,p:Provider,inspect=false)=>{const RowIcon=icons[p];const selected=inspect?preview.model===model&&preview.provider===p:choice.model===model&&choice.provider===p;return <div className={`mp-model-row ${selected?'selected':''}`} key={`${p}-${model}`}><button className={`mp-row ${selected?'selected':''}`} onClick={()=>inspect?setPreview({provider:p,model}):select({provider:p,model})} title={`${p} · ${idFor(model)}`}><RowIcon width={15} height={15}/><span>{model}{p!==provider&&<small className="mp-cross-provider">{p}</small>}</span>{selected&&<Check size={14}/>}</button>{variant==='C'&&<button className={`mp-star ${isFavourite(model,p)?'starred':''}`} aria-label={`${isFavourite(model,p)?'Unfavourite':'Favourite'} ${p} ${model}`} aria-pressed={isFavourite(model,p)} onClick={()=>toggleFavourite(model,p)}><Star size={13} fill={isFavourite(model,p)?'currentColor':'none'}/></button>}</div>;};
 return <div className="mp-page">
  <header className="mp-design-header"><div><b>Model picker sketches</b><small>Sample catalogue · selection does not run an agent</small></div><div><button onClick={()=>setContext(!context)}>{context?'Show new thread':'Show conversation'}</button><button onClick={()=>setDark(!dark)}>{dark?'Light':'Dark'}</button></div></header>
  <div className="mp-stage quiet-focus app-shell">
   <aside className="sidebar"><div className="sidebar-top"><div className="brand"><img className="vulp-brand-logo" src="./vulp-logo.jpg" alt=""/><span>vulp</span></div></div><div className="sidebar-content"><button className="new-thread-button" onClick={()=>setContext(false)}><Plus size={15}/>New thread</button><div className="mp-side-search"><Search size={13}/>Search threads</div><div className="mp-project"><ChevronDown size={12}/><Folder size={14}/>Vulp</div>{['Model picker','Composer spacing','Image attachments'].map((t,i)=><button className={`mp-thread ${i===0?'active':''}`} key={t} onClick={()=>setContext(true)}>{t}<small>{['now','2h','1d'][i]}</small></button>)}</div><div className="mp-side-footer"><Settings2 size={13}/>Settings</div></aside>
   <main className="main-area"><div className="mp-app-header">{context?'Vulp  /  Model picker':''}<span>main</span></div><div className="mp-workspace">{!context&&<div className="mp-art"><JrmdShader theme={dark?'dark':'light'}/></div>}{context?<div className="mp-messages"><p className="mp-user">Let’s simplify the model picker.</p><b>Codex</b><p>I’ll keep the model name visible and put the provider controls where they’re easier to find.</p></div>:<h1>What should we build in <u>Vulp</u>?</h1>}
   <div className="mp-composer"><textarea aria-label="Sample message" placeholder="Ask anything… @ files · / skills & plugins"/><div className="mp-controls"><span>＋</span><div className="mp-anchor"><button className="mp-trigger" aria-expanded={open} onClick={()=>{setOpen(!open);setQuery('');setPreview(choice);}}><Icon width={16} height={16}/>{choice.model}<ChevronDown size={12}/></button>
   {open&&<div className={`mp-picker mp-variant-${variant}`} role="dialog" aria-label={`${titles[index]} picker`}>
    {variant==='A'&&<>{search}<div className="mp-scroll">{!query&&<><div className="mp-section-title">Recent</div>{recent.map(c=>row(c.model,c.provider))}</>}{providers.map(p=><section key={p}>{catalogue(p).some(m=>matches(m,p))&&<div className="mp-section-title">{p}</div>}{catalogue(p).filter(m=>matches(m,p)).map(m=>row(m,p))}</section>)}{!providers.some(p=>catalogue(p).some(m=>matches(m,p)))&&<p className="mp-empty">No matching models.</p>}</div><div className="mp-menu-footer">Choose a model to return to your message</div></>}
    {variant==='B'&&<><div className="mp-provider-select"><ProviderIcon width={19} height={19}/><label>Provider<select aria-label="Provider" value={provider} onChange={e=>{setProvider(e.target.value as Provider);setQuery('');}}>{providers.map(p=><option key={p}>{p}</option>)}</select></label></div>{search}<div className="mp-scroll">{catalogue(provider).filter(m=>matches(m,provider)).map(m=>row(m,provider))}{!catalogue(provider).some(m=>matches(m,provider))&&<p className="mp-empty">No matching models.</p>}</div><div className="mp-menu-footer"><span>{provider}</span><span>{catalogue(provider).length} options</span></div></>}
    {variant==='C'&&<>{search}<div className="mp-split"><div className="mp-browse"><div className="mp-provider-tabs" role="group" aria-label="Provider filter"><button aria-label="Favourites" title="Favourites" aria-pressed={favouritesTab} onClick={()=>setFavouritesTab(true)}><Star size={16}/></button>{providers.map(p=>{const TabIcon=icons[p];return <button key={p} aria-label={p} title={p} aria-pressed={!favouritesTab&&provider===p} onClick={()=>{setFavouritesTab(false);setProvider(p);}}><TabIcon width={16} height={16}/></button>;})}</div><div className="mp-scroll">
      {favouritesTab ? <>
      {favourites.filter(c=>matches(c.model,c.provider)).map(c=>row(c.model,c.provider))}
      {!favourites.length&&<p className="mp-favourite-empty">Star a model to keep it here.</p>}
      {!!favourites.length&&!favourites.some(c=>matches(c.model,c.provider))&&<p className="mp-favourite-empty">No matching favourites.</p>}
      </> : <>
      {catalogue(provider).filter(m=>matches(m,provider)).map(m=>row(m,provider))}
      {!catalogue(provider).some(m=>matches(m,provider))&&<p className="mp-empty">No matching models.</p>}</>}
     </div></div></div></> }
   </div>}
   </div><span>High effort</span><span className="mp-permissions">Read only</span><span className="mp-send"><ArrowUp size={15}/></span></div></div>
   </div></main>
  </div>
  <footer className="mp-design-footer"><div><b>{titles[index]}</b><p>{descriptions[index]}</p><small>Selected: {choice.provider} / {choice.model} · {open?'Picker open':'Picker closed'} · {favourites.length} favourite models · memory only</small></div><div className="mp-switcher"><button aria-label="Previous design" onClick={()=>cycle(-1)}><ArrowLeft size={17}/></button><span>{variant} <b>{titles[index]}</b><small>{index+1}/3</small></span><button aria-label="Next design" onClick={()=>cycle(1)}><ArrowRight size={17}/></button></div></footer>
 </div>;
}
