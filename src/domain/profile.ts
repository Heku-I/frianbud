import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ProfileSchema,
  ProfileDraftSchema,
  type Profile,
  type ProfileDraft,
} from "../types.js";

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
    async advanceDraft(_partial) {
      void ProfileDraftSchema; // referenced below in next tasks
      void deps;
      throw new Error("not implemented");
    },
  };
}
