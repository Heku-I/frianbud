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
    search() {
      throw new Error("not implemented");
    },
    expand() {
      throw new Error("not implemented");
    },
    all() {
      return entries;
    },
  };
}
