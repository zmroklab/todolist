# Date shortcuts: numeric month-day, @tom, and </> deadline move

**Date:** 2026-07-22
**Status:** approved

## Overview

Three small date-handling improvements:

1. A numeric month-day date token: `@07-30` resolves to July 30 of the
   current year (or next year if that date has already passed).
2. `@tom` as a short alias for `@tomorrow`.
3. `>` / `<` keyboard shortcuts that move the selected task's deadline
   one day later / earlier.

All date-token changes land in `Core.parseDateToken`, so they apply
uniformly to quick-add (`@...`), the `s` deadline editor, and the `e`
heading editor. The deadline move gets a new CORE helper so the rule is
unit-testable.

## 1. Numeric month-day token

`Core.parseDateToken` accepts `M-D` — month and day as 1–2 digits each,
separated by `-` only (no `/` or `.`). Examples: `07-30`, `7-30`, `12-1`.

- Resolution: build `YYYY-MM-DD` using the current year (zero-padding
  month and day). If the result is **before** `today` (strictly `<`,
  same rule as the existing `jul30` token — a token equal to today stays
  in the current year), add one year.
- Validation: month must be 01–12 and the day must exist in that month
  of the **resolved** year (so `2-29` is valid only when the resolved
  year is a leap year). Validity is checked by round-tripping the ISO
  string through a UTC `Date` and comparing month/day. Invalid tokens
  (`13-05`, `02-30`, `0-5`) return `null`, which existing callers
  already surface as "Unrecognized date" (editors) or a non-date word
  (quick-add).
- No conflicts: no existing token form starts with a digit except full
  `YYYY-MM-DD`, whose regex requires 4-digit years.

## 2. `@tom` alias

`parseDateToken` treats `tom` exactly like `tomorrow` (one added
condition next to the existing check). `tom` does not collide with
weekday matching: weekday abbreviations are exact 3-letter prefixes of
day names (`tue`, `thu`), and no day name starts with "tom".

## 3. `>` / `<` deadline move

New CORE function, exported from the IIFE:

```js
Core.bumpDeadline(task, delta, today)
```

- If `task.deadline` is set: `setDeadline(task, addDays(task.deadline, delta))`.
- If not: `setDeadline(task, today)` — for either key. The first press
  establishes today as the starting point; subsequent presses move from
  there.
- Marks the task dirty via the existing `setDeadline` path; no new
  serialization behavior.

APP wiring in the main `keydown` handler (two new branches beside the
existing single-key commands):

```js
if (k === '>') return withSel(t => Core.bumpDeadline(t, 1, todayIso()));
if (k === '<') return withSel(t => Core.bumpDeadline(t, -1, todayIso()));
```

`withSel` routes through `mutateTask`, so the save/re-parse flow and the
round-trip invariant are untouched. The deadline lives on the planning
line, not the heading line, so `taskKey` is stable and selection
survives the re-render. Works on sub-tasks the same as top-level tasks
(any selected row).

## UI text updates

- `?` help overlay: add a row for `> / <` ("deadline +1 / −1 day");
  mention `@tom` and `@07-30` wherever date token examples are listed.
- `s` editor placeholder becomes:
  `deadline: 2026-07-22 / jul22 / 7-30 / fri / tom — empty clears`.

## Testing

Unit (CORE, `tests/*.test.mjs`):

- `parseDateToken`: `07-30` and `7-30` resolve with padding; a past
  month-day rolls to next year; a token equal to today stays this year;
  `13-05`, `02-30`, `0-5` → `null`; `2-29` resolves against a leap year
  and returns `null` when the resolved year isn't one; `tom` ===
  `tomorrow`.
- `bumpDeadline`: +1 and −1 from an existing deadline (including month
  boundaries); no deadline → today for both deltas; task marked dirty.

E2E (`tests/ui-e2e.mjs`): one assertion — select a task without a
deadline, press `>`, verify the rendered row shows today's deadline.

## Non-goals

- No `@+N` relative-day tokens.
- No week-sized jumps or modifier variants of `>` / `<`.
- No `/` or `.` separators for the numeric token.
- No `SCHEDULED` support — deadline only, matching the rest of the app.
