# Backlog ordering — design spec

Date: 2026-07-22
Status: approved

## Goal

Let the user re-order the backlog by priority, deadline, or creation time
(newest/oldest first) instead of the fixed topic-grouped file order. Sorting is
view-only: files are never rewritten, the round-trip invariant is untouched.

## Sort modes

A single sort state with five modes, controlled by a `<select>` in the filter
bar and the `r` key (cycles through the modes in order):

| Mode | Order | Missing value |
|---|---|---|
| `topic` (default) | grouped by topic, file order — current behavior | — |
| `priority` | A → B → C → no priority | none last |
| `deadline` | soonest deadline first | no deadline last |
| `created-desc` | newest first, by the `:ADDED:` property | no ADDED last |
| `created-asc` | oldest first, by the `:ADDED:` property | no ADDED last |

- Every non-default mode flattens the backlog into **one list**: no per-topic
  `<h3>` headers, one heading naming the mode ("by priority", "by deadline",
  "newest first", "oldest first"). Rows already show their topic chip.
- Ties keep file order (`Array.prototype.sort` is stable; input is the
  file-ordered flattened list).
- Each mode has one primary key only — no secondary keys (YAGNI).

## Scope

- **Backlog section only.** The radar keeps its own deadline+priority sort;
  Done is untouched. (This differs from the old `recent` chip, which pulled
  radar tasks into the flattened list — the new sort leaves the radar visible
  above the backlog.)
- Backlog lists top-level tasks; sub-tasks still render in file order under
  their expanded parent, unaffected by the sort.
- Filters compose as today: filter first, then sort.

## State & interactions

- New `App.sort` state, default `'topic'`. In-memory, session-only (resets on
  reload, like `App.expanded`). It is **not** a filter: Escape /
  clear-filters does not reset it.
- The `recent` filter chip is **removed** — `created-desc` replaces it.
  `App.filter.recent`, its render branch, chip button, and toggle/highlight
  code all go away. `Core.sortRecent` is deleted (subsumed), with its export
  and unit tests.
- While a non-default sort is active, manual reordering is disabled:
  Alt+↑/↓ and drag-and-drop no-op with a toast (reordering writes file
  order, which is not what's on screen).
- `r` cycles `topic → priority → deadline → created-desc → created-asc →
  topic`. The select is a focusable input: the global keydown handler must
  ignore keys while it has focus (same guard as the other inputs).

## Implementation

**CORE** — one new pure function:

```js
Core.sortBacklog(refs, mode) // returns a NEW sorted array; refs untouched
```

Comparators per the table above; missing values pushed last via sentinel keys
(note: for `created-asc` a missing `added` must still sort last, so the
sentinel differs from the desc case). `buildModel` is untouched.

**APP** —

- `<select id="sort">` in `#filterbar` with the five options.
- In `render()`, where the `recent` branch sits today: if
  `App.sort !== 'topic'`, replace the topic groups with one
  `[label, Core.sortBacklog(flattenedOpen, App.sort)]` group.
- `r` key branch in the main keydown handler (no `preventDefault` needed —
  `r` focuses nothing and has no browser default here), select kept in sync
  both ways (`change` listener → `App.sort` + render; render →
  `select.value`).
- Alt+↑/↓ handler and drag handlers return early with a toast when
  `App.sort !== 'topic'`.
- Help panel: update the backlog description ("grouped by topic, in file
  order" gains a sentence about the sort control) and the shortcut list
  (add `r`, drop the `recent` chip mention if present).

## Testing

- **Unit** (`tests/*.test.mjs`): `sortBacklog` per mode — correct order,
  missing-value placement (priority-less, deadline-less, ADDED-less tasks
  land last in every mode), stability (equal keys keep input order),
  input array not mutated. Remove `sortRecent` tests.
- **E2E** (`tests/ui-e2e.mjs`): switching the dropdown re-orders rows and
  collapses topic headers to one; `r` cycles modes; Alt+↓ while sorted
  shows the toast and leaves the file bytes unchanged.
- Round-trip tests unaffected — sorting never marks tasks dirty and never
  writes.

## Out of scope

- Persisting the sort across reloads.
- Secondary sort keys / multi-key sorting.
- Sorting the radar or Done sections.
- Re-enabling drag-and-drop within a sorted view.
