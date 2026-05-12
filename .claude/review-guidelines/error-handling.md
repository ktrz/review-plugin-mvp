## Error Handling

**Principle:** No silent failures. Every async operation surfaces its error — to the VS Code window (`vscode.window.showErrorMessage`), to the output channel, or up the call stack via thrown / typed errors. Parse-time errors carry structured info, not just a string.

### Evidence patterns that trigger comments

- `void asyncFn()` or fire-and-forget `.then()` without a `.catch()` — Promise rejections vanish.
- `try { ... } catch (e) {}` with empty catch, or catch that only logs and continues when the caller still relies on the result.
- Zod parse used with `.parse()` where the error path needs to surface to the user — should be `.safeParse()` and an explicit branch, or `.parse()` wrapped in a typed `ParseError`.
- Selector / transform silently discarding unknown shapes instead of throwing `ParseError` (schema invariant violations must be loud).
- Missing input validation on values that cross a trust boundary (`gh pr view` JSON, user keystrokes routed to a decision, file contents from disk).
- Catching `unknown` and rethrowing with the type information lost (`throw new Error(String(e))` instead of preserving `cause`).
- No recursion / iteration bound on traversals over user-provided graphs (relationship cascades on the comment schema).

### Example phrasing

- "[file:line] `void applyDecision(c)` — rejection silently dropped. `await` and let it propagate, or wrap with `.catch(err => vscode.window.showErrorMessage(...))`."
- "[file:line] `schema.parse(raw)` throws a `ZodError` to the caller. Wrap and rethrow as `ParseError` so the public boundary stays typed."
- "[file:line] Empty catch swallows `ParseError`. Either rethrow or surface via the output channel — schema violations must not be silent."
- "[file:line] Relationship traversal has no depth limit. Add a `maxDepth` guard — a cycle would loop forever."
