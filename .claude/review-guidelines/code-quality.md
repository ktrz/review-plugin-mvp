## Code Quality

**Principle:** Define once, import everywhere. Eliminate magic numbers, stale terminology, dead code, and duplicated logic ruthlessly.

### Evidence patterns that trigger comments

- A type, constant, or helper function defined in more than one place.
- Numeric or string literals used directly instead of a named constant (when the value appears more than once or carries meaning beyond its raw form).
- Utility duplicating an existing one in the codebase (check `src/schema/` and barrels before defining a new helper).
- Stale or misleading names — symbol no longer describes what it does after a refactor.
- Dead code: unused exports, unreachable branches, leftover mocks in tests, commented-out code.
- WHAT-comments that restate the code (`// returns the parsed comment` above `function parseComment(): Comment`).
- File naming inconsistency (kebab-case vs camelCase). Repo convention: kebab-case file names.
- Overloaded function trying to do two unrelated things — split into two named functions.
- `export default` — banned. Always use named exports (better refactor, grep, and barrel ergonomics).
- Backwards-compat shim left after a behavior change: `if (legacy) { oldPath() } else { newPath() }`, deprecated wrappers, `_var` placeholder renames for "removed" code. Delete the old path entirely.

### Example phrasing

- "[file:line] `Severity` type defined here and in `mutations.ts`. Define once in `types.ts` and import."
- "[file:line] `300` appears in three call sites. Extract `const MAX_LINE_LEN = 300`."
- "[file:line] Comment restates the function body. Delete."
- "[file:line] `processComment()` both validates and writes. Split into `validateComment()` and `writeComment()`."
- "[file:line] Unused export `legacyParse` — remove."
- "[file:line] `export default` — switch to named export `export function parse(...)`."
- "[file:line] Legacy branch `if (config.useOldFormat)` — delete this code path entirely; the new format is the only format."
