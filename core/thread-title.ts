export function normalizeTitle(text: string): string {
  const line = text.trim().split(/\r?\n/).find(line => line.trim()) || "";
  const words = line.replace(/^[#*\s]+/, "").replace(/^["“‘]|["”’]$/g, "").replace(/\*+$/g, "").trim().split(/\s+/).slice(0, 6).join(" ");
  const title = words.length > 48 ? words.slice(0, 47).trimEnd() + "…" : words;
  if (!title) throw new Error("The title provider returned no text");
  return title;
}

/** Keep a subject line plus optional body; drop fences, quotes and chatter around the message. */
export function normalizeCommitMessage(text: string): string {
  let body = text.trim().replace(/^```[\w-]*\n?|\n?```$/g, "").trim();
  body = body.replace(/^(commit message|message)\s*:\s*/i, "").replace(/^["“'`]+|["”'`]+$/g, "").trim();
  const [subject = "", ...rest] = body.split(/\r?\n/);
  const clean = [subject.trim().replace(/\.$/, ""), ...rest].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) throw new Error("The provider returned no commit message");
  return clean.slice(0, 1000);
}
