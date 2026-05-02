import type { Tender } from "../types.js";

// 3-letter ISO 3166 alpha-3 (used by TED) to 2-letter alpha-2 (used in our Tender type).
// Covers the EU 27 + EEA + UK + commonly-seen reporters. Codes not in this map
// pass through unchanged — the unified type accepts any ISO 2-letter string.
const COUNTRY_3_TO_2: Record<string, string> = {
  AUT: "AT", BEL: "BE", BGR: "BG", CHE: "CH", CYP: "CY", CZE: "CZ",
  DEU: "DE", DNK: "DK", ESP: "ES", EST: "EE", FIN: "FI", FRA: "FR",
  GBR: "GB", GRC: "GR", HRV: "HR", HUN: "HU", IRL: "IE", ISL: "IS",
  ITA: "IT", LIE: "LI", LTU: "LT", LUX: "LU", LVA: "LV", MLT: "MT",
  NLD: "NL", NOR: "NO", POL: "PL", PRT: "PT", ROU: "RO", SVK: "SK",
  SVN: "SI", SWE: "SE",
};

function map3To2(code: string): string {
  return COUNTRY_3_TO_2[code] ?? code;
}

// TED multilingual fields can be string OR { lang3: string | string[] }.
// Picks English first, then Norwegian, then any available value.
function pickLangString(field: unknown): string {
  if (typeof field === "string") return field;
  if (field && typeof field === "object") {
    const obj = field as Record<string, unknown>;
    const prefer = ["eng", "nor", "ENG", "NOR"];
    for (const key of prefer) {
      const v = obj[key];
      if (typeof v === "string") return v;
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
    for (const v of Object.values(obj)) {
      if (typeof v === "string") return v;
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
  }
  return "";
}

// TED publication-date is "YYYY-MM-DD+HH:MM" (date with timezone, no time).
// Normalize to full ISO 8601 datetime (UTC, midnight).
function normalizeIsoDateTime(input: string): string {
  const datePart = input.split(/[+T]/)[0];
  if (datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return `${datePart}T00:00:00Z`;
  }
  return input;
}

function deriveStatus(
  noticeType: string | undefined,
): "open" | "closed" | "awarded" | "cancelled" {
  if (!noticeType) return "open";
  const t = noticeType.toLowerCase();
  if (t.startsWith("can-")) return "awarded";
  if (t.includes("cancel")) return "cancelled";
  return "open";
}

export function normalizeTedNotice(payload: unknown): Tender {
  if (!payload || typeof payload !== "object") {
    throw new Error("invalid TED payload: not an object");
  }
  const p = payload as Record<string, unknown>;

  const publicationNumber = p["publication-number"];
  if (typeof publicationNumber !== "string" || publicationNumber.length === 0) {
    throw new Error("invalid TED payload: missing publication-number");
  }

  const cpvField = p["classification-cpv"];
  const cpvCodes = Array.isArray(cpvField)
    ? cpvField.filter((x): x is string => typeof x === "string")
    : [];

  const buyerName = pickLangString(p["buyer-name"]) || "Unknown";

  const buyerCountryArr = p["buyer-country"];
  const buyerCountryRaw =
    Array.isArray(buyerCountryArr) && typeof buyerCountryArr[0] === "string"
      ? buyerCountryArr[0]
      : "NOR";
  const buyerCountry = map3To2(buyerCountryRaw);

  const placeArr = p["place-of-performance"];
  const regions = Array.isArray(placeArr)
    ? placeArr.filter((x): x is string => typeof x === "string").map(map3To2)
    : [];

  const title = pickLangString(p["notice-title"]);
  const descriptionFromLot = pickLangString(p["description-lot"]);
  const description = descriptionFromLot.length > 0 ? descriptionFromLot : title;

  const titleObj = p["notice-title"];
  const languages =
    titleObj && typeof titleObj === "object"
      ? Array.from(
          new Set(
            Object.keys(titleObj as Record<string, unknown>).map((k) =>
              k.toLowerCase().slice(0, 2),
            ),
          ),
        )
      : [];

  const publishedAtRaw = p["publication-date"];
  const publishedAt =
    typeof publishedAtRaw === "string"
      ? normalizeIsoDateTime(publishedAtRaw)
      : new Date().toISOString();

  let sourceUrl = `https://ted.europa.eu/en/notice/-/detail/${publicationNumber}`;
  const links = p["links"];
  if (links && typeof links === "object") {
    const html = (links as Record<string, unknown>)["html"];
    if (html && typeof html === "object") {
      const eng = (html as Record<string, unknown>)["ENG"];
      if (typeof eng === "string") sourceUrl = eng;
    }
  }

  const noticeType =
    typeof p["notice-type"] === "string" ? p["notice-type"] : undefined;
  const status = deriveStatus(noticeType);

  const deadlineDateArr = p["deadline-receipt-tender-date-lot"];
  let deadlineAt: string | undefined;
  if (Array.isArray(deadlineDateArr) && typeof deadlineDateArr[0] === "string") {
    deadlineAt = normalizeIsoDateTime(deadlineDateArr[0]);
  }

  const valueArr = p["estimated-value-glo"];
  const currencyArr = p["estimated-value-cur-glo"];
  let estimatedValue: { amount: number; currency: string } | undefined;
  if (
    Array.isArray(valueArr) &&
    typeof valueArr[0] === "number" &&
    Array.isArray(currencyArr) &&
    typeof currencyArr[0] === "string"
  ) {
    estimatedValue = { amount: valueArr[0], currency: currencyArr[0] };
  }

  const tender: Tender = {
    id: `ted:${publicationNumber}`,
    source: "ted",
    sourceUrl,
    title,
    buyer: { name: buyerName, country: buyerCountry },
    cpvCodes,
    description,
    publishedAt,
    regions,
    languages,
    status,
    raw: payload,
  };
  if (deadlineAt) tender.deadlineAt = deadlineAt;
  if (estimatedValue) tender.estimatedValue = estimatedValue;
  return tender;
}
