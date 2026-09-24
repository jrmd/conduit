import { Children, isValidElement, memo, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';

function plainText(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number'
    ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? plainText(child.props.children) : '').join('');
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const child = Children.toArray(children)[0];
  const language = isValidElement<{ className?: string }>(child)
    ? child.props.className?.replace(/^language-/, '') : undefined;
  async function copy() {
    try { await window.j2code.copyText(plainText(children).replace(/\n$/, '')); setStatus('copied'); }
    catch { setStatus('error'); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), 1800);
  }
  return <div className="code-block"><div className="code-block-header"><span>{language || 'Code'}</span><button onClick={copy} aria-label="Copy code">{status === 'copied' ? <Check size={13}/> : <Copy size={13}/>}<span aria-live="polite">{status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : 'Copy'}</span></button></div><pre>{children}</pre></div>;
}

// Stable component identities keep code controls mounted as streaming text grows.
const components: Components = {
  pre: CodeBlock,
  img: ({ alt }) => <span className="markdown-image">[image: {alt || 'attachment'}]</span>,
  a: ({ href, children }) => /^https:\/\//i.test(href || '')
    ? <a href={href} onClick={event => { event.preventDefault(); void window.j2code.openExternal(href!).catch(console.error); }}>{children}</a>
    : <span>{children}</span>,
};
const plugins = [remarkGfm];
export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={plugins} skipHtml components={components}>{text}</ReactMarkdown>;
});
