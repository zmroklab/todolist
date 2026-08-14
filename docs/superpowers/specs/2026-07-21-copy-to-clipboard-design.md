# Copy tasks to clipboard — design

Date: 2026-07-21
Status: approved

## Goal

Copy the selected task to the system clipboard from the keyboard, in two
forms: a plain title for pasting into chats/emails, and the raw org block for
pasting into other `.org` files.

## Behavior

- `y` — copy the selected task's **title** as plain text (just `task.title`,
  no state/priority/tags/dates).
- `Y` — copy the selected task's **org block**:
  - On a top-level task: the whole subtree — the task's own block plus all
    `**` sub-task blocks, byte-identical to what the serializer would write
    for that subtree.
  - On a sub-task: just that sub-task's block.
- Both act on the current selection (`selRef()`); with no selection they are
  no-ops, like the other single-key actions.
- Feedback via the existing `toast()`: “Copied title” / “Copied org block”;
  a clipboard write failure shows “Copy failed”.
- Both keys appear in the `?` help table.

## Architecture

**CORE** gains one exported function:

```
Core.subtreeText(task) -> string
```

Returns the org text for the task and (for level-1 tasks) its children, using
the serializer's own rule per node: `t.dirty ? renderTask(t) : t.raw`. Newline
handling matches `serializeFile` — each node's text ends with exactly one
`\n`-terminated block before the next child is appended, so a copied subtree
pasted into an org file round-trips. `subtreeText` must not touch
`document`/`window` (CORE rule).

**APP** adds two branches to the main `document` keydown handler, alongside
the other single-key actions:

- `y`: `navigator.clipboard.writeText(r.task.title)` → toast.
- `Y`: `navigator.clipboard.writeText(Core.subtreeText(r.task))` → toast.
- Errors from `writeText` are caught → `toast('Copy failed')`.

No `preventDefault()` subtleties: neither key focuses an input.
`navigator.clipboard.writeText` is sufficient — the app is Chromium-only, so
no `execCommand` fallback.

## Edge cases

- **Dirty (edited, unsaved) task**: copies the current in-memory state via
  `renderTask`, not the stale on-disk text.
- **Sub-task selected on the radar** (duplicate render): `selRef()` already
  normalizes selection; copy behaves like any other key-path action.
- **Read-only (unparseable) files**: their tasks never reach the task list,
  so no special handling.

## Testing

- Unit tests (`tests/*.test.mjs`) for `Core.subtreeText`: clean level-1 task,
  task with body/drawers preserved verbatim, parent with multiple children,
  a child node alone, dirty node rendering, trailing-newline joins.
- E2e: extend `tests/ui-e2e.mjs` with a stubbed `navigator.clipboard` to
  assert `y`/`Y` write the expected strings and toast; if stubbing proves
  awkward, manual verification is acceptable — the logic under test lives in
  CORE.

## Out of scope

- Copying multiple tasks / selections (no multi-select exists).
- Cut/paste of tasks between files (`m` already moves tasks).
- Copying images attached to a task.
