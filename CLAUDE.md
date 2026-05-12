# CLAUDE.md

## What is review-plugin-mvp?

VS Code extension for sequential, one-at-a-time PR review. Replaces the terminal `review-pr --deep` loop with a keyboard-driven navigator anchored to the diff.

Three concerns split across time:

- **Review agent** (out-of-process, `review-pr --pipeline`) runs upfront, emits structured comments with relationship metadata. Output frozen before plugin sees it.
- **Plugin** (this repo) handles navigation and presentation at runtime. No reasoning.
- **Decision agent** runs per comment with bounded context (hunk + comment + relationships + thread so far). Plugin maintains per-comment thread state.

Input sources (local agent output, fetched GitHub PR comments via `gh pr view`) normalize to a common comment schema before entering the plugin.

## Comment schema invariants

Each comment carries: file path, line ref, body, severity/category, and relationships `[{ id, type }]` where `type ∈ same-fix | same-root-cause | dependent | conflicting | same-pattern`.

Per-comment plugin state: `{ comment, hunk, relationships, thread[], decision }`.

## Conventions

Broader coding standards (architecture / type safety / code quality / testing / error handling) live in `.claude/review-guidelines/`. These apply when **writing** code too, not only when reviewing. Highlights:

- File layout: exports at top, private helpers below. Split files above ~300 lines; ~500 lines = mandatory split (`review-guidelines/architecture.md`).
- Type safety: discriminated unions over optional-field bags; no `as unknown as Type` escape hatches (`review-guidelines/type-safety.md`).
- Testing: every non-trivial module gets its own unit test file; cover error/disabled/edge states alongside happy path (`review-guidelines/testing.md`).
- Error handling: no silent failures — every async op has visible error handling or a logged warning (`review-guidelines/error-handling.md`).

Repo-specific additions:

- **No planning-tag comments** (`// A1`, `// B3`, `// H1-H9`). Tags belong in the planning artifact, not the code.
- **No section-divider banners** (`// ---...---`). Use `describe` blocks in tests; self-explanatory code in src.
- Tests mirror source filenames (`parse.ts` → `parse.test.ts`). Use exact `ParseError` assertions — don't accept "any throw".

Scripts, dependencies, engine versions: see `package.json`.

## Review pipeline

This repo uses the automated review pipeline (`review-pr` → `investigate-pr-comments` → `execute-review-decisions` / `resolve-pr-comments`). Config: `.claude/review.yaml`. Guideline set: `.claude/review-guidelines/`.
