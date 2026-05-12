## Testing

**Principle:** Every module of meaningful complexity has its own Vitest test file mirroring the source filename. Cover error paths and edge cases alongside the happy path. Use exact assertions for thrown errors — never `.toThrow()` alone.

### Evidence patterns that trigger comments

- New non-trivial module (100+ lines, branching logic, or any IO / parse / mutation surface) with no matching `*.test.ts` file.
- Behavior change in an existing module without a corresponding test update.
- `.toThrow()` or `.toThrowError()` without the specific error class / message. Use `expect(...).toThrow(ParseError)` and assert on the message / cause when relevant.
- Tests cover only the happy path — no case for malformed input, missing field, or wrong type.
- Round-trip property (parse ∘ serialize === id, serialize ∘ parse === id) not tested when both sides exist.
- Dead mocks: leftover after the mocked code was deleted.
- Test reproduces global setup boilerplate (cleanup, mock reset) that already runs.
- `describe` block missing — tests for the same module live as flat `test()` calls.
- One `test()` (or `it()`) block asserts multiple unrelated behaviors. Each test block must cover one named behavior. Split kitchen-sink tests.

### Example phrasing

- "[file] New mutation `applyDecision()` with no test file. Add `mutations.test.ts` covering: each decision kind, conflicting relationships, and `ParseError` on invalid input."
- "[file:line] `.toThrow()` accepts any throw. Replace with `expect(...).toThrow(ParseError)` and assert on `.message`."
- "[file:line] Happy path only — add cases for missing `relationships`, unknown `type`, and empty `thread`."
- "[file:line] Round-trip missing — `serialize(parse(input))` not asserted. Add to `round-trip.test.ts`."
- "[file:line] One `test()` asserts parse + serialize + mutation. Split into three named tests."
