import type { Tender } from "../types.js";

function isoWeek(iso: string): string {
  // "yyyy-Www" — coarse bucket; equal week if within ~7 days.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const oneJan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const days = Math.floor((d.getTime() - oneJan.getTime()) / 86_400_000);
  const week = Math.ceil((days + oneJan.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function canonicalKey(t: Tender): string {
  const org = t.buyer.orgNumber ?? t.buyer.name.toLowerCase();
  const primaryCpv = t.cpvCodes[0] ?? "";
  return `${org}|${primaryCpv}|${isoWeek(t.publishedAt)}`;
}

export function dedupeMerge(ted: Tender[], doffin: Tender[]): Tender[] {
  const seen = new Map<string, Tender>();
  for (const t of ted) seen.set(canonicalKey(t), t);
  for (const t of doffin) {
    const k = canonicalKey(t);
    if (!seen.has(k)) seen.set(k, t);
    // else: TED already there, skip Doffin (TED wins)
  }
  return [...seen.values()];
}
