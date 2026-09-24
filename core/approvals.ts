import { randomUUID } from "node:crypto";
import type { ApprovalRequest } from "../shared/api";

/** Pending decisions belong to one live run and never survive its cancellation. */
export class Approvals {
  private pending = new Map<string, { request: ApprovalRequest; finish: (allow: boolean) => void }>();
  constructor(private changed: (requests: ApprovalRequest[]) => void) {}
  list() { return [...this.pending.values()].map(({request}) => ({...request})); }
  ask(threadId: string, title: string, detail: string, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    return new Promise(resolve => {
      const id = randomUUID();
      const abort = () => finish(false);
      const finish = (allow: boolean) => {
        if (!this.pending.delete(id)) return;
        signal.removeEventListener("abort", abort);
        this.changed(this.list());
        resolve(allow);
      };
      this.pending.set(id, {request:{id,threadId,title:title.slice(0,200),detail:detail.slice(0,50000)},finish});
      signal.addEventListener("abort", abort, {once:true});
      this.changed(this.list());
    });
  }
  respond(id: string, threadId: string, allow: boolean) {
    const item = this.pending.get(id);
    if (!item || item.request.threadId !== threadId) throw new Error("This approval is no longer pending");
    item.finish(allow);
  }
  clear(threadId: string) { for (const item of this.pending.values()) if (item.request.threadId === threadId) item.finish(false); }
}
