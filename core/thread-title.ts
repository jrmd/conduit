export function normalizeTitle(text: string): string {
  const line = text.trim().split(/\r?\n/).find(line => line.trim()) || "";
  const words = line.replace(/^[#*\s]+/, "").replace(/^["“‘]|["”’]$/g, "").replace(/\*+$/g, "").trim().split(/\s+/).slice(0, 6).join(" ");
  const title = words.length > 48 ? words.slice(0, 47).trimEnd() + "…" : words;
  if (!title) throw new Error("The title provider returned no text");
  return title;
}
