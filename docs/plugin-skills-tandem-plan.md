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

1. **Relationships** (`see-also` → typed edges) — expanded below; the
   connective tissue for Q, A, B, D3, and `execute-review-decisions`.
2. **`Evidence:` blocks**: pre-flight checks in `review-pr` (prior-art grep,
   infra-exists, callers, sibling scan), gated on severity/category;
   recommendation chosen *after* evidence. Plugin renders evidence folded.
3. **Derived confidence + TLDR header counts**: plugin overview (from A)
   sorts low-confidence first, transcripts folded. This is exactly the
   output surface the self-running discussion loop (`PLAN.md`) needs — the
   loop itself stays a separate later project (a post-handoff skill writing
   `Chat:`/`Resolution:` into the doc; the plugin then merely renders what A
   already supports).

### D1 in detail — relationships

`CLAUDE.md` promises `relationships: [{ id, type }]` with
`type ∈ same-fix | same-root-cause | dependent | conflicting | same-pattern`,
but nothing produces, stores, or consumes them today.

**Prerequisite — identity moves upstream.** Edges reference item IDs, but IDs
are currently minted by the *plugin* at load time (`src/schema/stamp.ts`
stamps missing IDs); the pipeline writes docs with no stable identity.
Before any edge can exist, `review-pr`/`investigate-pr-comments` must stamp
IDs when writing the doc (`handover-format.md` gains the id field as
required-on-write), with `stamp.ts` retained as a fallback for legacy or
hand-written docs.

**Producer.** Per the repo's three-concerns split, relationship inference is
review-agent work (out-of-process, frozen output) — never plugin runtime:

- `review-pr` aggregation (Step 8): mechanical candidate generation by
  `(file, symbol/proximity)` clustering, then an LLM classification pass
  over candidate pairs to assign types. `same-pattern` and `same-fix` fall
  out of clustering nearly free; `same-root-cause`, `dependent`,
  `conflicting` need the classification pass.
- `investigate-pr-comments` merge step: cross-source edges (auto finding ↔
  human comment on the same code) — it already detects these overlaps for
  its `**Note:** also flagged by` annotation; typing the edge is the same
  work, kept instead of discarded.

**Contract.** Per-item `**Related:**` block in `handover-format.md`
(`- same-fix: <id> (file:line)`); plugin side `relationships: [{id, type}]`
on `FindingItemBase`, parser/serializer + round-trip tests. Optional field —
old docs parse unchanged. Parser must tolerate dangling edge targets (items
can be hand-deleted from the doc).

**Consumers — what each edge type buys, mapped to the plan:**

| Edge | Consumer | Effect |
|---|---|---|
| any | Q (chat digest) | digest becomes *targeted*: related items' decisions inlined verbatim instead of a global decided-items list — the bounded context `CLAUDE.md` specifies (`hunk + comment + relationships + thread`) |
| `same-fix` | thread actions; `execute-review-decisions` | deciding one offers to subsume siblings; executor groups the cluster into one commit |
| `same-pattern` | thread actions; D3/PLAN.md loop | batch-decision offer ("apply to all 4?"); a `same-pattern` edge to an already-decided item = the durable-precedent signal that makes a taste call *medium* instead of *low* confidence |
| `same-root-cause` | A (overview), navigation | cluster-grouped TLDR ("12 findings in 7 clusters"); jump between related threads |
| `dependent` | thread ordering | sort/visit order hint |
| `conflicting` | decision guard | warn when both sides are marked `[x]` before execute |

**Sequencing within D1.** Two stages, deliberately: **D1a** — upstream ID
stamping + untyped `see-also` edges + plugin parse/render + targeted Q
digest (the plumbing is the expensive part, and it's shared). **D1b** — the
typing pass, consumed conservatively at first (display + digest only);
auto-subsume and batch decisions are enabled only after observed edge
precision justifies letting edges drive decisions. The PLAN.md loop consumes
edges for cluster-at-once discussion and precedent matching once D1b exists.

## Sequencing

| Phase | Work | Size | Depends on |
|---|---|---|---|
| 0 | Q — decisions-doc context in chat prompt | S | — |
| 1 | A — overview doc, review-body rendering, PR chat, summary contract | M | — |
| 2 | B — manual threads + `manual` source contract | M | — (parallel with 1 after schema variant agreed) |
| 3 | C — pipeline triggering | M | — (independent; C2 trivially benefits from 1's TLDR) |
| 4 | D1a ids + see-also (M), D1b typed edges (M), D2 evidence (M), D3 confidence/TLDR (M) | 4×M | D1a before D1b; D3 renders into A's surface |
| 5 | Adversarial discussion loop per `PLAN.md` | L | A, D |

Phases 1–3 are independent enough to interleave; recommended order of landing
is A → B → C because A creates the surface everything later renders into, and
B is the biggest day-to-day friction relief.

## Dependencies between tasks

Hard dependencies (order is forced):

1. **Schema-home decision (#17) gates every contract-touching item.**
   `ktrz/skills` vendors a byte-for-byte copy of this repo's parser
   (`_shared/handover-validator/`, pinned to a commit) and validates docs
   before emitting. So each contract change — A's `## Summary`, B's `manual`
   source, D1a's IDs + `Related:`, D2's `Evidence:`, D3's confidence — is a
   three-step dance: plugin parser/serializer change → skills writer change
   → vendored-validator re-pin. Either settle #17's schema home (shared
   package vs monorepo vs vendor+freshness) **before** the contract-heavy
   workstreams, or consciously batch the field additions into as few
   re-pin rounds as possible (A+B+D1a fields in one round is feasible).
2. **B's creation flow is a prerequisite for A's last piece.** "New
   PR-level threads on the overview doc" (A.5) and "manual threads on file
   lines" (B.2) are the same mechanism: empty thread + first reply → new
   `manual` item. Build it once in B; A.1–A.4 (render, chat, summary) don't
   need it and can land first, but A is only *complete* after B's creation
   machinery exists.
3. **P0 external-edit RMW race blocks C3.** `resolve-pr-comments
   --from-doc` writes decisions into the findings doc **while the plugin
   has it loaded with live threads** — exactly the external-edit-during-RMW
   race flagged as a P0 known limitation. Today the race needs a human
   editing the file at the wrong moment; C3 makes a concurrent external
   writer routine. Land the pre-write disk-sha check + watcher-reload-joins-
   `runExclusive` fix before shipping C3 (and before C2 to the extent the
   executor ever writes back).
4. **D1a → D1b → edge-driven UI.** Upstream ID stamping + untyped edges
   (plumbing) before the typing pass; typed edges displayed before they
   drive anything (auto-subsume, batch apply, conflict guard).
5. **A → D3 → adversarial loop.** D3's confidence sorting and TLDR render
   into A's overview surface; the PLAN.md loop needs both (it writes
   `Chat:`/`Resolution:` that A renders, sorted by D3's confidence).
   D1b feeds the loop's precedent matching but is enhancing, not blocking.

Soft dependencies (cheaper in this order, not forced):

- **Q before A's PR chat** — both extend `prompt-builder`; Q's
  doc-path + digest plumbing is what A's PR-level prompt variant reuses.
  (D1b later turns Q's global digest into a targeted one.)
- **P0 CLI preflight before C1** — once the plugin spawns multi-minute
  pipeline jobs, failing at activation beats failing mid-run.
- **Build C1's pipeline-runner on `--output-format stream-json` from day
  one** — P0 streaming is planned for chat anyway; don't build the job
  runner blocking and convert it later.
- **Batch B's `manual` tag with D1a's ID/`Related:` fields** if they land
  near each other — one parser + vendored-validator round instead of two.

```
#17 schema home ──────────┐ (gates all contract changes)
                          ▼
Q ──────────────► A.1–4 ──► D3 ──► PLAN.md loop
                  ▲   ▲            ▲
B (creation flow)─┘   │            │
P0 RMW fix ──► C3     │   D1a ──► D1b
P0 preflight ─► C1 ───┘ (auto-load feeds A)
```

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
7. **Edge quality gates edge power.** A misclassified `same-fix` edge that
   auto-subsumes a decision is worse than no edge. Consume edges as
   display/context first (D1a/D1b), and let them drive decisions
   (subsume/batch/conflict-block) only after precision is observed in use.
