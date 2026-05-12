import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const SeveritySchema = z.enum(['critical', 'important', 'suggestion', 'nit']);
export type Severity = z.infer<typeof SeveritySchema>;

// H1: Named-semantic enum. On-disk: [?]/[x]/[~]/[d]/[-]
// Serializer maps: unresolved→[?], resolved→[x], custom→[~], deferred→[d], skipped→[-]
// Parser maps: ?→unresolved, x→resolved, ~→custom, d→deferred, -→skipped
export const StatusMarkerSchema = z.enum(['unresolved', 'resolved', 'custom', 'deferred', 'skipped']);
export type StatusMarker = z.infer<typeof StatusMarkerSchema>;

// ---------------------------------------------------------------------------
// Location — discriminated union (G2, H3)
// ---------------------------------------------------------------------------

export const LocationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('review-body') }),
  z.object({ kind: z.literal('file'), file: z.string(), line: z.number().int().positive() }),
]);
export type Location = z.infer<typeof LocationSchema>;

// ---------------------------------------------------------------------------
// Source — discriminated union with severity pushed in (G3, H2)
// ---------------------------------------------------------------------------

export const SourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('auto-review'), severity: SeveritySchema }),
  z.object({
    kind: z.literal('reviewer'),
    // H2: bare handle stored (no leading @); serializer prepends @
    login: z.string().min(1).regex(/^[^\s@]+$/),
    severity: SeveritySchema,
  }),
]);
export type Source = z.infer<typeof SourceSchema>;

// ---------------------------------------------------------------------------
// FindingItem — dirty/rawSource discriminated union (G1)
// ---------------------------------------------------------------------------

const FindingItemBaseSchema = z.object({
  status: StatusMarkerSchema,
  source: SourceSchema,
  location: LocationSchema,
  reportedBy: z.array(z.string().min(1)).nonempty(),
  comment: z.string(),
  analysis: z.string(),
  recommendation: z.string(),
  options: z.array(z.string()),
  resolution: z.string(),
});

export const FindingItemSchema = z.discriminatedUnion('dirty', [
  FindingItemBaseSchema.extend({ dirty: z.literal(false), rawSource: z.string().min(1) }),
  FindingItemBaseSchema.extend({ dirty: z.literal(true), rawSource: z.string().optional() }),
]);
export type FindingItem = z.infer<typeof FindingItemSchema>;

// ---------------------------------------------------------------------------
// BranchRef — shared schema (H6)
// ---------------------------------------------------------------------------

export const BranchRefSchema = z.object({
  ref: z.string().brand<'BranchRef'>(),
  sha: z.string().brand<'GitSha'>().optional(),
});
export type BranchRef = z.infer<typeof BranchRefSchema>;

// ---------------------------------------------------------------------------
// DocumentHeader (H4, H5, H6, H7, H8, H9)
// ---------------------------------------------------------------------------

export const DocumentHeaderSchema = z.object({
  prUrl: z.string().url().brand<'PrUrl'>(),   // H5: URL validated; H4: prNumber separate; I1: branded
  prNumber: z.number().int().positive(),        // H4
  branch: z.object({
    head: BranchRefSchema,
    base: BranchRefSchema,
  }),
  generatedAt: z.string().datetime(),           // H7: ISO 8601 enforced
  status: z.string(),                           // H8: loose per R3
  // sourceCounts removed (H9): derived at serialize-time from items
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
