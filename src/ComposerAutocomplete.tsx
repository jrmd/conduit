import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { FileCode2, Puzzle, Sparkles } from "lucide-react";
import type { ComposerItem, ProviderId } from "../shared/api";

export function useComposerAutocomplete({ value, projectId, provider, input, onChange, onChoose }: {
  value: string; projectId?: string; provider: ProviderId; input: RefObject<HTMLTextAreaElement | null>;
  onChange(value: string): void; onChoose(item: ComposerItem): void;
}) {
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [items, setItems] = useState<ComposerItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState("");
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => { if (pendingCaret.current !== null) { const position = pendingCaret.current; pendingCaret.current = null; input.current?.focus(); input.current?.setSelectionRange(position, position); setCaret(position); } }, [value]);
  const list = useRef<HTMLDivElement>(null);
  const match = /(?:^|\s)([@/$])([^\s@/$]*)$/.exec(value.slice(0, caret));
  // File paths can contain slashes; only the initial character is a trigger.
  const fileMatch = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
  const trigger = fileMatch ? "@" : match?.[1];
  const query = fileMatch ? fileMatch[1] : match?.[2] || "";
  const start = caret - query.length - 1;
  const key = `${projectId}:${provider}:${caret}:${value}`;
  const open = !!projectId && !!trigger && dismissed !== key;
  const kind = trigger === "@" ? "file" : "capability";
  useEffect(() => {
    let current = true;
    setItems([]); setSelected(0); setWarning("");
    if (!open || !projectId) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      window.j2code.getComposerItems(projectId, provider, kind, query).then(result => {
        if (current) { setItems(result.items); setWarning(result.warning || ""); }
      }).catch(error => { if (current) setWarning(String(error)); }).finally(() => { if (current) setLoading(false); });
    }, 120);
    return () => { current = false; clearTimeout(timer); };
  }, [projectId, provider, kind, query, open]);
  useEffect(() => { list.current?.querySelector(`[aria-selected="true"]`)?.scrollIntoView({ block: "nearest" }); }, [selected]);
  function choose(item: ComposerItem) {
    const next = value.slice(0, start) + item.token + " " + value.slice(caret);
    pendingCaret.current = start + item.token.length + 1;
    onChange(next); onChoose(item); setDismissed(key);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") { event.preventDefault(); setDismissed(key); return true; }
    if (["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "ArrowDown") setSelected(index => Math.min(items.length - 1, index + 1));
      else if (event.key === "ArrowUp") setSelected(index => Math.max(0, index - 1));
      else if (items[selected]) choose(items[selected]);
      return true;
    }
    return false;
  }
  return {
    onKeyDown, updateCaret: () => setCaret(input.current?.selectionStart || 0),
    dismiss: () => setDismissed(key),
    aria: { "aria-controls": open ? "composer-suggestions" : undefined, "aria-activedescendant": open && items[selected] ? `suggestion-${selected}` : undefined, "aria-autocomplete": "list" as const },
    menu: open ? <div className="composer-autocomplete" onMouseDown={event => event.preventDefault()}>
      <header><span>{kind === "file" ? "Project files" : "Skills & plugins"}</span><kbd>{trigger}</kbd></header>
      <div id="composer-suggestions" role="listbox" aria-label={kind === "file" ? "Project files" : "Skills and plugins"} ref={list}>
        {items.map((item, index) => { const Icon = item.kind === "file" ? FileCode2 : item.kind === "skill" ? Sparkles : Puzzle; return <button type="button" role="option" id={`suggestion-${index}`} aria-selected={index === selected} key={item.id} onMouseEnter={() => setSelected(index)} onClick={() => choose(item)}><Icon size={16}/><span><strong>{item.name}</strong><small>{item.description}</small></span>{item.kind !== "file" && <em>{item.kind}</em>}</button>; })}
        {!items.length && <p>{loading ? "Looking up available items…" : "No matching items"}</p>}
      </div>
      {warning && <p className="autocomplete-warning">{warning}</p>}
      <footer><span>↑↓ navigate · ↵ select · Esc close</span><span>{kind === "file" ? "/ skills" : "@ files"}</span></footer>
    </div> : null,
  };
}
