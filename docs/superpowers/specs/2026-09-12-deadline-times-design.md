# Deadline times: an optional hour and minute on a task's deadline

**Date:** 2026-09-12
**Status:** approved

## Overview

A deadline can carry an optional time of day
(`DEADLINE: <2026-08-01 Sat 14:30>`). The time is written the same
WYSIWYG way every other heading field already is — an `@14:30` token that
round-trips through quick-add, the `e` heading editor, and the `s`
deadline editor. Dropping the token clears the time.

The time changes **ordering and display only**. Deadline buckets stay
date-based: a task due today at 09:00 is still "today" (amber) at 15:00,
and never turns red on its own. What the time does is break ties — within
one day the radar runs 09:00, 14:30, then untimed rows — and show up in
the deadline chip.

Org files edited elsewhere may carry a time *range*
(`<2026-08-01 Sat 10:00-11:00>`). The range is preserved verbatim; the
app reads, sorts, and displays its start. Only an explicit time edit
rewrites it. This also closes an existing hole: today's parser drops
everything between the date and the repeater, so a time written in Emacs
disappears the first time the task is edited in the app.

All parsing, serialization, and ordering live in CORE with unit tests.
APP gains only the chip, the editor plumbing, and help text.

## Data model

Each task gains one field:

- `t.time` — the **verbatim time chunk** of the deadline timestamp
  (`"14:30"`, `"09:00"`, `"10:00-11:00"`) or `null`.

`t.deadline` remains a bare `YYYY-MM-DD` string. This is the load-bearing
decision: every existing `<` / `<=` comparison, `addDays`, `addInterval`,
`deadlineBucket`, filter, and sort keeps working unchanged, and day
arithmetic can never corrupt a time.

Storing the chunk verbatim rather than a parsed start/end pair is what
makes range preservation free — an unrelated edit re-emits exactly the
text that was there. A helper derives the part that logic needs:

- `Core.timeStart(time)` → `"10:00"` for `"10:00-11:00"`, `"14:30"` for
  `"14:30"`, `null` for `null`. Used by sorting and display. It also
  zero-pads the hour, so a file written by hand as `9:00` keeps its
  verbatim text but sorts and displays as `09:00` — without the padding,
  `"9:00"` would sort after `"14:30"` as a string.

A time never exists without a date, matching what org can express:
clearing the deadline clears the time.

## Org format

```
DEADLINE: <2026-08-01 Sat 14:30 +1w>
           ^date      ^day ^time ^repeat
```

The time sits between the day name and the repeater cookie, which is
org's own field order. All four elements are independently optional in
input; the serializer emits date and day always, time and repeater when
present.

## Parsing

`parsePlanning`'s deadline regex today is
`/DEADLINE:\s*<(\d{4}-\d{2}-\d{2})[^>]*?(?:\s+(\+\d+[dwmy]))?>/` — the
lenient `[^>]*?` silently eats any time. It gains an explicit time group:

```js
/DEADLINE:\s*<(\d{4}-\d{2}-\d{2})(?:\s+[A-Za-z]{2,})?(?:\s+(\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?))?[^>]*?(?:\s+(\+\d+[dwmy]))?>/
```

- Group 1 → `t.deadline`, group 2 → `t.time`, group 3 → `t.repeat`.
- The day name stays optional and is never stored (it is recomputed on
  write, as today).
- The lenient `[^>]*?` tail **stays**, now positioned after the time
  group rather than swallowing it. Org timestamps can carry a warning
  period (`<2026-08-01 Sat +1w -2d>`) that today's regex tolerates by
  ignoring; a fully strict pattern would fail to match such a line and
  silently drop its deadline. Anchoring the time immediately after the
  date and day name captures it without narrowing what the app accepts.
- A timestamp the regex cannot match at all leaves `t.deadline` null, as
  today — unchanged behaviour for genuinely foreign syntax.

A new token parser handles user input:

- `Core.parseTimeToken(tok)` → normalized chunk or `null`.
  - Accepts `H:MM` and `HH:MM`, normalizing `9:00` → `09:00`.
  - Accepts a range `H:MM-H:MM`, normalizing both halves.
  - Validates hours 0–23 and minutes 0–59; `25:70` → `null`.
  - Rejects everything else, including bare digits and `14.30`.

## Serialization

- `orgActive(iso, repeat, time)` gains a third parameter and emits the
  time after the day name.
- `renderTask` passes `t.time` through.

Because `t.time` holds the original chunk, a dirty task whose time was
never touched re-emits its range byte-for-byte. The round-trip invariant
(`serializeFile(parseOrg(text)) === text` for untouched files) is
unaffected, and the stronger property — an unrelated edit to a task does
not damage its deadline timestamp — now holds for times as well.

## Mutations

- `setDeadline(t, iso, repeat, time)` — fourth parameter. When `iso` is
  null, both `repeat` and `time` are forced to null.
- `setTime(t, chunk)` — sets the time on a task that already has a
  deadline; a no-op when `t.deadline` is null.
- `advanceRepeat` and `bumpDeadline` are **not** modified. They move
  `t.deadline` only, so the time survives day bumps and repeat advances
  for free.

## Quick-add and the heading editor

`parseQuickAdd` gains an `@time` branch, tried **before** the `@date`
branch:

| Input | Result |
|---|---|
| `dentist @fri @14:30` | deadline = the coming Friday, time = `14:30` |
| `standup @9:00` | deadline = today, time = `09:00` |
| `call bob @25:70` | no time; the token falls through to the title |
| `sync @fri @10:00-11:00` | deadline = Friday, time = `10:00-11:00` |

Rules:

- A time with no date defaults the date to today (`out.time && !out.deadline`
  → `out.deadline = today`).
- As with the repeater, a parse that ends with no deadline drops the
  time.

`@` is already the app's "when" sigil, so `@14:30` composes with `@fri`
without a new sigil and without swallowing times that belong in a title
("standup at 9:00" stays intact).

The `e` heading editor composes its line from the same tokens, so it
gains `@14:30` next to `@2026-08-01`, and passes `p.time` through to
`setDeadline` alongside `p.deadline` and `p.repeat`. Per the existing
WYSIWYG rule, deleting the token from the line removes the time from the
task.

## Ordering

Two sorts learn about time, using one shared key:

```js
const dlKey = t => (t.deadline || '9999-99-99') + '\t' + (timeStart(t.time) || '99:99');
```

- **Radar** (`buildModel`): sort by `dlKey`, then priority rank. Untimed
  rows sort after timed ones within the same day; a task with no deadline
  at all still sorts last, as today.
- **Backlog** `deadline` mode (`sortBacklog`): same key. The existing
  "missing values always last, even in desc" rule is preserved by keeping
  the value `null` for tasks with no deadline rather than substituting
  the sentinel.

`deadlineBucket` is deliberately unchanged.

## UI

- **Deadline chip** — `⏰ 08-01 14:30`. A range shows its start only
  (`⏰ 08-01 10:00`); the full range lives in the file and in the `s`
  editor. Bucket colouring is unchanged.
- **`s` deadline editor** — prefills `2026-08-01 14:30 +1w` and accepts
  the time token optionally, anywhere after the date. An unparseable time
  toasts and aborts the edit, exactly like an unparseable date. Empty
  input still clears everything. Placeholder updated.
- **Quick-add hint line** — shows the time beside the date.
- **Help overlay** — a token-table row for `@14:30` and an updated `s`
  description.
- **README** — the token line gains `@14:30`.

## Testing

CORE is unit-testable and carries the whole feature; APP is e2e only, so
the tests concentrate in CORE.

- **parser** — deadline with time; time plus repeater; a range; a
  timestamp with no day name; and a round-trip test proving a range
  survives when a *sibling field* of the same task is edited (making the
  task dirty).
- **serializer** — emitted field order is `date day time repeat`; a
  cleared deadline clears the time.
- **quickadd** — `@fri @14:30`; bare `@14:30` → today; `@9:00`
  normalizing to `09:00`; `@25:70` falling through to the title; a range
  token.
- **model** — radar and backlog ordering for a day mixing timed and
  untimed tasks, asserting untimed last.
- **repeat** — advancing and rolling back a `+1w` deadline preserves
  `14:30`.

`tests/ui-e2e.mjs` needs no change. One timed task is added to
`sample-tasks/` as a live fixture.

## Out of scope

- **Intra-day overdue.** Buckets stay date-based; nothing turns red
  because a time passed. This avoids threading a clock through
  `deadlineBucket` and re-rendering on a timer.
- **Full range editing.** Ranges are preserved and displayed, not
  modelled as start/end. Duration is already expressible as `~2h` effort.
- **Times on SCHEDULED.** `t.scheduledRaw` stays a verbatim passthrough.
- **12-hour display.** Times render as typed, 24-hour, matching the app's
  ISO-style dates.
