import type { Tender, Profile, ScoreReason } from "../types.js";
import {
  cpvOverlapSignal,
  regionMatchSignal,
  valueInRangeSignal,
  languageMatchSignal,
  deadlineFeasibilitySignal,
  buyerFamiliaritySignal,
  exclusionGate,
} from "./scorer-signals.js";

export type ScoreResult = { score: number; reasons: ScoreReason[] };

const ACTIVE_SIGNAL_MAX = {
  cpv_overlap: 35,
  region_match: 20,
  value_in_range: 15,
  language_match: 10,
  deadline_feasibility: 10,
  buyer_familiarity: 10,
} as const;

export function scoreTender(
  tender: Tender,
  profile: Profile,
  opts: { now?: Date } = {}
): ScoreResult {
  const exclusion = exclusionGate(tender, profile);

  const buyer = buyerFamiliaritySignal(tender, profile);
  const buyerInactive = buyer.signal === "buyer_familiarity_inactive";

  const positives: ScoreReason[] = [
    cpvOverlapSignal(tender, profile, opts),
    regionMatchSignal(tender, profile, opts),
    valueInRangeSignal(tender, profile, opts),
    languageMatchSignal(tender, profile, opts),
    deadlineFeasibilitySignal(tender, profile, opts),
  ];
  if (!buyerInactive) positives.push(buyer);

  let raw = positives.reduce((s, r) => s + r.contribution, 0);

  if (buyerInactive) {
    // Redistribute buyer-familiarity's 10 pts pro-rata over the others
    // based on how much each scored vs. their max.
    const totalMax = positives.reduce((s, r) => {
      const max = (ACTIVE_SIGNAL_MAX as Record<string, number>)[r.signal] ?? 0;
      return s + max;
    }, 0);
    if (totalMax > 0) {
      raw = Math.round((raw / totalMax) * (totalMax + 10));
    }
  }

  const cap = exclusion.fired ? 25 : 100;
  const score = Math.max(0, Math.min(cap, raw));

  const reasons = [...positives, ...exclusion.reasons];
  if (buyerInactive) {
    reasons.push({
      signal: "buyer_familiarity",
      contribution: 0,
      detail: "redistributed (no preferred buyers configured)",
    });
  }

  return { score, reasons };
}
