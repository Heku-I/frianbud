import type { Tender } from "../types.js";

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asStringArr(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : [];
}

function deriveStatus(
  s: unknown,
): "open" | "closed" | "awarded" | "cancelled" {
  if (typeof s !== "string") return "open";
  switch (s.toUpperCase()) {
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

export function normalizeDoffinSearchHit(payload: unknown): Tender {
  if (!payload || typeof payload !== "object") {
    throw new Error("invalid Doffin payload: not an object");
  }
  const p = payload as Record<string, unknown>;

  const id = asString(p["id"]);
  if (!id) throw new Error("invalid Doffin payload: missing id");

  const buyerArr = p["buyer"];
  const firstBuyer =
    Array.isArray(buyerArr) && buyerArr[0] && typeof buyerArr[0] === "object"
      ? (buyerArr[0] as Record<string, unknown>)
      : null;

  const buyer: Tender["buyer"] = {
    name: asString(firstBuyer?.["name"], "Unknown"),
    country: "NO",
  };
  const orgNumber = asString(firstBuyer?.["organizationId"]);
  if (orgNumber) buyer.orgNumber = orgNumber;

  const issueDate = asString(p["issueDate"]);
  const fallbackDate = asString(p["publicationDate"]);
  const publishedAt = issueDate || (fallbackDate ? `${fallbackDate}T00:00:00Z` : new Date().toISOString());

  const tender: Tender = {
    id: `doffin:${id}`,
    source: "doffin",
    sourceUrl: `https://doffin.no/notice/${encodeURIComponent(id)}`,
    title: asString(p["heading"]),
    buyer,
    cpvCodes: [],
    description: asString(p["description"]),
    publishedAt,
    regions: asStringArr(p["locationId"]),
    languages: ["no"],
    status: deriveStatus(p["status"]),
    raw: payload,
  };

  const deadline = asString(p["deadline"]);
  if (deadline) tender.deadlineAt = deadline;

  const ev = p["estimatedValue"];
  if (ev && typeof ev === "object") {
    const evObj = ev as Record<string, unknown>;
    const amount = evObj["amount"];
    const currency = evObj["currencyCode"];
    if (typeof amount === "number" && typeof currency === "string") {
      tender.estimatedValue = { amount, currency };
    }
  }

  return tender;
}

export function normalizeDoffinDetail(payload: unknown): Tender {
  const base = normalizeDoffinSearchHit(payload);
  if (!payload || typeof payload !== "object") return base;
  const p = payload as Record<string, unknown>;

  const cpvs = asStringArr(p["directCpvCodes"]);
  if (cpvs.length > 0) base.cpvCodes = cpvs;

  const awardedNames = asStringArr(p["awardedNames"]);
  if (awardedNames.length > 0) {
    base.award = {
      winner: awardedNames[0]!,
      awardedAt: base.publishedAt,
    };
    base.status = "awarded";
  }

  return base;
}
