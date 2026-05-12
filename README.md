# review-plugin-mvp

VS Code extension for sequential, one-at-a-time PR review. Replaces the terminal `review-pr --deep` loop with a keyboard-driven navigator anchored to the diff.

## Problem

Reviewing 20 comments at once asks the agent (and the human) to hold too many decisions in working memory. Grouping, context retrieval, and decision UI collapse into a single prompt and the loop gets noisy. Moving the decisions sequential, one comment at a time, fixes that.

## MVP Scope

Stack: TypeScript, VS Code Extension API directly. No framework.

Flow:

1. Run `review-pr --pipeline` against any PR (own branch or someone else's).
2. Plugin loads the findings file.
3. Navigate comments one at a time via the native VS Code Comments API (inline threads anchored to file/line).
4. Per comment, keyboard shortcuts: `p` post / `e` edit / `d` drop.
5. For discussion / follow-up: per-comment decision agent operates on a bounded context (hunk, comment, relationships, thread so far). Response renders inline in the thread.
6. Flush decisions to GitHub: inline comments + one summary review (approve / comment / request changes).

Existing bot comments (Copilot, CodeRabbit) fold in as a read-only swimlane via `gh pr view`, normalized to the same schema.

## Out of Scope (for now)

- Relationship cascade UI
- Sidebar overview webview
- Async parallel navigation
- Voice layer (Maelstrom STT/TTS)

## Architecture

Three concerns split across time:

- **Review agent** runs upfront, emits structured comments with relationship metadata baked in. Output frozen.
- **Plugin** handles navigation and presentation at runtime. No reasoning.
- **Decision agent** per comment, bounded context per invocation. Plugin maintains per-comment thread state and appends on each follow-up.

Input sources (local agent output, fetched GitHub PR comments) normalize to a common comment schema before entering the plugin.

## Comment Schema

Each comment carries: file path, line ref, body, severity/category, and relationships `[{ id, type }]` where type ∈ `same-fix | same-root-cause | dependent | conflicting | same-pattern`.

Per-comment plugin state:

```ts
{ comment, hunk, relationships, thread[], decision }
```

## Decision Log

Output of the session. Consumer is the existing `execute-review-decisions` skill. Per entry: file, line, decision type (accept / dismiss / discussed), user notes verbatim, thread summary if discussed. Schema alignment with that skill is the main pending design task.

## Iteration Order

1. MVP plugin (this repo): findings → navigator → decision agent → flush.
2. Sidebar overview webview.
3. Relationship cascade UI.
4. Measure latency; add async navigation only if warranted.
5. Voice layer if warranted.
