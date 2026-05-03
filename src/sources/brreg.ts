import { httpJson } from "../infra/http.js";
import { createLru } from "../infra/lru.js";

const BASE = "https://data.brreg.no/enhetsregisteret/api";

export type BrregOrganization = {
  orgNumber: string;
  name: string;
  organizationForm: string;
  organizationFormDescription?: string;
  industryCode?: string;
  industryDescription?: string;
  employeeCount?: number;
  active: boolean;
  bankrupt: boolean;
  underWinding: boolean;
  registeredAt?: string;
  address: {
    street?: string;
    postalCode?: string;
    postalArea?: string;
    municipality?: string;
    municipalityCode?: string;
    country?: string;
  };
  parentOrgNumber?: string;
  website?: string;
  raw: unknown;
};

export type BrregClient = {
  lookup: (orgNumber: string) => Promise<BrregOrganization | null>;
};

function normalizeOrgNumber(input: string): string {
  // Accept "NO914791723MVA", "984 684 037", or the bare 9-digit number.
  return input.replace(/^NO/i, "").replace(/MVA$/i, "").replace(/\s+/g, "");
}

type BrregEnhet = {
  organisasjonsnummer?: string;
  navn?: string;
  organisasjonsform?: { kode?: string; beskrivelse?: string };
  naeringskode1?: { kode?: string; beskrivelse?: string };
  antallAnsatte?: number;
  konkurs?: boolean;
  underAvvikling?: boolean;
  underTvangsavviklingEllerTvangsopplosning?: boolean;
  registreringsdatoEnhetsregisteret?: string;
  forretningsadresse?: {
    adresse?: string[];
    postnummer?: string;
    poststed?: string;
    kommune?: string;
    kommunenummer?: string;
    landkode?: string;
  };
  hjemmeside?: string;
  overordnetEnhet?: string;
};

function normalize(payload: BrregEnhet): BrregOrganization {
  const addr = payload.forretningsadresse ?? {};
  const bankrupt = Boolean(payload.konkurs);
  const underWinding =
    Boolean(payload.underAvvikling) ||
    Boolean(payload.underTvangsavviklingEllerTvangsopplosning);
  const result: BrregOrganization = {
    orgNumber: payload.organisasjonsnummer ?? "",
    name: payload.navn ?? "",
    organizationForm: payload.organisasjonsform?.kode ?? "",
    active: !bankrupt && !underWinding,
    bankrupt,
    underWinding,
    address: {},
    raw: payload,
  };
  if (payload.organisasjonsform?.beskrivelse) {
    result.organizationFormDescription = payload.organisasjonsform.beskrivelse;
  }
  if (payload.naeringskode1?.kode) result.industryCode = payload.naeringskode1.kode;
  if (payload.naeringskode1?.beskrivelse) result.industryDescription = payload.naeringskode1.beskrivelse;
  if (typeof payload.antallAnsatte === "number") result.employeeCount = payload.antallAnsatte;
  if (payload.registreringsdatoEnhetsregisteret) result.registeredAt = payload.registreringsdatoEnhetsregisteret;
  if (Array.isArray(addr.adresse) && addr.adresse[0]) result.address.street = addr.adresse[0];
  if (addr.postnummer) result.address.postalCode = addr.postnummer;
  if (addr.poststed) result.address.postalArea = addr.poststed;
  if (addr.kommune) result.address.municipality = addr.kommune;
  if (addr.kommunenummer) result.address.municipalityCode = addr.kommunenummer;
  if (addr.landkode) result.address.country = addr.landkode;
  if (payload.hjemmeside) result.website = payload.hjemmeside;
  if (payload.overordnetEnhet) result.parentOrgNumber = payload.overordnetEnhet;
  return result;
}

export function createBrregClient(deps: {
  fetch?: typeof fetch;
  cacheTtlMs?: number;
  cacheMax?: number;
} = {}): BrregClient {
  const f = deps.fetch ?? fetch;
  // Org data changes infrequently (industry codes, addresses update sporadically).
  // 24h TTL is appropriate for Norwegian register data.
  const cache = createLru<string, BrregOrganization | null>({
    max: deps.cacheMax ?? 500,
    ttlMs: deps.cacheTtlMs ?? 24 * 60 * 60_000,
  });

  return {
    async lookup(orgNumber) {
      const cleaned = normalizeOrgNumber(orgNumber);
      if (!/^\d{9}$/.test(cleaned)) {
        throw new Error(
          `invalid Norwegian org number: '${orgNumber}' (expected 9 digits)`,
        );
      }
      const cached = cache.get(cleaned);
      if (cached !== undefined) return cached;

      try {
        const payload = await httpJson<BrregEnhet>(
          `${BASE}/enheter/${cleaned}`,
          {
            retries: 1,
            retryDelayMs: 300,
            timeoutMs: 8_000,
            fetch: f,
          },
        );
        const normalized = normalize(payload);
        cache.set(cleaned, normalized);
        return normalized;
      } catch (err) {
        const status = (err as { status?: number }).status;
        // Non-404 errors are real failures — propagate.
        if (status !== 404) throw err;
        // /enheter returned 404. Fall back to /underenheter (sub-units use
        // a different path). If that also 404s, cache null and return.
        try {
          const sub = await httpJson<BrregEnhet>(
            `${BASE}/underenheter/${cleaned}`,
            {
              retries: 1,
              retryDelayMs: 300,
              timeoutMs: 8_000,
              fetch: f,
            },
          );
          const normalized = normalize(sub);
          cache.set(cleaned, normalized);
          return normalized;
        } catch (err2) {
          if ((err2 as { status?: number }).status === 404) {
            cache.set(cleaned, null);
            return null;
          }
          throw err2;
        }
      }
    },
  };
}
