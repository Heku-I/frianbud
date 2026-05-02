import type { Tender, Profile, ScoreReason } from "../types.js";

export type ScoreResult = { score: number; reasons: ScoreReason[] };

export function scoreTender(_t: Tender, _p: Profile, _opts?: { now?: Date }): ScoreResult {
  throw new Error("not implemented yet");
}
