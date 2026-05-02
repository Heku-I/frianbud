import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type CpvEntry = {
  code: string;
  label_en: string;
  label_no?: string;
  parent: string | null;
};

export type CpvService = {
  lookup: (code: string) => CpvEntry | undefined;
  search: (text: string, limit?: number) => CpvEntry[];
  expand: (code: string) => { ancestors: CpvEntry[]; descendants: CpvEntry[] };
  all: () => readonly CpvEntry[];
};

export function createCpvService(entries: CpvEntry[]): CpvService {
  const byCode = new Map<string, CpvEntry>();
  for (const e of entries) byCode.set(e.code, e);

  const childrenOf = new Map<string, string[]>();
  for (const e of entries) {
    if (e.parent) {
      const list = childrenOf.get(e.parent) ?? [];
      list.push(e.code);
      childrenOf.set(e.parent, list);
    }
  }

  function collectDescendants(code: string, out: CpvEntry[]) {
    const kids = childrenOf.get(code) ?? [];
    for (const k of kids) {
      const e = byCode.get(k);
      if (e) {
        out.push(e);
        collectDescendants(k, out);
      }
    }
  }

  return {
    lookup(code) {
      return byCode.get(code);
    },
    search(text, limit = 20) {
      const q = text.toLowerCase().trim();
      if (q.length === 0) return [];
      const tokens = q.split(/\s+/);

      const scored: Array<{ entry: CpvEntry; score: number }> = [];
      for (const e of entries) {
        const hay = `${e.label_en} ${e.label_no ?? ""}`.toLowerCase();
        if (!hay.includes(q) && !tokens.every((t) => hay.includes(t))) continue;
        let score = 0;
        if (hay.includes(q)) score += 10;
        score += tokens.filter((t) => hay.includes(t)).length;
        const num = e.code.split("-")[0]!;
        const specificity = num.length - (num.match(/0+$/)?.[0].length ?? 0);
        score += specificity * 0.1;
        scored.push({ entry: e, score });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => s.entry);
    },
    expand(code) {
      const start = byCode.get(code);
      if (!start) return { ancestors: [], descendants: [] };
      const ancestors: CpvEntry[] = [];
      let cur: CpvEntry | undefined = start;
      while (cur?.parent) {
        const p = byCode.get(cur.parent);
        if (!p) break;
        ancestors.push(p);
        cur = p;
      }
      const descendants: CpvEntry[] = [];
      collectDescendants(code, descendants);
      return { ancestors, descendants };
    },
    all() {
      return entries;
    },
  };
}

const here = dirname(fileURLToPath(import.meta.url));

export async function loadBundledCpv(): Promise<CpvService> {
  const path = join(here, "..", "..", "data", "cpv-2008.json");
  const raw = await readFile(path, "utf8");
  const entries = JSON.parse(raw) as CpvEntry[];
  return createCpvService(entries);
}
