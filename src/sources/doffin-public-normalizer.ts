import type { Tender } from "../types.js";

// Doffin's official PublicNoticeHitDto. Differs from the unofficial SPA
// backend by: cpvCodes are present on the hit (no detail enrichment),
// status is reliably set (server-side filter), and lots[].winner[] is
// structured with id+organizationId+name per winner per lot.

type DoffinPublicHit = {
  id?: string;
  buyer?: Array<{ id?: string; organizationId?: string; name?: string }>;
  heading?: string;
  description?: string;
  locationId?: string[];
  estimatedValue?: { currencyCode?: string; amount?: number } | null;
  type?: string;
  allTypes?: string[];
  status?: string;
  issueDate?: string;
  deadline?: string;
  publicationDate?: string;
  receivedTenders?: number | null;
  cpvCodes?: string[];
  lots?: Array<{
    heading?: string;
    description?: string;
    winner?: Array<{ id?: string; organizationId?: string; name?: string }>;
  }>;
};

function deriveStatus(
  payload: DoffinPublicHit,
): "open" | "closed" | "awarded" | "cancelled" {
  if (Array.isArray(payload.allTypes)) {
    if (payload.allTypes.includes("RESULT")) return "awarded";
    if (payload.allTypes.includes("CANCELLATION")) return "cancelled";
  }
  switch (payload.status?.toUpperCase()) {
    case "ACTIVE":
      return "open";
    case "EXPIRED":
      return "closed";
    case "CANCELLED":
      return "cancelled";
    case "AWARDED":
      return "awarded";
    default:
      return "open";
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function normalizeDoffinPublicHit(payload: unknown): Tender {
  if (!payload || typeof payload !== "object") {
    throw new Error("invalid Doffin public payload: not an object");
  }
  const p = payload as DoffinPublicHit;

  const id = asString(p.id);
  if (!id) throw new Error("invalid Doffin public payload: missing id");

  const firstBuyer = p.buyer?.[0];
  const buyer: Tender["buyer"] = {
    name: asString(firstBuyer?.name) || "Unknown",
    country: "NO",
  };
  const orgNumber = asString(firstBuyer?.organizationId);
  if (orgNumber) buyer.orgNumber = orgNumber;

  const issueDate = asString(p.issueDate);
  const fallbackDate = asString(p.publicationDate);
  const publishedAt =
    issueDate || (fallbackDate ? `${fallbackDate}T00:00:00Z` : new Date().toISOString());

  const status = deriveStatus(p);

  const tender: Tender = {
    id: `doffin:${id}`,
    source: "doffin",
    sourceUrl: `https://doffin.no/notice/${encodeURIComponent(id)}`,
    title: asString(p.heading),
    buyer,
    cpvCodes: Array.isArray(p.cpvCodes)
      ? Array.from(
          new Set(p.cpvCodes.filter((x): x is string => typeof x === "string")),
        )
      : [],
    description: asString(p.description),
    publishedAt,
    regions: Array.isArray(p.locationId)
      ? p.locationId.filter((x): x is string => typeof x === "string")
      : [],
    languages: ["no"],
    status,
    raw: payload,
  };

  if (p.deadline) tender.deadlineAt = p.deadline;

  if (
    p.estimatedValue &&
    typeof p.estimatedValue.amount === "number" &&
    p.estimatedValue.amount > 0 &&
    typeof p.estimatedValue.currencyCode === "string"
  ) {
    tender.estimatedValue = {
      amount: p.estimatedValue.amount,
      currency: p.estimatedValue.currencyCode,
    };
  }

  if (status === "awarded" && Array.isArray(p.lots)) {
    // Lot-level winners are properly structured here, unlike TED's flat
    // response. Flatten to a per-tender winners list (one entry per
    // (lot, winner) pair). Names + org numbers are explicitly paired —
    // no misattribution risk.
    const winners: NonNullable<Tender["award"]>["winners"] = [];
    for (const lot of p.lots) {
      if (!Array.isArray(lot.winner)) continue;
      for (const w of lot.winner) {
        const name = asString(w.name);
        if (!name) continue;
        const entry: NonNullable<Tender["award"]>["winners"][number] = { name };
        const og = asString(w.organizationId);
        if (og) entry.orgNumber = og.replace(/^NO/i, "").replace(/MVA$/i, "").replace(/\s+/g, "");
        winners.push(entry);
      }
    }
    if (winners.length > 0 || tender.estimatedValue) {
      tender.award = {
        winners,
        awardedAt: tender.publishedAt,
      };
      if (tender.estimatedValue) {
        tender.award.totalValue = tender.estimatedValue.amount;
        tender.award.currency = tender.estimatedValue.currency;
      }
    }
  }

  return tender;
}
