# Share filters (privacy presets) — design

Date: 2026-07-24
Status: approved design, pre-implementation

## Problem

The user shares their screen with colleagues. Home/personal tasks and action
items about direct reports (tagged with their names) must not be visible.
Today's quick filters (tag/topic chips, search) are single-value, ephemeral,
and cleared by `Esc` — one stray keypress exposes everything. The user needs
named, persistent filters combining files and tags, e.g.
`flo and !elena and !volha` = "show only flo, minus anything tagged elena or
volha", switchable and editable at any time.

## Decisions (from brainstorming)

- Bare words match **topic OR tag** (no prefixes).
- **Hide everywhere**: task lists, Done, search, files panel, move-file list.
- **Multiple named presets**, picked from a dropdown / cycled by key.
- Presets **and the active preset persist** across reload (no flash of
  hidden tasks).
- The preset is a **base layer**: quick filters compose on top; `Esc` clears
  only quick filters, never the preset. Deactivating is a deliberate action.

## Expression syntax & semantics

An expression is a whitespace-separated list of terms; the word `and`
(case-insensitive) between terms is optional sugar, so `flo and !elena` and
`flo !elena` are equivalent. A term is a bare word (**include**) or
`!word` (**exclude**). Words use the tag charset `[A-Za-z0-9_@#%-]` and match
case-insensitively.

A word matches a task when it equals the task's **topic** (file name without
`.org`) or any of the task's **tags**. Sub-tasks inherit their parent's tags
for matching (org-style), so `!elena` on a parent hides its whole subtree.
A sub-task's own tags never affect its parent's visibility.

**Positives are a union; negatives are strict.** A task is visible iff:

- it matches **at least one** include term (only when include terms exist), and
- it matches **no** exclude term.

Rationale: a task lives in exactly one file, so a literal `flo and work`
could never match; "share flo and work stuff" means the union. Exclusion
always wins over inclusion.

Edge cases:

- Only negatives (`!home`): everything except matches.
- Empty expression: matches everything (equivalent to off).
- Malformed expression (invalid characters, a dangling `!` with no word,
  leading/trailing/doubled `and`, `!and`): parse error. If such a preset is
  active the app **fails closed** — shows no tasks plus an error notice —
  never accidentally exposes rows.

## Core additions

Pure functions inside the Core IIFE, exported via its `return {...}`,
covered by unit tests; no DOM/browser APIs.

- `parseShareExpr(str)` → `{ include: string[], exclude: string[] }` on
  success (words lowercased), or `{ error: string }` on malformed input.
  Empty/whitespace-only input parses to `{ include: [], exclude: [] }`.
- `matchesShare(topic, task, parentTask, expr)` → boolean implementing the
  semantics above. `parentTask` is `null` for top-level tasks; for sub-tasks
  the parent's tags are merged into the candidate tag set. An `expr` with
  `error` matches nothing (fail closed at the matcher level too).

## Where hiding applies (APP)

The active preset is applied in `render()` as a base visibility pass
**before** the existing quick-filter pass (`Core.matchesFilter`):

- **Radar / backlog / Done**: excluded refs never enter `App.visible`; the
  Done counter counts only visible tasks; a backlog topic group with zero
  visible tasks disappears entirely (no `home` group header). The share layer
  is strictly per-task: a sub-task matching an include word never reveals a
  non-matching parent — tag the parent to share a family (sub-tasks inherit
  its tags). Such a sub-task still gets its own radar row when it qualifies.
  That radar row shows `…` in place of the hidden parent's title.
- **Search**: unchanged code path — it already filters what the base pass
  produced.
- **Files panel (`F`), including its connect-picker list**: while a preset is
  active, hide topics that can never match (topic not in the include list
  when includes exist, or topic matches an exclude term). `home.org` is not
  visible in any chrome. Disconnect/connect actions on hidden files are
  simply unavailable while filtered — turn the preset off to manage them.
- **Move (`m`)**: the prompt is free text (no list), so nothing to hide;
  moving a task to a topic hidden by the active preset succeeds and shows an
  explanatory toast (`Moved to home.org — hidden by share filter "team"`).
- **Quick-add**: a task hidden by the active preset still saves normally;
  the hint line shows `saved — hidden by share filter "<name>"` so it does
  not feel lost. (Transient, replaced by the next hint.)
- **Quick filters** (deadline/priority chips, tag/topic click-filters,
  search text) compose on top of the base layer. `Esc` clears only them.
- **Tag chips on visible tasks render as-is**: if a visible flo task carries
  a sensitive tag, that is a tagging problem the filter cannot guess.
  Likewise, the topic chip of a task included via one of its tags renders
  as-is even when that topic's file name is hidden from chrome — a recorded
  trade-off of topic-OR-tag matching.

The filter is render-only: polling, parsing, and saving are untouched; the
round-trip invariant is unaffected. Radar sub-task duplicate rows follow the
same rule as today (both copies filtered by the same predicate).

## UI

- **Share dropdown** in the filter bar next to the sort dropdown:
  `share: off` (default), one entry per preset (`share: team`), and
  `edit presets…` last. Picking a preset activates it; picking `off`
  deactivates.
- **Edit panel**: styled like the files panel. Lists presets; each row has an
  editable name and expression; add and delete controls. A malformed
  expression shows its parse error next to the row as you type; saving it is
  allowed, activating it fails closed (empty lists + error notice).
  Deleting the active preset deactivates it first.
- **Keyboard**: `S` cycles `off → preset 1 → … → last → off` (mirrors `r`
  for sort). `S` is currently unused. No key opens the edit panel; it is
  reachable only through the dropdown.
- **Indicator**: while active, a highlighted accent-colored chip in the
  filter bar shows the preset name (e.g. `⛊ team`) — always visible so the
  user knows the screen is safe. Clicking it focuses the share dropdown.
  `Esc` never clears it.
- **Help panel** (`?`): new "Share filters" section documenting the syntax,
  the union-of-positives rule, and the `S` key.

## Persistence

`localStorage` keys:

- `sharePresets`: JSON array of `{ name, expr }` (order = dropdown and `S`
  cycle order).
- `shareActive`: active preset name, or absent/null for off.

localStorage is synchronous, so the filter applies before the first render
after reload — hidden tasks never flash. If `shareActive` names a preset
that no longer exists, treat as off. IndexedDB stays reserved for directory
handles (not JSON-serializable); presets are plain values.

## Error handling summary

| Condition | Behavior |
|---|---|
| Malformed expression, preset inactive | Error shown in edit panel row; saving allowed |
| Malformed expression, preset active | No tasks rendered + error notice naming the preset |
| `shareActive` references deleted preset | Treated as off |
| Empty expression active | Everything visible (acts as off, indicator still shown) |

## Testing

- **Unit (Core, `tests/*.test.mjs`)**:
  - `parseShareExpr`: valid single/multi-term, negation, case-insensitivity,
    `and` optionality (`flo !elena` ≡ `flo and !elena`), empty input,
    malformed inputs (dangling `!`, bad chars, doubled/leading/trailing
    `and`).
  - `matchesShare`: topic match, tag match, parent-tag inheritance for
    sub-tasks, positives-as-union, exclude-wins-over-include, only-negatives,
    empty expression, error expression matches nothing.
- **e2e (`tests/ui-e2e.mjs`)**: create a preset via the edit panel, activate
  it, assert home tasks and the `home` group header are absent from the DOM,
  Done count reflects only visible tasks, `Esc` leaves the preset active,
  and a reload (re-init with the same localStorage) comes back filtered.

## Out of scope

- `or`, parentheses, field prefixes (`tag:`, `file:`) — YAGNI until a real
  case needs them.
- Hiding sensitive tags/text on otherwise-visible tasks.
- Per-preset styling or sharing presets between browsers.
