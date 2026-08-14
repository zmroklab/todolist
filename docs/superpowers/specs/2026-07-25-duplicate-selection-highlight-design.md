# Duplicate-selection highlight — design

Date: 2026-07-25
Status: approved

## Problem

A sub-task that qualifies for the radar renders twice with the same `data-rk`:
once as a radar row and once as a nested row under its expanded parent.
`updateSelClass()` toggles `.sel` by `data-rk` match, so both copies get the
identical full highlight and the user cannot tell which row the selection
cursor is actually on when navigating with `j`/`k`.

## Approach

`taskRow()` pushes each ref into `App.visible` in exact DOM creation order, so
the Nth `.task` element in document order corresponds to `App.visible[N]`.
`App.selPos` already disambiguates which copy is current — `moveSel()` uses it
for duplicate keys. The highlight becomes position-aware on the same basis.

### 1. `updateSelClass()` — position-aware classes

Iterate `document.querySelectorAll('.task')` with index `i`:

- `i === App.selPos` and `data-rk === App.sel` → class `sel` (the current copy).
- any other element with `data-rk === App.sel` → new class `sel-dup` (the echo).

Fallback: if the element at `App.selPos` does not match `App.sel` (stale
position), the **first** matching element gets `sel` and the rest get
`sel-dup`.

Exactly one element ever has `.sel`. `.frow.sel` (files panel) is untouched.

### 2. CSS

```css
.task.sel { background:var(--sel); outline:1px solid var(--accent); }   /* unchanged */
.task.sel-dup { background:#eff6ff; outline:1px dashed #93c5fd; }        /* new: lighter echo */
```

### 3. Click sets the clicked copy as current

`row.onclick` currently computes `App.selPos` with
`App.visible.findIndex(r => refKey(r) === App.sel)`, which always resolves to
the first (radar) copy. Change it to the clicked row's own index in
`App.visible` order so clicking the backlog copy makes *it* current.

### 4. Re-render keeps the current copy

The selection-restore in `render()` sets `App.selPos` to the first key match,
which would jump the cursor marker back to the radar copy on any re-render
(expand toggle, poll pickup). Prefer the previous `App.selPos` when
`refKey(App.visible[App.selPos]) === App.sel` still holds — the same
disambiguation `moveSel()` already performs.

## Free improvements

`moveSel()`'s `scrollIntoView` and the inline editors (`e`/`E`/`N`, which anchor
on `document.querySelector('.task.sel')`) now follow the copy the user is
actually on, since `.sel` is unique.

## Out of scope

- De-duplicating the rows themselves (`refKey` is identity for key-path
  mutations — documented accepted quirk).
- Files-panel (`.frow`) selection.

## Documentation

Update the CLAUDE.md gotcha bullet: selection no longer "highlights both and
normalizes to the radar copy"; the current copy (tracked by `App.selPos`)
gets `.sel`, the other copy gets the lighter `.sel-dup`, and the inline editor
opens under the current copy.

## Testing

APP-layer change, so e2e (`tests/ui-e2e.mjs`) only:

- Duplicated radar sub-task, selection on the radar copy: exactly one `.sel`
  (at index `App.selPos`) and exactly one `.sel-dup` on the other copy.
- Navigate (or set selection) to the backlog copy: `.sel`/`.sel-dup` swap.
- Click the backlog copy: it becomes `.sel` (selPos = its index), radar copy
  becomes `.sel-dup`.
- Re-render (e.g. `render()` call) with selection on the backlog copy:
  `App.selPos` and the `.sel` element stay on the backlog copy.
- Non-duplicated task: one `.sel`, zero `.sel-dup` (regression guard).

Existing unit tests are unaffected (no CORE change).
