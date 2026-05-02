import type { Tender, Profile, ScoreReason } from "../types.js";

export type Signal = (tender: Tender, profile: Profile, opts?: { now?: Date }) => ScoreReason;

function cpv4(code: string): string {
  // First 4 digits, e.g. "90910000-9" -> "9091"
  return code.split("-")[0]!.slice(0, 4);
}

export const cpvOverlapSignal: Signal = (tender, profile) => {
  const profileSet = new Set(profile.cpvCodes);
  const profilePrefixSet = new Set(profile.cpvCodes.map(cpv4));
  if (tender.cpvCodes.length === 0) {
    return { signal: "cpv_overlap", contribution: 0, detail: "no CPVs on tender" };
  }
  let weighted = 0;
  let weightSum = 0;
  for (let i = 0; i < tender.cpvCodes.length; i++) {
    const w = i === 0 ? 2 : 1; // primary weighted double
    weightSum += w;
    const code = tender.cpvCodes[i]!;
    if (profileSet.has(code)) weighted += w;
    else if (profilePrefixSet.has(cpv4(code))) weighted += w * 0.5;
  }
  const fraction = weightSum === 0 ? 0 : weighted / weightSum;
  const contribution = Math.round(fraction * 35);
  return {
    signal: "cpv_overlap",
    contribution,
    detail: `${Math.round(fraction * 100)}% CPV match`,
  };
};

export const regionMatchSignal: Signal = (tender, profile) => {
  const set = new Set(profile.regions);
  const matched = tender.regions.filter((r) => set.has(r));
  if (matched.length > 0) {
    return {
      signal: "region_match",
      contribution: 20,
      detail: `region ${matched.join(", ")} in profile`,
    };
  }
  return { signal: "region_match", contribution: 0, detail: "no region overlap" };
};

// v1: binary in/out-of-band scoring. Partial credit near the edges may be added
// later if golden tests show it materially improves ranking quality.
export const valueInRangeSignal: Signal = (tender, profile) => {
  const v = tender.estimatedValue;
  if (!v) {
    return { signal: "value_in_range", contribution: 0, detail: "no estimated value" };
  }
  if (v.currency !== profile.valueRange.currency) {
    return { signal: "value_in_range", contribution: 0, detail: "currency mismatch" };
  }
  const { min, max } = profile.valueRange;
  if (v.amount >= min && v.amount <= max) {
    return { signal: "value_in_range", contribution: 15, detail: "value within band" };
  }
  return { signal: "value_in_range", contribution: 0, detail: "value outside band" };
};
