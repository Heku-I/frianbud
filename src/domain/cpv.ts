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
    expand() {
      throw new Error("not implemented");
    },
    all() {
      return entries;
    },
  };
}
