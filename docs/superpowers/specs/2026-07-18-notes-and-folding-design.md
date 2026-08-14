# Notes editing + fold/unfold — design

Date: 2026-07-18
Status: approved direction (Approach A for both features)

## Problem

Enter/`o` toggles a task's notes (body text), but the app has no way to create
or edit notes — body content only enters via a text editor or the screenshot
paste. Users press expand, nothing appears, and the shortcut looks broken.
Separately, sub-task rows are always visible, so long lists of children
clutter the backlog and there is nothing for a disclosure toggle to disclose.

Two features, one mental model: every row has a single expanded/collapsed
state; expanding shows *everything* the row hides (notes and sub-task rows),
and a new shortcut lets you write the notes in the first place.

## Feature 1: notes editing (`N`)

- `N` (Shift+n) on the selected row opens a multi-line editor below it —
  works on top-level tasks, nested sub-task rows, and radar context rows,
  exactly like the other field editors.
- The editor is the existing `inlineEdit` generalized with a multiline mode:
  a `<textarea>` instead of an `<input>`, sharing the same idempotent
  `close()` (the blur-fires-synchronously-mid-removal gotcha must not be
  re-solved twice).
  - Plain Enter inserts a newline.
  - **Cmd/Ctrl+Enter commits.** Escape or blur cancels.
  - Single-line callers keep today's semantics (Enter commits) untouched.
- Prefill: the task's body lines, each dedented by up to two leading spaces
  (same rule the body view uses for display). Image links
  (`[[file:images/…]]`) and verbatim `***` org content appear as plain text
  and pass through unchanged if not edited.
- Commit calls `mutateTask(topic, keyPath(r), t => Core.setBody(t, lines))`
  where `lines` is the textarea split on `\n` with trailing blank lines
  trimmed (interior blank lines are kept). An empty textarea clears the notes.
- After a successful commit with non-empty notes, the row's key is added to
  `App.expanded` so the result is immediately visible.

### CORE: `setBody(task, lines)`

New exported mutation: replaces `task.body` with the given lines, each
non-blank line indented by two spaces (blank lines stay empty), and marks the
task dirty. The forced two-space indent is also the safety guarantee: no note
line can start at column 0, so no edit can fabricate a `*`/`**` heading and
split the file's block structure on the next parse. Verbatim `***`+ lines are
exempt and stay at column 0 — only `*`/`**`-shaped lines are what the indent
guards against, since only those can split blocks.

Round-trip note: re-indenting is safe because `setBody` marks the task dirty —
the byte-for-byte round-trip invariant applies only to untouched blocks. The
serializer's output must still re-parse to an identical model (covered by
tests).

## Feature 2: fold/unfold (Enter/`o`)

- `App.expanded` (the existing refKey-keyed Set) becomes the row's single
  disclosure state. Enter/`o` toggles it, as today.
- **Expanded** row: notes visible (as today) *and* sub-task rows rendered
  beneath it (new).
- **Collapsed** (default, incl. fresh page load): notes hidden *and* sub-task
  rows not rendered. This supersedes the nested-tasks spec's "sub-task rows
  are always visible under their parent (no collapse state)".
- State is in-memory only; a reload starts collapsed. No persistence.

### Discoverability indicators

- A parent row with children shows ▸ (collapsed) / ▾ (expanded) plus a
  sub-task count chip (`▸ 3` / `▾ 3`) in its meta area.
- A row with note content shows a small `≡` chip, so an expandable body is
  visible before you expand it (the gap that triggered this design).

### Interactions with existing behavior

- **Radar is unaffected by folding.** A NEXT sub-task with a near deadline
  keeps its own radar row (ctx mode, `Parent › child` label) even while its
  parent is collapsed in the backlog. Expanding a radar ctx row shows its
  notes only.
- **Selection:** collapsing a parent whose child is selected removes the child
  row from `App.visible`; the existing key-miss positional fallback moves the
  selection. No new mechanism.
- **`A` (create sub-task)** on a collapsed parent auto-expands it so the new
  sub-task row and its editor are visible.
- The radar-duplicate quirk stands: an expanded sub-task that also qualifies
  for the radar renders its notes under both copies (same `data-rk`).
- Help panel (`?`): Enter/`o` row becomes "expand / collapse (notes +
  sub-tasks)"; new row for `N` ("edit notes").
- **Filters/search:** while any filter is active, a sub-task that itself
  matches renders even under a collapsed parent — a search hit must never be
  hidden behind a fold.

## Out of scope

- Persisting fold state across reloads.
- Editing planning lines or `:PROPERTIES:` from the notes editor (they are
  parsed out before the body and never appear in the textarea).
- Rich text / markdown rendering of notes.
- Re-parenting, deeper nesting — unchanged accepted limitations.

## Testing

- **Unit (CORE):** `setBody` replaces/clears body, indents non-blank lines,
  preserves interior blanks, marks dirty; serialize → parse → serialize is
  stable for edited tasks; a note line starting with `*` cannot create a new
  heading after re-parse.
- **e2e:** `N` opens a textarea with dedented prefill; typed multi-line note +
  Cmd+Enter writes indented body to the org file and the row auto-expands;
  Escape cancels without writing. Parent row starts collapsed (no sub rows in
  DOM), Enter expands (children + notes visible), Enter collapses; radar row
  for a qualifying sub-task exists while its parent is collapsed.
