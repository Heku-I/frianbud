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

export const languageMatchSignal: Signal = (tender, profile) => {
  if (tender.languages.length === 0) {
    return {
      signal: "language_match",
      contribution: 10,
      detail: "no language declared, assumed deliverable",
    };
  }
  const set = new Set(profile.languages);
  if (tender.languages.some((l) => set.has(l))) {
    return { signal: "language_match", contribution: 10, detail: "language deliverable" };
  }
  return { signal: "language_match", contribution: 0, detail: "no deliverable language" };
};

export const deadlineFeasibilitySignal: Signal = (tender, profile, opts) => {
  if (!tender.deadlineAt) {
    return { signal: "deadline_feasibility", contribution: 10, detail: "no deadline" };
  }
  const now = opts?.now ?? new Date();
  const deadline = new Date(tender.deadlineAt);
  const daysOut = (deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (daysOut >= profile.minLeadTimeDays) {
    return {
      signal: "deadline_feasibility",
      contribution: 10,
      detail: `${Math.floor(daysOut)} days lead time`,
    };
  }
  return {
    signal: "deadline_feasibility",
    contribution: 0,
    detail: `only ${Math.floor(daysOut)} days, need ${profile.minLeadTimeDays}`,
  };
};

export const buyerFamiliaritySignal: Signal = (tender, profile) => {
  if (profile.preferredBuyers.length === 0) {
    return {
      signal: "buyer_familiarity_inactive",
      contribution: 0,
      detail: "no preferred buyers configured",
    };
  }
  const candidates = new Set(profile.preferredBuyers);
  if (candidates.has(tender.buyer.name)) {
    return {
      signal: "buyer_familiarity",
      contribution: 10,
      detail: `${tender.buyer.name} in preferred list`,
    };
  }
  if (tender.buyer.orgNumber && candidates.has(tender.buyer.orgNumber)) {
    return {
      signal: "buyer_familiarity",
      contribution: 10,
      detail: `${tender.buyer.orgNumber} in preferred list`,
    };
  }
  return { signal: "buyer_familiarity", contribution: 0, detail: "buyer not preferred" };
};

export type ExclusionResult = {
  fired: boolean;
  reasons: ScoreReason[];
};

export function exclusionGate(tender: Tender, profile: Profile): ExclusionResult {
  const reasons: ScoreReason[] = [];
  const text = `${tender.title}\n${tender.description}`.toLowerCase();
  for (const kw of profile.exclusions.keywords) {
    if (kw.length === 0) continue;
    if (text.includes(kw.toLowerCase())) {
      reasons.push({
        signal: "exclusion_keyword",
        contribution: 0,
        detail: `excluded keyword "${kw}" present`,
      });
    }
  }
  const tenderCpvSet = new Set(tender.cpvCodes);
  for (const code of profile.exclusions.cpvCodes) {
    if (tenderCpvSet.has(code)) {
      reasons.push({
        signal: "exclusion_cpv",
        contribution: 0,
        detail: `excluded CPV ${code} present`,
      });
    }
  }
  return { fired: reasons.length > 0, reasons };
}
