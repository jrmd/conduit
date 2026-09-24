import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Folder, Plus, Search } from 'lucide-react';
import type { Project } from '../shared/api';
export function ProjectPicker({projects,current,onSelect,onOpen}: {projects:Project[];current:Project|null;onSelect:(project:Project)=>void;onOpen:()=>void}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    const dismiss=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);root.current?.querySelector('button')?.focus()}};
    window.addEventListener('pointerdown',dismiss);window.addEventListener('keydown',escape);
    return()=>{window.removeEventListener('pointerdown',dismiss);window.removeEventListener('keydown',escape)};
  },[open]);
  return <div className="project-picker" ref={root}>
    <button className="project-picker-trigger" aria-label="Choose project" aria-expanded={open} onClick={()=>{setOpen(!open);setQuery('')}}><Folder size={14}/><span>{current?.name || 'Choose project'}</span><ChevronDown size={12}/></button>
    {open && <div className="project-picker-menu" role="dialog" aria-label="Switch project" onKeyDown={event=>{if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1)+buttons.length)%buttons.length]?.focus();event.preventDefault()}}>
      <label><Search size={14}/><input autoFocus value={query} onChange={event=>setQuery(event.target.value)} placeholder="Find a project…" aria-label="Find a project"/></label>
      <div className="project-picker-list">{projects.filter(p=>`${p.name} ${p.path}`.toLowerCase().includes(query.toLowerCase())).map(p=><button key={p.id} aria-current={p.id===current?.id} onClick={()=>{onSelect(p);setOpen(false)}}><Folder size={14}/><span><strong>{p.name}</strong><small>{p.path}</small></span>{p.id===current?.id&&<Check size={14}/>}</button>)}</div>
      <button className="project-picker-add" onClick={()=>{setOpen(false);onOpen()}}><Plus size={14}/>Open another folder</button>
    </div>}
  </div>;
}
