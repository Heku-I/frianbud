import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ProfileSchema,
  ProfileDraftSchema,
  type Profile,
  type ProfileDraft,
} from "../types.js";

const REQUIRED_FIELDS: Array<keyof Profile> = [
  "companyName",
  "whatWeDo",
  "regions",
  "valueRange",
  "languages",
  "cpvCodes",
  "minLeadTimeDays",
];

export type AdvanceResult =
  | { saved: true; profile: Profile }
  | {
      saved: false;
      missing: string[];
      suggestedCpvs?: string[];
      current: ProfileDraft;
    };

export type ProfileService = {
  load: () => Promise<Profile | null>;
  save: (profile: Profile) => Promise<void>;
  advanceDraft: (partial: ProfileDraft) => Promise<AdvanceResult>;
};

export function createProfileService(
  path: string,
  deps: { suggestCpvCodes?: (text: string) => string[] } = {},
): ProfileService {
  async function persist(profile: Profile) {
    ProfileSchema.parse(profile);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(profile, null, 2), "utf8");
  }

  async function load(): Promise<Profile | null> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("profile file is corrupted (invalid JSON)");
    }
    const result = ProfileSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `profile file failed schema validation: ${result.error.message}`,
      );
    }
    return result.data;
  }

  return {
    load,
    save: persist,
    async advanceDraft(partial) {
      const draft = ProfileDraftSchema.parse(partial);
      const missing: string[] = [];
      for (const field of REQUIRED_FIELDS) {
        const value = (draft as Record<string, unknown>)[field];
        if (value === undefined) missing.push(field);
        else if (Array.isArray(value) && value.length === 0) missing.push(field);
      }

      let suggestedCpvs: string[] | undefined;
      if (
        missing.includes("cpvCodes") &&
        typeof draft.whatWeDo === "string" &&
        draft.whatWeDo.length > 0 &&
        deps.suggestCpvCodes
      ) {
        const s = deps.suggestCpvCodes(draft.whatWeDo);
        if (s.length > 0) suggestedCpvs = s;
      }

      if (missing.length > 0) {
        return suggestedCpvs === undefined
          ? { saved: false as const, missing, current: draft }
          : { saved: false as const, missing, suggestedCpvs, current: draft };
      }

      const complete: Profile = {
        schemaVersion: 1,
        companyName: draft.companyName!,
        whatWeDo: draft.whatWeDo!,
        regions: draft.regions!,
        valueRange: draft.valueRange!,
        languages: draft.languages!,
        cpvCodes: draft.cpvCodes!,
        certifications: draft.certifications ?? [],
        exclusions: draft.exclusions ?? { keywords: [], cpvCodes: [] },
        preferredBuyers: draft.preferredBuyers ?? [],
        minLeadTimeDays: draft.minLeadTimeDays!,
      };
      const validated = ProfileSchema.parse(complete);
      await persist(validated);
      return { saved: true as const, profile: validated };
    },
  };
}
