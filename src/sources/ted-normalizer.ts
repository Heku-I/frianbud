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

// TED dates come in several shapes:
//   "2026-07-30+02:00"  publication-date (date + timezone offset, no time)
//   "2026-06-01Z"       deadline-receipt-tender-date-lot (date + Z, no time)
//   "2026-05-01T15:33:48Z"  full ISO 8601 (rare, but possible on eForms fields)
// Normalize all of them to full ISO 8601 datetime in UTC. Date-only inputs
// become midnight UTC; full datetimes have any timezone info coerced to Z.
function normalizeIsoDateTime(input: string): string {
  const dt = input.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  if (dt) return `${dt[1]!}Z`;
  const d = input.match(/^(\d{4}-\d{2}-\d{2})/);
  if (d) return `${d[1]!}T00:00:00Z`;
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

  // TED's eForms structure often repeats the same CPV across multiple lot/part
  // sections, so the flat array can have duplicates. Dedupe while preserving
  // the original order (first occurrence wins).
  const cpvField = p["classification-cpv"];
  const cpvCodes = Array.isArray(cpvField)
    ? Array.from(
        new Set(cpvField.filter((x): x is string => typeof x === "string")),
      )
    : [];

  const buyerName = pickLangString(p["buyer-name"]) || "Unknown";

  const buyerCountryArr = p["buyer-country"];
  const buyerCountryRaw =
    Array.isArray(buyerCountryArr) && typeof buyerCountryArr[0] === "string"
      ? buyerCountryArr[0]
      : "NOR";
  const buyerCountry = map3To2(buyerCountryRaw);

  // place-of-performance often contains both 3-letter country codes (NOR) and
  // NUTS-3 codes (NO081) alongside repeats. Map countries to 2-letter, then
  // dedupe.
  const placeArr = p["place-of-performance"];
  const regions = Array.isArray(placeArr)
    ? Array.from(
        new Set(
          placeArr
            .filter((x): x is string => typeof x === "string")
            .map(map3To2),
        ),
      )
    : [];

  const title = pickLangString(p["notice-title"]);
  // eForms exposes description across four nested levels. Prefer the most
  // specific (lot) and fall back upward; final fallback is the title so
  // description is never empty.
  const description =
    pickLangString(p["description-lot"]) ||
    pickLangString(p["description-part"]) ||
    pickLangString(p["description-proc"]) ||
    pickLangString(p["description-glo"]) ||
    title;

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
  if (status === "awarded") {
    const award = extractAward(p, publishedAt);
    if (award) tender.award = award;
  }
  return tender;
}

// Extract winner names + per-winner values + total contract value from a
// CAN (Contract Award Notice) payload. Multi-lot framework agreements have
// parallel arrays: winner-name returns each language with an array of names,
// winner-identifier holds matching org numbers, tender-value holds per-lot
// bid values. Single-winner contracts return strings or 1-element arrays.
function extractAward(
  p: Record<string, unknown>,
  publishedAt: string,
): Tender["award"] | undefined {
  const names = pickWinnerNames(p["winner-name"]);
  const orgNumbers = arrayOf(p["winner-identifier"]);
  const values = arrayOf(p["tender-value"]).map((v) => Number(v));

  // TED's flat search response deduplicates winner-name (per language)
  // while keeping every related party in winner-identifier — framework
  // leaders, subcontractors, the buyer's central procurement org, etc.
  // When array lengths differ, identifiers[i] is NOT the winner of
  // names[i]: probed empirically — e.g., on notice 348862-2025 the first
  // identifier (917719993) is actually 4Service's org, attached to a
  // notice whose winner is "Ability FM Øst AS". To avoid mis-attribution
  // that would poison incumbent rankings, only pair org numbers when the
  // two arrays are the same length. Same logic for tender-value, since
  // it shares the per-party shape of identifiers.
  const orgsAligned = orgNumbers.length === names.length && names.length > 0;
  const valuesAligned = values.length === names.length && names.length > 0;
  const winners = names.map((name, i) => {
    const w: NonNullable<Tender["award"]>["winners"][number] = { name };
    if (orgsAligned) {
      const og = orgNumbers[i];
      if (og) {
        // TED occasionally formats org numbers as "NO123456789MVA" (the VAT
        // representation). Strip the prefix/suffix to recover the bare
        // 9-digit Norwegian organisasjonsnummer for cross-source matching.
        const cleaned = og.replace(/^NO/, "").replace(/MVA$/, "").replace(/\s+/g, "");
        w.orgNumber = cleaned;
      }
    }
    if (valuesAligned) {
      const v = values[i];
      // TED occasionally returns -1 as a "value not disclosed" sentinel.
      // Treat any non-positive amount as missing rather than a real bid.
      if (typeof v === "number" && Number.isFinite(v) && v > 0) w.value = v;
    }
    return w;
  });

  const decisionDate = arrayOf(p["winner-decision-date"])[0];
  const awardedAt = decisionDate
    ? normalizeIsoDateTime(decisionDate)
    : publishedAt;

  const totalArr = arrayOf(p["total-value"]).map((v) => Number(v));
  const totalRaw = totalArr.length > 0 ? totalArr[0] : Number(p["total-value"]);
  const totalCurArr = arrayOf(p["total-value-cur"]);
  const totalCur =
    totalCurArr[0] ?? arrayOf(p["tender-value-cur"])[0];

  const totalIsRealNumber =
    typeof totalRaw === "number" && Number.isFinite(totalRaw) && totalRaw > 0;

  if (winners.length === 0 && !totalIsRealNumber) {
    return undefined;
  }

  const award: NonNullable<Tender["award"]> = {
    winners,
    awardedAt,
  };
  if (totalIsRealNumber) {
    award.totalValue = totalRaw;
  }
  if (typeof totalCur === "string" && totalCur.length === 3) {
    award.currency = totalCur;
  }
  return award;
}

function pickWinnerNames(field: unknown): string[] {
  // Single-winner: { eng: "Acme AS" } or { eng: ["Acme AS"] }.
  // Multi-winner: { eng: ["A AS", "B AS", "C AS"] }.
  if (!field || typeof field !== "object") return [];
  const obj = field as Record<string, unknown>;
  for (const key of ["eng", "nor", "ENG", "NOR"]) {
    const v = obj[key];
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === "string");
    }
    if (typeof v === "string") return [v];
  }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      const arr = v.filter((x): x is string => typeof x === "string");
      if (arr.length > 0) return arr;
    }
    if (typeof v === "string") return [v];
  }
  return [];
}

function arrayOf(field: unknown): string[] {
  if (Array.isArray(field)) {
    return field.filter(
      (x): x is string => typeof x === "string" || typeof x === "number",
    ).map(String);
  }
  if (typeof field === "string" || typeof field === "number") return [String(field)];
  return [];
}
