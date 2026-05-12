## Architecture & Organization

**Principle:** Schema logic lives under `src/schema/`. Extension wiring lives in `src/extension.ts`. Files have a single responsibility; split when they exceed it.

### Evidence patterns that trigger comments

- Schema logic placed outside `src/schema/`, or extension-host code (vscode API usage) leaking into `src/schema/`.
- A single file exceeding ~300 lines with no decomposition. Files above ~500 lines are blocking — split by responsibility.
- Two responsibilities in one file (e.g. parsing + serializing in the same module instead of `parse.ts` + `serialize.ts`).
- Exports declared **after** private helpers in the file (exports must be at the top).
- Unrelated changes scattered across multiple modules in a single PR with no shared motivation.

### Example phrasing

- "[src/foo.ts:1] File is 412 lines and mixes parsing with mutation. Split into `parse-foo.ts` and `mutate-foo.ts` — mirrors `parse.ts` / `mutations.ts`."
- "[src/schema/types.ts:88] Exported `Comment` type appears below private `normalizeKind`. Move exports to top of file."
- "[src/extension.ts:42] VS Code API usage inside `src/schema/` — schema must stay framework-agnostic. Move this to `extension.ts` or a new adapter under `src/`."
