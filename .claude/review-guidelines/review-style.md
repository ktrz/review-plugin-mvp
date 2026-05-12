## Review Style (Automated)

**Principle:** Be prescriptive. State the problem, state the fix. No Socratic "why" questions — they're for human review, not automated review. Cite the rule or existing pattern that applies.

### Severity levels (map to review-pr buckets)

- **Critical** (must fix before merge): broken functionality, silent error swallowing in production paths, type-safety escape hatches, schema-invariant violations.
- **Important** (strongly recommended): missing tests for new logic, file-size violations, duplicate definitions, missing error paths, dead code that obscures intent.
- **Suggestion / nit** (style, alternatives): naming, minor refactor opportunities, future-proofing.

### Comment shape

`[file:line] [problem]. [fix].`

Examples:

- "Silent rejection — `void parse(input)` swallows `ParseError`. Wrap in try/catch and surface the error, or `await` and let it propagate."
- "Discriminated union missing — fields `kind`, `payload`, `error` are all optional. Replace with `{ kind: 'ok'; payload: T } | { kind: 'err'; error: ParseError }`."
- "File is 312 lines — split by responsibility. `serialize.ts` already does this; mirror the same split here."

### Anchor to existing patterns

Reference concrete files / symbols already in the codebase rather than abstract advice:

- "Follow `parse.test.ts` — exact `ParseError` assertions per case, not `.toThrow()`."
- "Barrel `schema/index.ts` already re-exports `ParseError`. Import from there, don't redefine."

### Proportional depth

- Style / naming nits → one line.
- Architectural concerns → 2–4 sentences plus a concrete code shape (actual type signature, actual function call).
- Never speculate. If unsure whether code is broken, skip the comment.

### Priorities (ranked)

1. Correctness — does it actually work? Edge cases covered?
2. Type safety — does the type system prevent the mistake?
3. Schema / round-trip invariants — does serialize ∘ parse round-trip?
4. Testability — is the surface independently testable, and is it tested?
5. Error visibility — failures surface, not swallowed.
6. Duplication — reuses what exists.
7. Naming clarity — communicates intent.
