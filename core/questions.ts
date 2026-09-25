import { randomUUID } from 'node:crypto';
import type { Question, QuestionAnswers, QuestionRequest } from '../shared/api';

export class Questions {
  private pending = new Map<string, { request: QuestionRequest; finish: (answers: QuestionAnswers | null) => void }>();
  constructor(private changed: (requests: QuestionRequest[]) => void) {}
  list() { return structuredClone([...this.pending.values()].map(item => item.request)); }
  ask(threadId: string, questions: Question[], signal: AbortSignal): Promise<QuestionAnswers | null> {
    if (signal.aborted) return Promise.resolve(null);
    if (!questions.length || questions.length > 20 || new Set(questions.map(q => q.id)).size !== questions.length) return Promise.reject(new Error('Invalid question request'));
    return new Promise(resolve => {
      const id = randomUUID();
      const abort = () => finish(null);
      const finish = (answers: QuestionAnswers | null) => {
        if (!this.pending.delete(id)) return;
        signal.removeEventListener('abort', abort);
        this.changed(this.list());
        resolve(answers);
      };
      this.pending.set(id, { request: { id, threadId, questions }, finish });
      signal.addEventListener('abort', abort, { once: true });
      this.changed(this.list());
    });
  }
  respond(id: string, threadId: string, answers: QuestionAnswers | null) {
    const pending = this.pending.get(id);
    if (!pending || pending.request.threadId !== threadId) throw new Error('This question is no longer pending');
    if (answers !== null) {
      if (typeof answers !== 'object' || Array.isArray(answers)) throw new Error('Invalid answers');
      for (const q of pending.request.questions) {
        const values = answers[q.id];
        if (!Array.isArray(values) || !values.length || (!q.multiple && values.length !== 1) || values.length > 50 || values.some(v => typeof v !== 'string' || !v.trim() || v.length > 10_000 || (!q.freeText && !q.options.some(o => o.value === v)))) throw new Error('Answer every question');
      }
      if (Object.keys(answers).some(id => !pending.request.questions.some(q => q.id === id))) throw new Error('Unknown question');
    }
    pending.finish(answers);
  }
  clear(threadId: string) { for (const item of this.pending.values()) if (item.request.threadId === threadId) item.finish(null); }
}
