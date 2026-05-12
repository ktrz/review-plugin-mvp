import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const SeveritySchema = z.enum(['critical', 'important', 'suggestion', 'nit']);
export type Severity = z.infer<typeof SeveritySchema>;

export const StatusMarkerSchema = z.enum(['[?]', '[x]', '[~]', '[d]', '[-]']);
export type StatusMarker = z.infer<typeof StatusMarkerSchema>;

// ---------------------------------------------------------------------------
// Source — discriminated union
// ---------------------------------------------------------------------------

export const SourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('auto-review') }),
  z.object({ kind: z.literal('reviewer'), login: z.string() }),
]);
export type Source = z.infer<typeof SourceSchema>;

// ---------------------------------------------------------------------------
// FindingItem
// ---------------------------------------------------------------------------

export const FindingItemSchema = z.object({
  status: StatusMarkerSchema,
  source: SourceSchema,
  file: z.string().nullable(),
  line: z.number().int().nonnegative().nullable(),
  severity: SeveritySchema,
  reportedBy: z.array(z.string()),
  comment: z.string(),
  analysis: z.string(),
  recommendation: z.string(),
  options: z.array(z.string()),
  resolution: z.string(),
  rawSource: z.string(),
  dirty: z.boolean(),
});
export type FindingItem = z.infer<typeof FindingItemSchema>;

// ---------------------------------------------------------------------------
// DocumentHeader
// ---------------------------------------------------------------------------

export const DocumentHeaderSchema = z.object({
  prUrl: z.string(),
  branch: z.object({
    head: z.object({
      ref: z.string(),
      sha: z.string().optional(),
    }),
    base: z.object({
      ref: z.string(),
      sha: z.string().optional(),
    }),
  }),
  generatedAt: z.string(), // ISO 8601 string
  status: z.string(), // loose — e.g. "PENDING REVIEW", "COMPLETE"
  sourceCounts: z.object({
    autoReviewFindings: z.number().int().nonnegative(),
    humanReviewerComments: z.number().int().nonnegative(),
    totalItems: z.number().int().nonnegative(),
    totalCritical: z.number().int().nonnegative(),
    totalImportant: z.number().int().nonnegative(),
    totalSuggestionOrNit: z.number().int().nonnegative(),
  }),
});
export type DocumentHeader = z.infer<typeof DocumentHeaderSchema>;

// ---------------------------------------------------------------------------
// HandoverDocument
// ---------------------------------------------------------------------------

export const HandoverDocumentSchema = z.object({
  header: DocumentHeaderSchema,
  items: z.array(FindingItemSchema),
});
export type HandoverDocument = z.infer<typeof HandoverDocumentSchema>;
