import { test } from "node:test";
import assert from "node:assert/strict";
import { Approvals } from "./approvals";
import { approvalMode, isThreadMode } from "../shared/approval";
import { codexPermissions } from "./interactive-provider";

test("approval decisions are one-shot, owned by a thread, and cleared on cancellation", async () => {
  const changes: number[]=[]; const approvals=new Approvals(items=>changes.push(items.length));
  const controller=new AbortController();
  const accepted=approvals.ask("one","Command","echo hello",controller.signal);
  const first=approvals.list()[0];
  assert.throws(()=>approvals.respond(first.id,"other",true),/no longer pending/);
  approvals.respond(first.id,"one",true); assert.equal(await accepted,true);
  assert.throws(()=>approvals.respond(first.id,"one",true),/no longer pending/);
  const cancelled=approvals.ask("one","Edit","diff",controller.signal);
  controller.abort();assert.equal(await cancelled,false);assert.equal(approvals.list().length,0);
  assert.equal(await approvals.ask("one","Edit","diff",controller.signal),false);
  assert.deepEqual(changes,[1,0,1,0]);
});

test("all four modes have distinct Codex policies and legacy choices never become full access",()=>{
  assert.equal(approvalMode("read"),"supervised");assert.equal(approvalMode("edit"),"auto-edits");
  assert.deepEqual(codexPermissions("supervised"),{sandbox:"read-only",approvalPolicy:"untrusted",approvalsReviewer:"user"});
  assert.deepEqual(codexPermissions("auto-edits"),{sandbox:"workspace-write",approvalPolicy:"untrusted",approvalsReviewer:"user"});
  assert.deepEqual(codexPermissions("auto"),{sandbox:"workspace-write",approvalPolicy:"on-request",approvalsReviewer:"auto_review"});
  assert.deepEqual(codexPermissions("full-access"),{sandbox:"danger-full-access",approvalPolicy:"never",approvalsReviewer:"user"});
  assert.equal(isThreadMode("full-access"),true);assert.equal(isThreadMode("invalid"),false);
});
