# Repeating tasks: org-native deadline repeaters with roll-back

**Date:** 2026-07-25
**Status:** approved

## Overview

Tasks can carry an org-mode **repeater** on their deadline
(`DEADLINE: <2026-08-01 Sat +1w>`). Completing such a task with `d` does
not archive it — it advances the deadline by exactly one interval and
leaves the task open, matching native org-mode repeater semantics. A new
`D` key rolls the deadline back one interval (an exact inverse), so an
accidental completion — or several — can be undone by pressing `D` that
many times.

Recurrence is set WYSIWYG, the same way heading fields already work: the
repeater is a `+1w`-style token that round-trips through the `s` deadline
editor, the `e` heading editor, and quick-add. Dropping the token clears
the recurrence.

Units are `d` (days), `w` (weeks), `m` (months), `y` (years).

All parsing, serialization, and date arithmetic live in CORE with unit
tests. The only APP additions are the `d`/`D` key wiring and a small
recurrence chip.

## Data model

Each task gains one field:

- `t.repeat` — a repeater cookie string (`+1w`, `+2d`, `+3m`, `+1y`) or
  `null`. Always plain `+` (single interval); the `++`/`.+` org variants
  are out of scope.

A repeater only exists **alongside a deadline**. `t.repeat` is parsed out
of the deadline timestamp and is meaningless without `t.deadline`; any
attempt to set a repeater on a task with no deadline is dropped.

## Parsing

The deadline planning line is currently matched by a regex that captures
the ISO date. Extend it to also capture an optional repeater cookie:

```
DEADLINE: <2026-08-01 Sat +1w>
           └─ t.deadline ─┘ └ t.repeat
```

- Repeater grammar: `+` followed by one or more digits followed by one of
  `d w m y` (e.g. `+1w`, `+10d`). Case-sensitive lowercase unit.
- The active-timestamp day name (`Sat`) is derived on render as today and
  is not stored; the repeater sits after it, so parsing must skip the day
  name and any other timestamp content before the cookie.
- A timestamp with no cookie yields `t.repeat = null` (today's behavior,
  unchanged).
- A malformed cookie is not extracted (left as part of the verbatim block
  the way any unrecognized planning content is today); `t.repeat` stays
  `null`.

## Serialization

`orgActive` gains an optional repeater argument:

```js
Core.orgActive(iso, repeat)  // '<2026-08-01 Sat +1w>' or '<2026-08-01 Sat>'
```

`renderTask` passes `t.repeat` when emitting the `DEADLINE:` line. Because
`t.repeat` is only re-rendered when the block is dirty, untouched blocks
pass through `t.raw` verbatim and the round-trip invariant
(`serializeFile(parseOrg(text)) === text`) is preserved.

## Date arithmetic

New CORE helper, exported from the IIFE and unit-tested:

```js
Core.addInterval(iso, sign, repeat)  // returns a new ISO date string
```

- Parses `repeat` into count + unit.
- `sign` is `+1` (advance) or `-1` (roll back). Effective shift is
  `sign * count` of the unit.
- `d` / `w`: day arithmetic (`w` = 7 days), reusing / mirroring `addDays`.
- `m` / `y`: calendar-aware. Add months/years to the year-month, then
  **clamp the day to the last valid day** of the resulting month:
  - `2026-01-31` `+1m` → `2026-02-28`
  - `2028-02-29` `+1y` → `2029-02-28`
  - Roll-back clamps the same way (`2026-03-31` `-1m` → `2026-02-28`).
- Returns `null` for an unparseable `repeat` (callers treat that as
  no-op).

## Mutations (CORE)

```js
Core.advanceRepeat(task, dir)  // dir = +1 advance, -1 roll back
```

(No `today` argument: plain `+` shifts from the stored deadline, not from
today.)

- No-op (returns without touching the task) when `!task.repeat` or
  `!task.deadline`.
- Sets `task.deadline = addInterval(task.deadline, dir, task.repeat)`.
- **Never** sets `state = 'DONE'` and **never** writes `CLOSED:`.
- On advance (`dir === +1`): if the task is currently `DONE` (only
  reachable if an on-disk file was hand-edited that way), reopen it to
  `TODO`. Otherwise the state is left as-is — `NEXT` stays `NEXT`,
  `TODO` stays `TODO`.
- On roll-back (`dir === -1`): state is left untouched.
- Marks the task dirty through the existing `setDeadline` path.

The repeater is carried on the deadline, so the setter used by the
editors handles both together:

```js
Core.setDeadline(task, iso, repeat)  // repeat defaults to null / cleared
```

`setDeadline` sets `task.deadline` and `task.repeat` together and marks
dirty. When `iso` is `null` (deadline cleared), `repeat` is forced to
`null` too — no dangling repeater without a date. `bumpDeadline` (the
`>` / `<` day move) preserves the existing `task.repeat` unchanged.

## Quick-add and heading editor tokens

`Core.parseQuickAdd` recognizes a bare `+N[dwmy]` token and records it as
`out.repeat`:

- Attached to the task **only if** a deadline is also present (from an
  `@date` token). A `+1w` with no `@date` is ignored (dropped silently,
  consistent with "a repeater needs a deadline").
- No collision: no existing token begins with `+`.

The `e` heading editor is WYSIWYG. Its prefilled line gains the repeater
after the `@date`:

```
Water plants @2026-08-01 +1w
```

Omitting `+1w` on save removes the recurrence (same WYSIWYG rule that
already governs `#A`, `:tag:`, `@date`, `~2h`).

## `s` deadline editor

The `s` editor becomes WYSIWYG over the whole timestamp. It is prefilled
with the current deadline and repeater:

```
2026-08-01 +1w
```

- Input is split into a leading date token (parsed by the existing
  `parseDateToken`) and an optional trailing `+N[dwmy]` repeater.
- Empty input clears the deadline (and therefore the repeater), as today.
- A date with no repeater clears any existing repeater (WYSIWYG).
- A repeater with no parseable date is rejected with the existing
  "Unrecognized date" toast (a repeater cannot stand alone).
- Placeholder updated to advertise the repeater, e.g.:
  `deadline: 2026-08-01 / fri / tom [+1w] — empty clears`.

## Keys

- `d` — if the selected task has `t.repeat`, advance it one interval
  (`advanceRepeat(t, +1)`); otherwise the existing DONE/TODO toggle is
  unchanged.
- `D` (Shift-D, currently unbound) — roll a repeating task back one
  interval (`advanceRepeat(t, -1)`). On a non-repeating task, do nothing
  but show a brief toast (e.g. "Not a repeating task"). Press repeatedly
  to step back several occurrences.

Both route through `withSel` → `mutateTask`, so the save / re-parse flow
and the round-trip invariant are untouched. The deadline lives on the
planning line, not the heading, so `taskKey` is stable and selection
survives the re-render. Works identically on sub-tasks.

## Permanently finishing a repeating task

No dedicated mechanism. To stop a recurrence and archive the task:

1. Clear the repeater (drop `+1w` in the `s` or `e` editor) — the task
   becomes ordinary.
2. Press `d` — it now marks DONE and writes `CLOSED:` like any normal
   task.

## Visual cue

A row whose task has `t.repeat` renders a small recurrence chip
(e.g. `🔁 1w`) alongside the existing deadline chip, so recurrence is
visible without opening an editor. The chip shows the raw cookie interval
(`1w`, `2d`, `3m`, `1y`).

## UI text updates

- `?` help overlay: add rows for `d` on a repeating task ("complete →
  advance deadline") and `D` ("roll repeat back one interval"); note the
  `+1w` token wherever date/heading token examples are listed.
- `s` editor placeholder updated as above.

## Testing

Unit (CORE, `tests/*.test.mjs`):

- **Round-trip**: a file with `DEADLINE: <2026-08-01 Sat +1w>` parses and
  re-serializes byte-for-byte; `t.repeat` captured as `+1w`. A deadline
  with no cookie leaves `t.repeat = null` and round-trips unchanged.
- **`addInterval`**: `+1d`, `+2w` forward and back; `+1m` across a short
  month with clamp (`2026-01-31` → `2026-02-28`); `+1y` leap clamp
  (`2028-02-29` → `2029-02-28`); `-1m` clamp (`2026-03-31` →
  `2026-02-28`); unparseable cookie → `null`.
- **`advanceRepeat`**: advance moves deadline one interval and keeps
  state (NEXT stays NEXT); advance on a DONE repeat reopens to TODO and
  never writes CLOSED; roll-back is the exact inverse of advance for each
  unit (including a d/w round trip and an m clamp asymmetry note); no-op
  when `!repeat` or `!deadline`.
- **`setDeadline`**: setting a date + repeat together; clearing the date
  forces repeat to `null`; `bumpDeadline` preserves an existing repeat.
- **`parseQuickAdd`**: `+1w` with an `@date` sets `out.repeat`; `+1w`
  without a date is dropped; token order independent.

E2E (`tests/ui-e2e.mjs`): select a repeating task, press `d`, verify the
rendered deadline advanced one interval and the state did not become
DONE; press `D`, verify it returned to the original deadline.

## Non-goals

- No `++` / `.+` org repeater variants (catch-up / from-today). Plain `+`
  only, for an exact `D` inverse.
- No `SCHEDULED` repeaters — deadline only, matching the rest of the app.
- No completion logging (`LOGBOOK`, `:LAST_REPEAT:`). Completing a repeat
  only shifts the deadline.
- No general multi-step undo across arbitrary actions — that is a
  separate future feature. `D` covers stepping a repeat back only.
- No one-key "finish permanently" shortcut; the clear-then-`d` two-step
  is the finish path.
