#!/usr/bin/env node
// Convert the EU CPV-2008 XML release into a flat JSON taxonomy.
//
// Input:  path to cpv_2008.xml from the EU bundle (default: ../frianbud-docs/cpv-2008-raw/cpv_2008.xml,
//         override with first CLI arg).
// Output: data/cpv-2008.json
//
// Output shape: [{ code, label_en, parent }]. Norwegian labels (label_no) are not present
// in the EU XML; they remain undefined and can be added by contributors.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const inputArg = process.argv[2];
const INPUT = inputArg
  ? resolve(inputArg)
  : resolve(repoRoot, "..", "frianbud-docs", "cpv-2008-raw", "cpv_2008.xml");
const OUTPUT = join(repoRoot, "data", "cpv-2008.json");

console.log(`Reading: ${INPUT}`);
const xml = readFileSync(INPUT, "utf8");

// The XML is shallow and predictable. Use targeted regex rather than pulling in a parser.
// Each entry looks like:
//   <CPV CODE="03000000-1">
//     <TEXT LANG="EN">Agricultural, ...</TEXT>
//     ...
//   </CPV>

const entryRe = /<CPV\s+CODE="([^"]+)">([\s\S]*?)<\/CPV>/g;
const enRe = /<TEXT\s+LANG="EN">([\s\S]*?)<\/TEXT>/;

const entries = [];
let match;
while ((match = entryRe.exec(xml)) !== null) {
  const code = match[1];
  const inner = match[2];
  const enMatch = inner.match(enRe);
  const label_en = enMatch ? decodeXml(enMatch[1].trim()) : "";
  if (!label_en) {
    console.warn(`Skipping ${code}: no EN label`);
    continue;
  }
  entries.push({ code, label_en });
}

console.log(`Parsed ${entries.length} entries`);

// Build a map keyed by 8-digit numeric prefix for parent lookup.
const byPrefix = new Map();
for (const e of entries) {
  const prefix = e.code.split("-")[0];
  byPrefix.set(prefix, e.code);
}

// For each entry, derive parent by progressively zeroing rightmost non-zero
// digits (excluding check digit) and looking up the result.
//
// CPV-2008 hierarchy:
//   Positions 0-1: Division (e.g., "72" = IT services). Top level — no parent above.
//   Position 2:    Group
//   Position 3:    Class
//   Position 4-6:  Category, sub-category, ...
//   Position 7:    always zero in the structure (placeholder)
//   "-X":          ISO 7064 mod-11,10 check digit, ignored for hierarchy.
//
// Never zero positions 0 or 1 — that would wrongly link two independent Divisions.
function findParent(code) {
  const num = code.split("-")[0];
  for (let i = num.length - 1; i >= 2; i--) {
    if (num[i] === "0") continue;
    const candidate = num.slice(0, i) + "0".repeat(num.length - i);
    if (candidate === num) continue;
    const found = byPrefix.get(candidate);
    if (found && found !== code) return found;
  }
  return null;
}

const out = entries.map((e) => ({
  code: e.code,
  label_en: e.label_en,
  parent: findParent(e.code),
}));

// Sort for deterministic diff-friendly output.
out.sort((a, b) => a.code.localeCompare(b.code));

writeFileSync(OUTPUT, JSON.stringify(out, null, 2), "utf8");
console.log(`Wrote ${out.length} entries to ${OUTPUT}`);

// --- helpers ---
function decodeXml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
