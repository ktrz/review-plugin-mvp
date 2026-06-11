# review-plugin-mvp

VS Code extension for sequential, one-at-a-time PR review. Replaces the terminal `review-pr --deep` loop with a keyboard-driven navigator anchored to the diff.

## Problem

Reviewing 20 comments at once asks the agent (and the human) to hold too many decisions in working memory. Grouping, context retrieval, and decision UI collapse into a single prompt and the loop gets noisy. Moving the decisions sequential, one comment at a time, fixes that.

## Prerequisites

- VS Code ≥ 1.90 with the `code` CLI on your PATH
- Node ≥ 20
- [`gh`](https://cli.github.com/) CLI, authenticated — used to auto-discover the PR number for the current branch (you can also type it manually)
- [`claude`](https://docs.anthropic.com/en/docs/claude-code) CLI — used by the **Discuss** chat flow; everything else works without it
- The `review-pr` pipeline tooling, to generate findings for real PRs (see [Try it without the pipeline](#try-it-without-the-pipeline) if you don't have it)

## Install

```bash
git clone <this repo> && cd review-plugin-mvp
npm install
npm run install:local   # compile → package .vsix → code --install-extension
```

Reload VS Code afterwards. To update later, pull and re-run `npm run install:local`.

## Using it on a real PR

1. In the repo you're reviewing, generate findings:

   ```bash
   review-pr --pipeline
   ```

   This writes `pr-<N>-auto-review.md` to the `output_dir` configured in that repo's `.claude/review.yaml` (default convention: `plans.local/<repo>/`).

2. Open the repo in VS Code and run **Review Plugin: Load review findings** from the command palette. The plugin discovers the PR number via `gh` (or asks you), then resolves the findings file automatically — first via `.claude/review.yaml`'s `output_dir`, then `plans.local/<repo>/`, falling back to a file picker.

3. Findings appear as native inline comment threads anchored to file/line. Work through them one at a time using the buttons in each thread's title bar:

   | Button | Effect | Status marker |
   |---|---|---|
   | **Post** | Accept the finding | `[x]` resolved |
   | **Dismiss** | Reject it | `[-]` skipped |
   | **Discuss** | Defer and open a chat with the decision agent | `[d]` deferred |
   | **Finalize chat** | End a discussion with a custom resolution you type | `[~]` custom |
   | **Unresolve** | Reopen a decided thread | `[?]` unresolved |

   Typing in a thread's reply box also starts a discussion: the message goes to the `claude` CLI with bounded context (the hunk, the comment, its relationships, and the thread so far) and the response renders inline.

4. Every decision is written back into the findings markdown file immediately — the file is the session state, so you can stop and resume freely. If the file's recorded head SHA stops matching your workspace's `git HEAD`, the plugin warns on load (configurable via `reviewPlugin.shaCheck.mode`).

5. When you're done, run **Review Plugin: Finalize session**. It shows a status summary and offers to copy the follow-up command:

   ```
   claude /execute-review-decisions <findings-file>
   ```

   That external skill — not this plugin — posts the accepted comments and summary review to GitHub.

## Try it without the pipeline

The repo ships a self-contained demo: `fixtures/pr-42-auto-review.md` contains six findings against `fixtures/sample-repo/`.

1. Open `fixtures/sample-repo/` as your workspace folder.
2. Run **Review Plugin: Load review findings**, enter `42` when asked for a PR number, and pick `fixtures/pr-42-auto-review.md` in the file dialog.
3. Expect a head-SHA mismatch warning — the fixture's SHA is fake; dismiss it (or set `reviewPlugin.shaCheck.mode` to `off`).

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `reviewPlugin.claude.cliPath` | `claude` | Path to the claude CLI binary used for chat replies |
| `reviewPlugin.claude.extraArgs` | `[]` | Extra argv appended after `-p` when invoking the CLI |
| `reviewPlugin.shaCheck.mode` | `warn` | `warn` or `off` for findings-doc vs. workspace HEAD mismatch |

## Architecture

Three concerns split across time:

- **Review agent** runs upfront, emits structured comments with relationship metadata baked in. Output frozen.
- **Plugin** (this repo) handles navigation and presentation at runtime. No reasoning.
- **Decision agent** per comment, bounded context per invocation. Plugin maintains per-comment thread state and appends on each follow-up.

Input sources (local agent output, fetched GitHub PR comments) normalize to a common comment schema before entering the plugin.

Stack: TypeScript, VS Code Extension API directly. No framework.

## Comment Schema

Each comment carries: file path, line ref, body, severity/category, and relationships `[{ id, type }]` where type ∈ `same-fix | same-root-cause | dependent | conflicting | same-pattern`.

Per-comment plugin state:

```ts
{ comment, hunk, relationships, thread[], decision }
```

## Decision Log

Output of the session. Consumer is the existing `execute-review-decisions` skill. Per entry: file, line, decision type (accept / dismiss / discussed), user notes verbatim, thread summary if discussed. Schema alignment with that skill is the main pending design task.

## Roadmap (not yet implemented)

- Single-key keyboard shortcuts (`p` post / `e` edit / `d` drop) — current UI is thread title-bar buttons
- Sidebar overview webview
- Relationship cascade UI
- Async parallel navigation
- Voice layer (Maelstrom STT/TTS)

## Development

```bash
npm install          # install dependencies
npm test             # run vitest unit tests (parse, serialize, round-trip, hybrid, mutations)
npm run lint         # eslint src/
npm run typecheck    # tsc --noEmit
npm run compile      # esbuild bundle → dist/extension.js
npm run package      # vsce package → .vsix
```

Press **F5** in VS Code to launch the Extension Development Host with the extension loaded — useful for iterating without reinstalling the .vsix.
