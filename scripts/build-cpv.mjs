#!/usr/bin/env node
// Convert the EU CPV-2008 XML release into a flat JSON taxonomy, optionally
// merging Norwegian labels from a Doffin tree dump.
//
// Inputs (CLI):
//   $1 = EU XML path (default: ../frianbud-docs/cpv-2008-raw/cpv_2008.xml)
//   $2 = Doffin Norwegian CPV JSON path (optional; default:
//        ../frianbud-docs/doffin-cpv-raw.json — if it exists, used to populate label_no)
// Output: data/cpv-2008.json
//
// Output shape: [{ code, label_en, label_no?, parent }]. Norwegian labels are
// merged when the Doffin file is provided.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const inputArg = process.argv[2];
const INPUT = inputArg
  ? resolve(inputArg)
  : resolve(repoRoot, "..", "frianbud-docs", "cpv-2008-raw", "cpv_2008.xml");
const noArg = process.argv[3];
const NO_INPUT = noArg
  ? resolve(noArg)
  : resolve(repoRoot, "..", "frianbud-docs", "doffin-cpv-raw.json");
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

// Build Norwegian label map from Doffin's nested tree (keyed by 8-digit prefix
// without the check digit, since Doffin omits it).
const noLabels = new Map();
if (existsSync(NO_INPUT)) {
  console.log(`Reading Norwegian labels: ${NO_INPUT}`);
  const tree = JSON.parse(readFileSync(NO_INPUT, "utf8"));
  flattenDoffin(tree, noLabels);
  console.log(`Loaded ${noLabels.size} Norwegian labels`);
} else {
  console.log(`No Norwegian source at ${NO_INPUT} — skipping label_no`);
}

const out = entries.map((e) => {
  const prefix = e.code.split("-")[0];
  const label_no = noLabels.get(prefix);
  return label_no
    ? { code: e.code, label_en: e.label_en, label_no, parent: findParent(e.code) }
    : { code: e.code, label_en: e.label_en, parent: findParent(e.code) };
});

// Sort for deterministic diff-friendly output.
out.sort((a, b) => a.code.localeCompare(b.code));

writeFileSync(OUTPUT, JSON.stringify(out, null, 2), "utf8");
const noCovered = out.filter((e) => "label_no" in e).length;
console.log(
  `Wrote ${out.length} entries to ${OUTPUT}` +
    (noLabels.size > 0 ? ` (${noCovered} with label_no)` : ""),
);

// --- helpers ---
function decodeXml(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function flattenDoffin(nodes, out) {
  for (const node of nodes) {
    if (typeof node?.id === "string" && typeof node?.label === "string") {
      out.set(node.id, node.label);
    }
    if (Array.isArray(node?.children)) {
      flattenDoffin(node.children, out);
    }
  }
}
