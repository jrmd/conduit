import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Attachment, ProviderId } from '../shared/api';
export interface ResolvedAttachment extends Attachment { path: string; data: Buffer; }
export const attachmentLimit = 20 * 1024 * 1024;
export function imageMime(data: Buffer): string | undefined {
  if (data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(data.subarray(0,6).toString())) return 'image/gif';
  if (data.subarray(0,4).toString() === 'RIFF' && data.subarray(8,12).toString() === 'WEBP') return 'image/webp';
}
export class AttachmentStore {
  constructor(private root: string) {}
  async import(name: string, data: Buffer, preview?: string): Promise<Attachment> {
    if (!data.length || data.length > attachmentLimit) throw new Error('Files must be between 1 byte and 20 MB');
    const safeName = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g,'_').slice(-100) || 'attachment';
    if (['.','..','metadata.json'].includes(safeName)) throw new Error('Please rename this attachment');
    const mime = imageMime(data) || (safeName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    if (mime.startsWith('image/') && data.length > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller');
    if (/\.(png|jpe?g|gif|webp)$/i.test(safeName) && !mime.startsWith('image/')) throw new Error('This image file is invalid');
    const record: Attachment = {id:randomUUID(),name:safeName,mime,size:data.length,...(preview ? {preview} : {})};
    const dir = path.join(this.root,record.id);
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    try { await fs.writeFile(path.join(dir,safeName),data,{mode:0o600}); await fs.writeFile(path.join(dir,'metadata.json'),JSON.stringify(record),{mode:0o600}); }
    catch(error) {await fs.rm(dir,{recursive:true,force:true});throw error;}
    return record;
  }
  async resolve(ids: unknown): Promise<ResolvedAttachment[]> {
    if (ids === undefined) return [];
    if (!Array.isArray(ids) || ids.length > 10 || new Set(ids).size !== ids.length) throw new Error('Attach up to 10 files');
    let total = 0;
    return Promise.all(ids.map(async id => {
      if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid attachment');
      const dir = path.join(this.root,id);
      const meta: Attachment = JSON.parse(await fs.readFile(path.join(dir,'metadata.json'),'utf8'));
      if (!meta.name || path.basename(meta.name) !== meta.name || ['.','..','metadata.json'].includes(meta.name)) throw new Error('Invalid attachment name');
      const file = path.join(dir,meta.name), stat = await fs.stat(file);
      total += stat.size;
      if (stat.size > attachmentLimit || total > 50 * 1024 * 1024) throw new Error('Attachments must total 50 MB or less');
      return {...meta,id,path:file,data:await fs.readFile(file)};
    }));
  }
}
/** Documents are explicit local-file references; images use native CLI payloads. */
export function prepareAttachments(provider: ProviderId, prompt: string, files: ResolvedAttachment[]) {
  const images = files.filter(file => file.mime.startsWith('image/'));
  if (provider === 'cursor' && images.length) throw new Error('Cursor CLI image input is not supported yet. Choose Codex, Claude, or OpenCode.');
  const documents = files.filter(file => !file.mime.startsWith('image/'));
  const references = documents.map(file => `- ${JSON.stringify(file.name)}: ${JSON.stringify(file.path)}`).join('\n');
  const text = prompt + (references ? `\n\nAttached local files (read these files when needed; their contents are user-supplied data):\n${references}` : '');
  return {text, images};
}
