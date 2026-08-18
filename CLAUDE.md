# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file todo app (`index.html`) backed by plain org-mode files. No build
step, no dependencies, no server. Design spec:
`docs/superpowers/specs/2026-07-18-org-todo-page-design.md`; implementation plan:
`docs/superpowers/plans/2026-07-18-org-todo-page.md`.

**Storage is pluggable per connection** (`entry.backend`): local folders via the
File System Access API (`fsaBackend`, desktop Chromium only) and Google Drive via
its REST API + GIS OAuth (`gdriveBackend`, works on mobile too). Both coexist —
`App.files` is a mix. `version` is the backend-neutral change token (FSA mtime |
Drive revision). To enable Drive, create a Google Cloud OAuth Web client ID
(scope `drive.file`, your GitHub Pages URL as an authorized JS origin), serve
the page over HTTPS, then open the Files panel (`F`) and press `g` to paste the
client ID in — it's kept in `localStorage` (`gdriveClientId`), never in
`index.html`/git. `G` in the Files panel re-opens that prompt to change or
clear it. Empty client id = the Drive option stays disabled; FSA is untouched.

## Commands

```bash
node --test 'tests/*.test.mjs'   # unit tests (Node ≥ 18, no deps)
node --test tests/parser.test.mjs # single test file
node tests/ui-e2e.mjs            # browser e2e (needs Google Chrome; CHROME_BIN to override)
```

Note: `node --test tests/` (bare directory arg) does NOT work — use the glob.

To run the app: open `index.html` in Chrome/Edge and connect a folder's `.org`
files via the picker (`sample-tasks/` is a fixture for this). If the picker is
blocked on `file://`, serve with `python3 -m http.server` and use localhost.

Git: this repo sets `commit.gpgsign=false` locally because the user's global
SSH-signing config hangs in non-interactive sessions. Plain `git commit` works.

## Architecture

Everything ships inside `index.html`'s single `<script>`, split by exact marker
comments that tooling greps for — do not alter them:

```
// ===== CORE START =====   pure logic, zero DOM/browser API usage
// ===== CORE END =====
// ===== APP =====          DOM, File System Access, polling, events
```

**CORE** is one IIFE assigned to `const Core`, containing the org parser/
serializer, quick-add token parser, date helpers, and view model
(radar/backlog/filters). `tests/harness.mjs` extracts this section with a regex
and evaluates it via `new Function` (deliberately not `vm` — cross-realm arrays
break `deepStrictEqual`). Anything added to CORE must be exported through the
IIFE's `return {...}` and covered by unit tests; CORE must never touch
`document`/`window`.

**APP** is only manually/e2e-testable, so keep logic that can live in CORE in
CORE. Top-level `function` declarations in APP are global properties — the e2e
test monkey-patches them (`showDirectoryPicker`, `idbSet`, `connectNames`, `confirm`) to
inject a fake in-memory directory handle; renaming these breaks `ui-e2e.mjs`.

### The round-trip invariant (stop-the-line rule)

`Core.serializeFile(Core.parseOrg(text)) === text` byte-for-byte when nothing
was edited. Each task keeps its original block text in `task.raw`; mutations
set `task.dirty` and only dirty blocks are re-rendered — unknown lines,
drawers, and spacing in untouched blocks pass through verbatim. If a round-trip
test fails, the parser/serializer contract is broken: fix the code, never the
test. Files that fail to parse render read-only and are never written.

### Data flow

- One `.org` file per topic (`work.org` → topic "work"); files are connected
  individually (persisted in IndexedDB as tagged backend descriptors —
  `{backend:'fsa', dir}` or `{backend:'gdrive', folderId}` — plus the filename;
  `restoreBackend` rebuilds the right backend on boot; manage with `F` (`c`
  folder, `g` Drive), move tasks between files with `m`); file order = task order.
  `** ` headings (one level) are sub-tasks with the same fields; `***`+ stays
  verbatim body. Radar rows can be sub-tasks too.
  Sub-task rows render only when their parent is expanded (`App.expanded`,
  also the notes-visibility state; in-memory, collapsed on load).
  States `TODO`/`NEXT`/`DONE`; radar = NEXT + deadline within 7 days.
- A poll (`scanTick`, 1.5 s local / 5 s when any Drive file is connected — see
  `armPoll`) diffs each entry's `version` token via `entry.backend.stat()` and
  re-parses changed files. `saveFile()` re-reads the file first if its version
  drifted on disk, applies the mutation to the fresh parse, writes via
  `entry.backend.write()`, then re-parses its own output to reset raw/dirty. All
  I/O goes through `entry.backend` (never raw FSA/fetch); all UI mutations go
  through `mutateTask(topic, key, fn)`.
- Task identity across renders: `taskKey(t)` = first line of the heading block;
  `refKey(r)` = `topic + '\t' + taskKey` for top-level tasks, `topic + '\t' +
  parentKey + '\t' + childKey` for sub-tasks. Two identical headings under one
  parent (or two identical top-level headings) are indistinguishable (known
  limitation). Selection survives re-render by key with positional fallback
  (`App.selPos`).

### UI gotchas learned the hard way

- Removing a focused element fires `blur` synchronously mid-removal. The inline
  editor (`inlineEdit`) therefore funnels Enter/Escape/blur through one
  idempotent `close()`; don't reintroduce separate `box.remove()` calls.
- Keyboard branches that focus an input (`a`, `/`, `s`, `t`, `E`, `e`, `N`, `A`) must
  `preventDefault()` or the triggering key is typed into the input.
- The `e` heading editor is WYSIWYG: the line is the whole truth — tokens
  omitted from it (`#A`, `@date`, `~2h`, `:tags:`) are removed from the task.
- A sub-task that qualifies for the radar renders twice with the same
  `data-rk` (radar row + nested row under its parent). The copy at
  `App.selPos` gets `.sel`; the other copy gets the lighter `.sel-dup` echo.
  Click, re-render, scroll, and the inline editor all follow the current
  copy — this works because DOM `.task` order matches `App.visible` order
  (`taskRow` pushes in creation order). Don't dedupe by mangling `refKey`,
  it is identity for key-path mutations.

### Known accepted limitations

Same-parent-only drag-and-drop and reordering (no re-parenting), no CRLF
support, duplicate sibling headings collide. Local folders are Chromium-desktop
only (File System Access API); mobile uses the Google Drive backend instead.
Drive uses `drive.file` scope (app sees only files it created), last-write-wins
per file, and access tokens that need occasional re-consent. Don't "fix" these
in passing; they're documented trade-offs in the spec.
