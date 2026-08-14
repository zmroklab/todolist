# Delete task — design

Date: 2026-07-21
Status: approved

## Goal

Delete the selected task from its `.org` file from the keyboard, guarded by a
confirmation dialog. Works on top-level tasks (removing the whole subtree)
and on sub-tasks (removing just that sub-task).

## Behavior

- `X` in the main list deletes the selected row after a native `confirm()`:
  - Top-level task without children: `Delete "«title»"?`
  - Top-level task with children: `Delete "«title»" and its N sub-task(s)?`
    Confirming removes the whole block — sub-tasks, notes, drawers, verbatim
    body lines.
  - Sub-task row (including a radar copy of a sub-task): `Delete "«title»"?`
    Confirming removes only that sub-task's block from its parent.
- Cancelling the dialog changes nothing — the file on disk stays
  byte-identical.
- No selection → no-op, like the other single-key actions.
- Images referenced by the deleted block are left on disk (orphaned files in
  `images/` are harmless and recoverable; org text is git-recoverable, binary
  deletes are not).
- Broken or parse-error files are read-only as usual: their tasks never reach
  the list, so `X` cannot target them.
- `X` appears in the `?` help table.

## Architecture

**CORE** gains one exported function, next to `removeTaskAt`:

```
Core.removeSubtaskAt(file, parentIndex, childIndex) -> string | null
```

Splices the child out of `file.tasks[parentIndex].children`, runs
`normalizeNewlines(file)`, and returns the removed child's block text
(`\n`-terminated, same contract as `removeTaskAt`). Returns `null` when the
parent or child index is out of range. Untouched sibling blocks keep their
`raw` verbatim — the round-trip invariant holds for everything not removed.

Top-level deletes reuse the existing `Core.removeTaskAt(file, index)`
unchanged.

**APP** adds `deleteSel()` wired to `X` in the main keydown handler:

1. Resolve `selRef()`; bail if none.
2. Build the confirm message from `r.task.title` and (top-level only)
   `r.task.children.length`.
3. `confirm(...)` — on cancel, return.
4. `saveFile(entry, file => ...)` with a mutation that re-finds the task by
   key in the fresh parse (`saveFile` re-reads the file from disk first, so a
   stale in-memory parse can never resurrect or double-delete anything):
   - Top-level: `findIndex` by `taskKey` → `Core.removeTaskAt`.
   - Sub-task: find parent index by `taskKey(parent)`, then child index by
     `taskKey(child)` within its children → `Core.removeSubtaskAt`.
   - Task not found in the fresh parse (deleted or renamed externally):
     mutation does nothing; the write is a harmless no-op re-serialize.
5. `render()`. Selection lands on the next row via the existing positional
   fallback (`App.selPos`) — no new selection code.

No `preventDefault()` subtleties: `X` focuses no input. Native `confirm()`
matches the existing topic-file-creation confirms, and the e2e harness
already monkey-patches `confirm` — do not rename that global usage.

## Edge cases

- **Radar duplicate**: a sub-task on the radar renders twice with the same
  `data-rk`; deleting via either copy targets the same key-path, and both
  rows disappear on re-render.
- **External edit between poll and keypress**: handled by `saveFile`'s
  re-read; the key-path lookup runs against the fresh parse.
- **Duplicate sibling headings**: known identity limitation — the first
  match by key is deleted. Same behavior as every other key-path mutation;
  not worsened here.
- **Last task in a file**: the file keeps its preamble (or becomes empty);
  `normalizeNewlines` handles trailing-newline cleanup. The file itself is
  never deleted or disconnected.

## Testing

- Unit tests for `Core.removeSubtaskAt`: middle / first / last child, only
  child, out-of-range indices return `null`, returned block text is the
  child's verbatim raw, untouched siblings round-trip byte-identically,
  newline normalization after removal.
- Unit test composing `removeTaskAt` + `serializeFile` for a parent with
  children (whole subtree gone, remaining file round-trips).
- E2e in `tests/ui-e2e.mjs`: stub `confirm` → `true` and assert the task
  disappears from the written file text (one top-level parent with children,
  one sub-task); stub `confirm` → `false` and assert the file is
  byte-identical.

## Out of scope

- Undo (org files are git-recoverable; no in-app undo exists for any
  mutation).
- Deleting multiple tasks (no multi-select exists).
- Deleting or disconnecting files (the `F` panel owns that).
- Cleaning up images referenced by the deleted block.
