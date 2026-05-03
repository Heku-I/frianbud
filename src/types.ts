import { z } from "zod";

const isoDateTime = z.string().refine(
  (s) => !Number.isNaN(Date.parse(s)) && /T/.test(s),
  "must be an ISO 8601 datetime string",
);

export const TenderSchema = z.object({
  id: z.string().min(1),
  source: z.enum(["ted", "doffin"]),
  sourceUrl: z.string().url(),
  title: z.string(),
  buyer: z.object({
    name: z.string(),
    orgNumber: z.string().optional(),
    country: z.string().min(2),
  }),
  cpvCodes: z.array(z.string()),
  description: z.string(),
  publishedAt: isoDateTime,
  deadlineAt: isoDateTime.optional(),
  estimatedValue: z
    .object({ amount: z.number(), currency: z.string().length(3) })
    .optional(),
  regions: z.array(z.string()),
  languages: z.array(z.string()),
  status: z.enum(["open", "closed", "awarded", "cancelled"]),
  award: z
    .object({
      // Multi-lot framework awards regularly have several winners. Keep this
      // an array even for single-winner contracts (length 1) so consumers
      // ranking incumbents by frequency get accurate per-firm counts rather
      // than systematically under-counting under-represented winners.
      winners: z.array(
        z.object({
          name: z.string(),
          orgNumber: z.string().optional(),
          value: z.number().optional(),
        }),
      ),
      awardedAt: isoDateTime,
      totalValue: z.number().optional(),
      currency: z.string().length(3).optional(),
    })
    .optional(),
  raw: z.unknown(),
});
export type Tender = z.infer<typeof TenderSchema>;

export const ProfileSchema = z.object({
  schemaVersion: z.literal(1),
  companyName: z.string().min(1),
  whatWeDo: z.string().min(1),
  regions: z.array(z.string()).min(1),
  valueRange: z.object({
    min: z.number().nonnegative(),
    max: z.number().positive(),
    currency: z.string().length(3),
  }),
  languages: z.array(z.string()).min(1),
  cpvCodes: z.array(z.string()).min(1),
  certifications: z.array(z.string()),
  exclusions: z.object({
    keywords: z.array(z.string()),
    cpvCodes: z.array(z.string()),
  }),
  preferredBuyers: z.array(z.string()),
  minLeadTimeDays: z.number().int().nonnegative(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileDraftSchema = ProfileSchema.partial().extend({
  schemaVersion: z.literal(1).optional(),
});
export type ProfileDraft = z.infer<typeof ProfileDraftSchema>;

export const ToolErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user_input"), message: z.string(), field: z.string().optional() }),
  z.object({ kind: z.literal("upstream"), source: z.enum(["ted", "doffin"]), message: z.string() }),
  z.object({ kind: z.literal("internal"), message: z.string() }),
]);
export type ToolError = z.infer<typeof ToolErrorSchema>;

export const SourceWarningSchema = z.object({
  source: z.enum(["ted", "doffin"]),
  reason: z.string(),
  since: isoDateTime.optional(),
});
export type SourceWarning = z.infer<typeof SourceWarningSchema>;

export type ScoreReason = {
  signal: string;
  contribution: number;
  detail: string;
};

export type ScoredTender = Tender & {
  score: number;
  reasons: ScoreReason[];
};
