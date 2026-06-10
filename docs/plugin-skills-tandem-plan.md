# Plan: review plugin ↔ skills working in tandem

Status: proposed (analysis only, no implementation yet). Spans two repos:
`review-plugin-mvp` (plugin) and `skills` (pipeline). Companion docs: the
adversarial-discussion design (`PLAN.md`) and the map-reduce findings writeup
(`FINDINGS-AND-WORKFLOW.md`) — workstream D below is their landing zone.

## Requirements

- **R1 — drive the pipeline from the plugin.** Trigger auto-review and
  decision execution from VS Code, preview changes live, control review
  parameters (threshold, focus, agents) without dropping to a terminal.
- **R2 — manual threads on arbitrary lines.** Start a new thread on a line no
  finding mentioned, so manual review additions live alongside auto findings
  in one doc and one flow.
- **R3 — PR-level discussion.** Comments not attached to a specific line:
  general questions about the PR, and a PR summary that can itself be
  discussed.

## What exists today (verified against both repos)

| Fact | Where | Why it matters |
|---|---|---|
| `location: { kind: 'review-body' }` already parses and serializes; renderer skips it | `src/schema/types.ts:10–14`, `src/comments/renderer.ts:26–29` | R3 is already supported at the data layer; only a rendering surface is missing |
| Plugin already spawns `claude -p` per-finding chat with configurable `cliPath`/`extraArgs` | `src/llm/claude-runner.ts` | Same mechanism invokes skills headlessly (`claude -p "/review-pr N --pipeline"`) |
| File watcher with self-write SHA detection hot-reloads the findings doc | `src/watchers/file-watcher.ts`, `src/runtime/findings-writer.ts` | External pipeline writes already propagate live into the UI — this is the live-preview channel |
| `review-pr --pipeline` is non-interactive: file output only, no GitHub writes | `skills/review-pr/SKILL.md` (mode resolution) | Safe to run headless from the plugin |
| `execute-review-decisions` has an interactive confirmation gate and mutates branch + GitHub | `skills/execute-review-decisions/SKILL.md` Step 3 | Must run in an integrated terminal, not headless — which also gives live working-tree preview for free |
| `Source` is a discriminated union (`auto-review` \| `reviewer`) | `src/schema/types.ts:16–25` | Adding a `manual` variant is the designed extension point for user-created threads |
| Handover contract is single-sourced in `handover-format.md`; plugin parser/serializer round-trip it | `skills/investigate-pr-comments/references/handover-format.md`, `src/schema/parse.ts`/`serialize.ts` | Every schema change lands in lockstep across both repos |
| `finalize-session` already suggests `claude /execute-review-decisions <file>` as next step | `src/comments/finalize-summary.ts` | C2 below just automates the suggestion that already exists |

**Gap found:** the relationship metadata described in this repo's `CLAUDE.md`
(`[{ id, type }]`, `type ∈ same-fix | same-root-cause | …`) does not exist in
either repo. The pipeline only does exact-dup collapse plus "also flagged by"
notes; the plugin has a TODO at `src/llm/prompt-builder.ts:21`. Workstream D
instantiates the first real piece of it (`see-also`); until then `CLAUDE.md`
overstates the schema and should be corrected.

## Quick win Q — give the chat agent the decisions doc → cross-decision comparison

Friction: asking one thread to "compare against the decision we made on X"
requires pasting the doc path manually — the agent doesn't know the chat
originates from a handover doc.

The persona already grants Read/Grep access (`prompt-builder.ts:14`), so the
agent *can* read the doc; it lacks the path. Three small changes in
`prompt-builder.ts` + its caller (`chat-reply.ts`):

1. Pass `filePath` (already on `LoadedFindings`) into `BuildPromptInput` and
   render: "This finding is item N of the review decisions document at
   `<path>`; Read it if the user references other findings or decisions."
2. Reword the persona line `'Only this finding; do not bring up other
   findings.'` (`prompt-builder.ts:13`) — as written it *fights* the
   comparison use case even when the path is supplied. New intent: don't
   volunteer other findings unprompted, but consult the doc when the user
   asks to compare against another decision.
3. Include a compact inline digest of already-decided items (`file:line —
   [x]/[~] — one-line resolution`): the parsed doc is already in memory, the
   digest is cheap, and it answers "didn't we decide this above?" without a
   tool round-trip. The path covers anything the digest omits.

Untrusted comment bodies in the doc remain fenced on disk
(`<external_data …>`), so an agent Read preserves the trust boundary.

Independent of all workstreams below; can ship first. Partially supersedes
the TODO at `prompt-builder.ts:21` until D1's typed relationships land —
D1's `see-also` links later make the digest targeted instead of global.

## Workstream A — PR-level surface (summary + general threads) → R3

The pivotal design choice: render PR-level content as a **virtual read-only
document** (`TextDocumentContentProvider`, scheme `review-pr:`) instead of a
webview. Threads need a URI + line to anchor to; a virtual "PR Overview" doc
provides both, so the entire existing machinery (thread-builder, chat-reply,
decisions, finalize) is reused unchanged. A webview would force reimplementing
all of it.

1. **Overview document** — deterministic markdown rendered from the loaded
   `HandoverDocument`: header (PR/branch/SHA), PR summary, TLDR counts
   ("12 findings — 8 resolved, 4 open"), an index of findings (file:line,
   severity, status), and one heading per `review-body` item. Regenerated on
   doc change via the existing watcher flow; thread anchors reconciled against
   the deterministic layout.
2. **Render `review-body` findings** as threads anchored to their heading
   lines in the overview doc (delete the `skippedPrLevel` path).
3. **PR-level chat** — new `prompt-builder` variant: context = header +
   summary + findings index (+ diff stat), not a hunk. Same analysis-only
   persona. General questions about the PR are just replies on an
   overview-doc thread.
4. **Summary generation (skills side)** — `investigate-pr-comments` writes a
   `## Summary` block into the handover header (it sees both sources, so it
   summarizes better than `review-pr` alone). `handover-format.md` gains the
   optional section; plugin parser treats it as optional for back-compat. For
   old docs, the plugin can generate a summary on demand via `claude -p` and
   write it back.
5. **New PR-level threads** — user creates a thread on the overview doc →
   new item with `location: review-body`, `source: manual` (see B).

## Workstream B — manual threads on arbitrary lines → R2

1. **`commentingRangeProvider`** on workspace files (all lines — the reviewer
   knows where to click; no need to restrict to the diff).
2. **First reply creates the item**: new `Source` variant `{ kind: 'manual' }`
   (heading tag `manual`, severity defaults to `suggestion`), status
   `unresolved`, `comment` = the user's text. Persisted through the existing
   `runExclusive` + serialize path; thread registered in the render session.
3. **Required-field decision**: `FindingItemBaseSchema` requires non-empty
   `analysis`/`recommendation`. Recommended: relax these for `manual`-sourced
   items (schema variant), with an optional background `claude -p` enrichment
   that fills analysis + recommendation after creation (configurable —
   investigate-on-create is exactly the auto+manual blend the requirement
   asks for).
4. **Chat works immediately** — hunk loader is keyed by `file:line` and
   doesn't care who created the item.
5. **Contract (skills side)**: add `manual` source tag to
   `handover-format.md`. In `execute-review-decisions`, manual items have no
   GitHub thread ID, so they naturally follow the auto-review path (grouped
   PR comment). Default: include them there; consider a per-item or config
   opt-out for local-only notes.
6. **Line drift**: VS Code moves threads as the buffer changes, but the doc
   stores a static line. On every persist, sync `item.location.line` from
   `thread.range`. (Doc-vs-workspace HEAD-SHA mismatch detection already
   exists for the load-time case.)

## Workstream C — trigger the pipeline from the plugin → R1

Split by mutation risk:

**Headless stages (read-only + file writes)** — `review-pr --pipeline`,
`investigate-pr-comments`:

1. New `runtime/pipeline-runner.ts` (a job runner, distinct from the chat
   runner): spawn `claude -p "/review-pr <N> --pipeline"` with cwd =
   workspace root, stream stdout to an output channel, status-bar progress,
   AbortController cancellation, scoped permission flags
   (`--allowedTools`/`--permission-mode` — read-only plus writes to
   `output_dir`).
2. Command **"Review: run auto-review"** — pre-run quick-pick for severity
   threshold / focus / agent preset (the "control the auto review" knob;
   maps onto `.claude/review.yaml`, which the plugin's path-resolver already
   reads). Chains `review-pr --pipeline` →
   `investigate-pr-comments --auto-review-file <path>` → auto-loads the
   decisions doc via the existing loader.

**Interactive stages (branch + GitHub mutations)** — run in the integrated
terminal so the skill's confirmation gates stay with the user:

3. Command **"Review: execute decisions"** — opens a terminal running
   `claude "/execute-review-decisions <file>"`. Live preview is free: the
   skill edits the working tree, VS Code's diff/SCM views show changes as
   they land, and the findings-doc watcher hot-reloads thread states.
4. Command **"Review: discuss deferred"** — terminal
   `claude "/resolve-pr-comments --from-doc <file>"`; the watcher picks up
   written-back decisions live.
5. (Later, opt-in) a `--yes` non-interactive flag on
   `execute-review-decisions` for headless execution — only once trust is
   established.

## Workstream D — metadata enrichment (bridge to the adversarial loop)

Skills-side first, plugin rendering after. Direct lift from
`FINDINGS-AND-WORKFLOW.md`:

1. **`see-also` cross-links** (the cheap win): cluster findings by
   `(file, symbol)` at aggregation time, emit `**See also:**` per item;
   plugin renders links in thread bodies. First real instance of the
   relationship metadata `CLAUDE.md` promises — typed edges (`same-fix`,
   `same-root-cause`, …) follow as a classification pass later.
2. **`Evidence:` blocks**: pre-flight checks in `review-pr` (prior-art grep,
   infra-exists, callers, sibling scan), gated on severity/category;
   recommendation chosen *after* evidence. Plugin renders evidence folded.
3. **Derived confidence + TLDR header counts**: plugin overview (from A)
   sorts low-confidence first, transcripts folded. This is exactly the
   output surface the self-running discussion loop (`PLAN.md`) needs — the
   loop itself stays a separate later project (a post-handoff skill writing
   `Chat:`/`Resolution:` into the doc; the plugin then merely renders what A
   already supports).

## Sequencing

| Phase | Work | Size | Depends on |
|---|---|---|---|
| 0 | Q — decisions-doc context in chat prompt | S | — |
| 1 | A — overview doc, review-body rendering, PR chat, summary contract | M | — |
| 2 | B — manual threads + `manual` source contract | M | — (parallel with 1 after schema variant agreed) |
| 3 | C — pipeline triggering | M | — (independent; C2 trivially benefits from 1's TLDR) |
| 4 | D1 see-also (S), D2 evidence (M), D3 confidence/TLDR (M) | S+M+M | D3 renders into A's surface |
| 5 | Adversarial discussion loop per `PLAN.md` | L | A, D |

Phases 1–3 are independent enough to interleave; recommended order of landing
is A → B → C because A creates the surface everything later renders into, and
B is the biggest day-to-day friction relief.

## Risks & open questions

1. **Headless skill invocation is unverified.** `claude -p "/review-pr N
   --pipeline"` must run the skill in print mode with workable
   non-interactive permissions. Smoke-test before building C1; fallback is
   running every stage in the integrated terminal (still satisfies R1, less
   seamless).
2. **Parser lockstep.** Every contract change touches `handover-format.md`,
   the skills writers/readers, and the plugin's 8-state parser + serializer +
   round-trip tests. Land skills-side changes as *optional* fields first so
   old docs keep parsing.
3. **Thread anchoring on overview regeneration.** Deterministic layout +
   reconcile pass; covered by renderer tests.
4. **Posting semantics for manual/general items** (decision needed): grouped
   PR comment by default vs. local-only notes. Recommended: grouped comment
   by default, per-item opt-out at finalize.
5. **Manual-item enrichment** (decision needed): auto-run analysis on thread
   creation (cost/latency) vs. on demand. Recommended: on-demand command +
   setting to enable auto.
6. **`CLAUDE.md` drift**: correct the relationships claim until D1 lands.
