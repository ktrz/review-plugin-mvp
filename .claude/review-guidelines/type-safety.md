## Type Safety & Design

**Principle:** Use the type system to make invalid states unrepresentable.

**Discriminated unions are the default whenever multiple variants exist.** If a type has two or more "kinds" of values — success/failure, loaded/loading/empty, post/edit/drop, any pair of mutually-exclusive optional fields — model it as a discriminated union with a `kind` (or `type`, `status`, `_tag`) tag. Optional-field bags are a code-smell; flag them on sight. Exception: a single optional field that's genuinely orthogonal to the rest (e.g. `description?: string` on a fully-populated entity) is fine.

Zod schemas are the source of truth at IO boundaries; derive TS types from them with `z.infer`. For discriminated unions, use `z.discriminatedUnion('kind', [...])` — not `z.union([...])`.

### Evidence patterns that trigger comments

- Type with multiple optional fields where a discriminated union expresses the variant structure (e.g. `{ ok?: T; error?: ParseError }` → `{ kind: 'ok'; value: T } | { kind: 'err'; error: ParseError }`).
- `any`, `@ts-ignore`, or `@ts-expect-error` in `src/`. All three are blockers. Tests may use `@ts-expect-error` **only** with an adjacent comment explaining the intentional type failure being asserted.
- `as unknown as Type` (or any double-cast that launders one type to another) — **banned**. Critical severity. If the types don't align, fix the data transformation, parse via zod, or narrow with a type guard. The only allowed exception is test mocking where the alternative would be extremely cumbersome — and even then, justify in a comment. In this repo there is almost certainly no legitimate need for it.
- `as never` cast — same rule.
- `interface` used for a domain type. Default to `type` aliases. `interface` is reserved for cases that genuinely need declaration merging (rare in this repo).
- Schema field, return type, or array that should be readonly but isn't. Schema types are immutable: `readonly` on fields, `ReadonlyArray<T>` for collections, `as const` for literal data. Mutations return new values; never mutate in place.
- Manually-written TS type that should be derived from a zod schema via `z.infer<typeof schema>`.
- Parallel arrays positionally coupled without type-level coupling (use a `Map`, or an array of objects).
- Hardcoded string-literal union duplicated in multiple files instead of imported from one source.
- Inconsistent naming of string constants for the same concept across files.

### Example phrasing

- "[file:line] Type bag with three optional fields — replace with discriminated union: `{ kind: 'ok'; value: T } | { kind: 'err'; error: ParseError }`."
- "[file:line] `as unknown as Comment` bypasses the compiler. If `parsed` is `unknown`, run it through the zod schema and use the parsed result."
- "[file:line] TS type duplicates zod schema shape. Derive via `type Comment = z.infer<typeof commentSchema>`."
- "[file:line] Parallel arrays — `ids` and `hunks` correlated by index. Replace with `Array<{ id: string; hunk: Hunk }>`."
- "[file:line] `any` cast on `raw`. Run through the zod schema or narrow with a type guard."
- "[file:line] `interface Comment` — use `type Comment = ...` for consistency. No declaration merging needed here."
- "[file:line] `relationships: Relationship[]` should be `readonly relationships: ReadonlyArray<Relationship>`. Schema data is immutable."
