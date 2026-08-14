# Org-backed Todo Page — Design Spec

Date: 2026-07-18
Status: Approved by user

## Summary

A single-file HTML todo app (`index.html`, all CSS/JS inline, zero dependencies,
no build step) backed by plain org-mode files on local disk. The page reads and
writes the org files directly via the File System Access API (Chromium browsers
only). Editing a file in a text editor updates the page within ~2 seconds;
editing in the page rewrites the org files while preserving hand-written
content byte-for-byte wherever possible.

## Goals (user requirements)

1. Quick-add tasks into a backlog
2. Reorder tasks with a cursor (keyboard-first, drag-and-drop too)
3. Three priorities: A, B, C
4. Group tasks by topic
5. Deadlines
6. Tags
7. Filter by deadline, recently added, tag, priority
8. Image support (paste screenshots)
9. Simple UI that clearly shows what is "on the radar"
10. Rich keyboard shortcuts
11. Live update when source files change on disk
12. Estimates

## Non-goals

- Multi-user or sync across machines
- Firefox/Safari support (File System Access API is Chromium-only)
- Full org-mode feature coverage (agenda, repeaters, clocking, subtask trees)
- Any server, build step, or external dependency

## Architecture

```
index.html          — the entire app (HTML + CSS + JS inline)
tests/              — dev-only Node test suite (node --test); a harness
                      extracts the core-logic script section from index.html
tasks/              — user's data folder (chosen via directory picker)
  work.org          — one org file per topic; filename = topic name
  home.org
  images/           — pasted screenshots
```

### File access

- On first load the page shows an "Open tasks folder" button →
  `showDirectoryPicker()` with read/write mode.
- The `FileSystemDirectoryHandle` is persisted in IndexedDB. On later visits
  the page finds the stored handle and needs a single click to re-grant
  permission (`requestPermission`).
- Browsers without the API get an explanatory banner and nothing else.

### Live sync (requirement 11)

- Poll loop every ~1.5 s: iterate `*.org` files in the directory, compare
  `File.lastModified` against the last-seen value; re-parse only changed files.
- New/deleted `.org` files are picked up by the same loop (topics appear/
  disappear).
- Write safety: before writing a file, re-check `lastModified`; if it changed
  since the last read, re-read and re-parse first, then apply the pending edit
  to the fresh parse. Last-write-wins beyond that (single user).
- UI state (cursor position, expanded task, active filters) survives re-parse;
  tasks are identified across reloads by (file, heading text) with positional
  fallback.

## Data model

### Org syntax (real org-mode, Emacs-compatible)

```org
* NEXT [#A] Ship quarterly report :work:urgent:
  DEADLINE: <2026-07-22 Wed>
  :PROPERTIES:
  :Effort:   3h
  :ADDED:    [2026-07-18 Sat]
  :END:
  Free-form notes.
  [[file:images/ship-quarterly-report-1.png]]
```

- **Task** = top-level heading (`* `). Nested headings are treated as part of
  the parent task's body (preserved verbatim, not parsed as tasks).
- **States**: `TODO` (backlog), `NEXT` (on the radar), `DONE` (finished;
  serializer adds `CLOSED: [timestamp]` line when marking done).
- **Priority**: `[#A]` / `[#B]` / `[#C]` cookie after the state keyword;
  absent = no priority.
- **Tags**: `:tag1:tag2:` at end of heading line.
- **Deadline**: `DEADLINE: <YYYY-MM-DD Day>` on the line after the heading.
- **Estimate**: `:Effort:` property (values like `30m`, `2h`, `1d`).
- **Added timestamp**: `:ADDED:` property, `[YYYY-MM-DD Day]` inactive
  timestamp, written automatically by quick-add; powers the "recently added"
  filter. Hand-created tasks without `:ADDED:` sort last in that filter.
- **Topic** = the file the task lives in (`work.org` → topic "work").
- **Order** = order of headings within the file.

### Round-trip safety

The parser splits each file into an ordered list of blocks: a leading
pre-heading block (file preamble, `#+TITLE:` etc.) plus one block per top-level
heading. Each block keeps its raw source text. Only blocks the user edits
through the UI are re-serialized; all other blocks — and any unrecognized
lines *inside* an edited block's body — are written back verbatim. Parse →
serialize with no edits must be byte-identical.

A file that fails to parse (should be rare given the permissive block model)
renders read-only with a warning; the app never rewrites a file it could not
parse.

## UI

### Layout (single column)

```
┌──────────────────────────────────────────────┐
│ [+ add task…]        filter: ⏰ 🏷 #A recent │
├──────────────────────────────────────────────┤
│ ── ON THE RADAR ──────────────────────────── │
│ ▸ A  Ship report        work  ⏰ Jul 22  3h  │
│ ▸ B  Renew insurance    home  ⏰ Jul 20  1h  │
│                                              │
│ ── BACKLOG ───────────────────────────────── │
│ Work                                         │
│   ▸ B  Refactor parser              :api: 2h │
│   ▸ C  Update docs                       1h  │
│ Home                                         │
│   ▸ C  Garage cleanup                    4h  │
│                                              │
│ ▸ Done (12)                       [collapsed]│
└──────────────────────────────────────────────┘
```

- **On the radar** = all `NEXT` tasks + any non-DONE task with a deadline
  within the next 7 days (constant in code). Sorted by deadline (soonest
  first, no-deadline last), then priority A→C.
- **Backlog** = remaining `TODO` tasks grouped by topic, in file order.
- **Done** = collapsed section at the bottom, hidden until expanded.
- Task row: priority pill (A red, B amber, C gray), title, topic chip, tag
  chips, deadline badge (overdue red / today orange / within-week amber),
  estimate. Clicking a tag or topic chip applies that filter.
- Expanding a task (Enter/o/click) shows its body: notes and inline images.

### Quick-add (single input, token syntax)

```
work: Ship report #A :urgent: @jul22 ~3h
```

- `topic:` prefix → target file (default: last-used topic; a new topic name
  creates a new file after confirmation)
- `#A` / `#B` / `#C` → priority
- `:tag:` → tags (repeatable)
- `@…` → deadline; accepts `@2026-07-22`, `@jul22`, `@tomorrow`, `@fri`
  (next occurrence)
- `~3h` → estimate
- Everything but the title is optional. A live hint line below the input
  shows the parsed interpretation before Enter is pressed.
- New tasks are appended to the end of the topic file with state `TODO` and
  an `:ADDED:` property of today.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `j` / `k`, `↓` / `↑` | move cursor between tasks |
| `Enter` / `o` | expand/collapse selected task |
| `Alt+↑` / `Alt+↓` | move task up/down within its topic (rewrites file order) |
| `a` | focus quick-add input |
| `e` | edit selected task's heading inline (same token syntax) |
| `n` | toggle TODO ↔ NEXT (on/off the radar) |
| `d` | mark DONE (adds CLOSED timestamp) / undo back to TODO |
| `1` / `2` / `3` / `0` | set priority A / B / C / none |
| `s` | set deadline (small date input) |
| `t` | edit tags |
| `E` | edit estimate |
| `/` | focus filter/search |
| `Esc` | clear filter / close editor / collapse |
| `?` | shortcut help overlay |

Drag-and-drop reordering with the mouse is also supported and persists the
same way (file order rewrite).

### Filters

Filter chips in the top bar plus `/` free-text search over titles, tags and
topics. All combinable; active filters apply to radar and backlog alike:

- **Deadline**: overdue / today / this week
- **Priority**: A / B / C
- **Tag**: any tag present in the data
- **Topic**: any file
- **Recently added**: sorts all open tasks by `:ADDED:` descending

### Images (requirement 8)

- With a task selected/expanded, paste an image from the clipboard →
  saved as `tasks/images/<task-slug>-<n>.png` through the directory handle,
  and `[[file:images/…]]` is appended to the task body.
- `[[file:…]]` links to image extensions render inline (object URLs read via
  the directory handle) when the task is expanded.

## Error handling

- Unsupported browser → banner explaining the Chromium requirement.
- Permission lost/revoked → prominent "re-grant access" button; UI stays
  visible read-only from last parse.
- Write failure → error toast, in-memory edit retained, retry on next action.
- Unparseable file → read-only rendering with warning, never rewritten.

## Testing

- `tests/` (dev-only, Node built-in test runner: `node --test 'tests/*.test.mjs'`; a
  harness extracts the pure-logic script section from `index.html` and
  evaluates it, so the app stays a single file):
  - Round-trip: parse → serialize is byte-identical for a corpus of org
    samples, including odd whitespace, unknown drawers, nested headings.
  - Parser unit cases: state/priority/tags extraction, DEADLINE, properties,
    quick-add token parsing (all `@date` forms), estimate parsing.
  - Serializer cases: each UI mutation (state change, priority, tags,
    deadline, reorder, append task, add image link) produces the expected
    org text and touches only the edited block.
- Manual smoke checklist: live-update from an external editor save, image
  paste, permission re-grant flow.
