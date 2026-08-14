# Nested Tasks — Design

Date: 2026-07-18
Status: approved
Amends: `2026-07-18-org-todo-page-design.md` (supersedes its rule that nested
headings are opaque body text).

## Goal

Sub-headings (`** `) become real tasks: full metadata parity with top-level
tasks, own radar rows, creatable and reorderable from the UI. One level of
nesting only — `***` and deeper stay verbatim body text.

## Decisions (from brainstorming)

- **Scope**: full sub-task support (not display-only).
- **Depth**: one level. Tasks (`*`) and sub-tasks (`**`); `***`+ headings are
  preserved verbatim inside the nearest sub-task's body, never parsed.
- **Radar**: a sub-task that qualifies (NEXT, or deadline within 7 days) gets
  its own radar row, labeled `Parent title › sub-task title`.
- **State links**: none. Parent and child states are independent; no cascade,
  no auto-complete.
- **Creation**: `A` (Shift+A) on the selected row opens an inline input below
  it; input accepts quick-add tokens; a `** TODO` is appended to the parent's
  children. With a sub-task selected, `A` adds a sibling under the same
  parent. The quick-add bar remains top-level-only.
- **Done display**: DONE sub-tasks stay nested under their parent, struck
  through. The Done section lists only top-level DONE tasks.
- **Visibility**: ~~sub-task rows are always visible under their parent (no
  collapse state).~~ Superseded by
  `2026-07-18-notes-and-folding-design.md`: rows fold; children render only
  when the parent is expanded.
- **Reordering**: within-parent only (Alt+↑/↓ and drag). No re-parenting, no
  promotion/demotion.
- **Feature parity**: every task field and shortcut (priority, deadline, tags,
  effort, notes/body, heading edit, screenshots) works on sub-tasks.

## Data model (CORE)

Chosen approach: **explicit tree** (over flat-list-with-level and render-time
parsing). Every invariant — round-trip, subtree moves, identity — has one
obvious home in the tree.

- Task objects gain `level` (1 or 2). Level-1 tasks gain `children: []`;
  sub-tasks have the same shape but no `children` of their own.
- `parseOrg` keeps its file split on `* `. `parseTaskBlock` then splits the
  block on `\n** ` boundaries: the first segment is the parent's own
  `raw` (heading, planning, properties, body up to the first sub-heading);
  each remaining segment parses as a sub-task with its own `raw`/`dirty`.
- **Semantic change**: a parent's `raw` no longer includes its sub-headings.
- `renderTask` emits `**` for level 2. Parent body (notes, images) serializes
  before children — required by org structure, since any line after a `** `
  heading belongs to that sub-tree.
- `serializeFile` writes
  `preamble + Σ [ (t.dirty ? renderTask(t) : t.raw) + Σ children likewise ]`.
  The split preserves every byte, so the round-trip invariant
  (`serializeFile(parseOrg(text)) === text` with no edits) holds unchanged,
  and now editing one sub-task rewrites only that node — not its siblings or
  parent.
- `moveTask` gains a sibling-scoped variant operating on `parent.children`;
  at level 1 it splices `file.tasks`, and the tree makes "moving a parent
  carries its subtree" automatic.

## Identity, selection, mutations (APP)

- `taskKey(t)` stays "first line of the heading block".
- Refs gain an optional `parent` (the parent ref). A sub-task's `refKey` is
  `topic \t parentKey \t childKey`; identical sub-headings under *different*
  parents no longer collide. Under the *same* parent they still do — the
  existing accepted limitation, now parent-scoped.
- `mutateTask` accepts a key path: locate the top-level task by key, then
  optionally descend into `children`. All existing shortcut call sites switch
  from `taskKey(r.task)` to the ref's key path; sub-tasks then inherit every
  shortcut (`n`, `d`, `1/2/3/0`, `s`, `t`, `E`, `e`, expand, paste-screenshot)
  with no per-shortcut work.
- Selection traversal (`j`/`k`) is unchanged: sub-task rows are ordinary
  entries in `App.visible`, and key-based selection survival with positional
  fallback works as-is.

## View model

- `buildModel` emits refs for sub-tasks too, each carrying its parent ref.
- Sub-task rows render indented under their parent **wherever the parent row
  appears** — backlog, radar, or Done — so children never vanish when the
  parent changes section.
- Independently, a qualifying sub-task also gets its own radar row labeled
  with its parent. (It may then appear twice: once as a radar row, once
  nested under its parent. Accepted.)
- Radar sorting treats sub-task rows exactly like task rows (deadline, then
  priority).
- **Filters (family rule)**: if a parent or any of its sub-tasks matches the
  active filters, the whole family stays visible. Avoids orphaned indented
  rows; forgiving by design. Standalone sub-task radar rows match on their
  own fields.
- Done section: top-level DONE tasks only (children render beneath them,
  struck through, per the "wherever the parent appears" rule).

## UI details

- Sub-task rows reuse `taskRow` plus an indent class.
- `A` follows the existing `inlineEdit` pattern (single idempotent `close()`;
  `preventDefault()` so the triggering key doesn't leak into the input).
  Input is parsed with `parseQuickAdd` (topic token ignored); title required.
- The `e` WYSIWYG heading editor behaves identically on sub-tasks — leading
  stars are not part of the edited line.
- Drag-and-drop: drops are rejected unless same topic **and** same parent
  (same level for top-level tasks), extending the current same-topic rule.
- Radar sub-task row shows `Parent title › sub-task title`; the parent part
  is display-only context, not part of identity.

## Edge cases

- Orphan `** ` heading before any `* ` heading: stays in the file preamble,
  verbatim and unparsed.
- `***`+ headings: verbatim in the nearest sub-task's body.
- A DONE parent with open sub-tasks: the parent (with children) renders in
  Done; open children can still hit the radar via their own rows.
- Existing limitations stand: no CRLF, same-topic drag only, duplicate
  headings under the same parent collide.

## Testing

Unit (CORE, via `tests/harness.mjs`):
- Parser: nested split correctness — planning/properties on sub-tasks, `***`
  retention, orphan `**` in preamble, parent body before children.
- Round-trip: byte-identical on nested fixtures, including odd spacing and
  unknown drawers inside sub-tasks.
- Serializer: marking one sub-task dirty rewrites only that node.
- Model: sub-task refs with parents, radar qualification and labeling data,
  family filter rule, Done placement.
- `moveTask`: sibling-scoped moves; top-level moves carry subtrees.
- `makeTask` at level 2 (`:ADDED:` property, effort).

E2E (`tests/ui-e2e.mjs`): create a sub-task with `A`, toggle its state with
`d`, verify the written file text nests and round-trips.

Fixtures: add a nested example to `sample-tasks/` for manual testing.
