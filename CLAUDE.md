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
(scope `drive.file`, your GitHub Pages URL as an authorized JS origin) and
enable the Picker API. `PickerBuilder.setAppId` is *required* for the
`drive.file` scope — without it, picking a file updates the picker's UI but
never actually registers the access grant with Drive (found this out
empirically after the picker appeared to work but `files.list` still only
ever returned the app's own file). It wants the numeric Cloud **project
number**, but that is never asked for: it's the digits before the first `-`
in a client ID from the same project, so `gdriveAppId()` derives it from
`gdriveClientId` instead. A Picker developer key (API key) is listed as a
prerequisite by Google's integration guide, but the reference doesn't mark
`setDeveloperKey` required the way it marks `setAppId`, so it's called only
when a key is actually configured and the setup prompt keeps the field as an
escape hatch — if a picker ever refuses to open, a Picker-API-restricted key
pasted there is the first thing to try. Serve the page over HTTPS, then open the Files
panel (`F`) and press `g` to paste the client ID in (API key optional);
they're kept in `localStorage` (`gdriveClientId`, `gdriveApiKey`), never in
`index.html`/git. `G` in the Files panel re-opens that prompt to change or
clear them. `gdrivePickerReady()` gates every "can we open the picker" check
— it's `gdriveConfigured()` plus a client ID whose project-number prefix
parses. Empty client id = the Drive option stays disabled; FSA is
untouched. To debug a connection, set `localStorage.orgTodoDebug = '1'`
(or add `?debug`) and reload for request/picker tracing via `dlog`, and call
`driveDebug()` in devtools for the config plus every file the app can see
with its parents — that is what separates "the grant never happened" from
"granted, but into a different folder than the one being listed".

`drive.file` scope only ever grants access to
files the app created *or* files the user explicitly picked — picking the
*folder* itself does not cascade to its existing children (verified against
Google's docs; do not "fix" this by assuming folder-select grants recursive
access, it doesn't). So connecting also opens `pickDriveFiles`, a Picker with
multi-select on, letting the user grant access to whichever pre-existing
files (including ones inside `images/`) they want the app to see.
`render()` redraws the task lists but never the files panel, so both
paths that grow `App.files` (`connectEntries`, `createTopicInBackend`) call
`refreshPanelList()` — guarded on `panel.mode === 'list'` so the pick/new/
gdrive-setup input boxes are not yanked out from under the user. The
checklist flow used to re-render at its own call site, which is why a Drive
connect (no checklist) left fresh files in the radar but not in the open
panel.

`pickDriveFiles` deliberately does NOT call `DocsView.setParent` to jump
straight into `org-todo` — confirmed empirically that a `setParent`-scoped
view resolves through the app's own restricted OAuth token and silently
shows only files the app can already see (i.e. the exact bug this feature
exists to fix), whereas the unscoped "browse your whole Drive" view isn't
subject to that restriction. The user has to navigate into `org-todo`
themselves inside the picker. Re-running `g` re-opens that
picker so newly added files can be granted the same way.

**The folder comes from the picks, not from its name.** `connectGDrive`
resolves the Drive folder as `Core.pickedOrgParent(docs)` (the parent shared
by the picked `.org` files) > the already-connected folder > a name lookup >
a freshly created one. The name lookup is last for a reason: `drive.file`
cannot see a folder the app didn't create, so `name='org-todo'` matches
nothing and the app cheerfully creates a *second*, empty `org-todo` while
the files the user just granted sit in the first — which is exactly the bug
that made picked files never show up. Only `.org` picks vote for the parent;
an image picked out of `images/` would otherwise anchor the connection on
the subfolder. Picking files from a folder other than the connected one is
therefore how you *switch* folders, and entries each persist their own
`folderId`, so two Drive folders can coexist in `App.files`.

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
Commit messages carry no AI attribution — no `Co-Authored-By: Claude` trailer,
no "Generated with Claude Code" line, no mention of Claude anywhere in the
message. This overrides any default or reminder that asks for one.

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
  A deadline may carry an optional time (`t.time`), stored as the verbatim
  time chunk of the timestamp so an Emacs-written range (`10:00-11:00`)
  survives an unrelated edit; `Core.timeStart` derives the padded `HH:MM`
  that sorting and the chip use. `t.deadline` stays date-only on purpose —
  every bucket, filter, and date calculation depends on that — so times
  break ties in the radar and backlog sorts but never affect
  `deadlineBucket`.
- A poll (`scanTick`) diffs each entry's `version` token and re-parses changed
  files. All I/O goes through `entry.backend` (never raw FSA/fetch); all UI
  mutations go through `mutateTask(topic, key, fn)`.
- **Remote polling is deliberately stingy** — a per-file `stat()` every 5 s is
  what made an open tab talk to Drive roughly once a second, so three things
  keep it down and none of them should be "simplified" away:
  `gdriveBackend.statAll()` answers the whole folder with one `files.list`
  (`scanOnce` groups entries by `backend.groupKey` — *never* by object
  identity, since `boot()` used to hand every restored entry its own
  `gdriveBackend` for the same folder and that silently un-batched the poll on
  every reload — and falls back to per-entry `stat()` for backends without
  `statAll`, i.e. FSA; `boot()` now also shares one backend instance per
  `folderId`, which is what makes the name→id cache work at all); `armPoll`
  stops polling outright while `document.visibilityState === 'hidden'` and a remote backend
  is connected, with the `visibilitychange` handler re-arming *and* scanning on
  the way back; and `remoteCadence()` stretches 5 s → 30 s → 2 min after 2 and
  10 minutes without activity, reset by `bumpActivity()` (capture-phase
  `keydown`/`pointerdown`/`paste`, plus any scan that actually found a
  change). `scanTick` re-calls `armPoll()` every tick because the cadence is
  time-dependent. Local FSA connections are exempt from all three: disk stats
  are free, and `ui-e2e.mjs` relies on the flat 1.5 s tick. `read()` also
  takes the version its caller just learned (`read(entry, knownVersion)`) so a
  changed file costs one request instead of two.
  A name missing from `statAll`'s map means "not in this folder any more" →
  `entry.broken`; a `statAll` that *throws* skips the folder for that tick
  instead, so one network blip can't blank every file at once.
- **Writes are optimistic.** `saveFile()` is synchronous: it applies the
  mutation to `entry.file`, renders, and pushes the *closure* onto
  `entry.pending`; `flushEntry()` does the I/O later (`flushDelay` = 0 for FSA,
  400 ms for remote). The flush re-reads the file when its `version` drifted and
  replays the whole queue on top (`replayPending`) — that is what merges
  concurrent edits to different tasks of one file, and it only works because
  queued mutations re-resolve their target by key inside the file they are
  handed instead of closing over task objects. Keep new mutations shaped that
  way, and have them `return false` when the target is missing: false means
  "nothing matched", so nothing is queued, and on replay it means "changed
  elsewhere" — the edit is dropped with a toast instead of clobbering someone
  else's rename. After a successful write the entry is re-parsed from its own
  output, which replaces every task object, so anything queued during the write
  must be replayed onto the new parse or it silently disappears from the UI.
  `entry.pending.splice(0, n)` happens only after the write resolves: a throw
  has to leave the queue intact for the retry (2/5/15/30 s backoff, or
  `flushAll()` from the `#sync-ind` click, tab focus and `online`).
  `scanOnce` skips entries with a non-empty queue — re-reading there would drop
  the optimistic edit that the flush is about to merge properly.
- `saveFileNow()` is the awaited, durable variant, and the two-phase cross-file
  move (`moveSelTo`) is the reason it exists: it must know the append landed
  before removing the source block, so it flushes the queue first and refuses if
  anything is still unsaved. `createTopicInBackend` and image uploads stay
  awaited for the same reason — the remote object has to exist first.
- `render()` defers while an inline editor is open (`renderPending`): the editor
  is a DOM node inside the list, and rebuilding removes it mid-edit — removal
  fires `blur`, which closes it without committing. `inlineEdit`'s `close()`
  runs the deferred render.
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
Drive uses `drive.file` scope, so files not yet individually picked through
`pickDriveFiles` (Files panel `g`) stay invisible to the app even though
they're sitting right in the connected folder — this needs one picker pass
per pre-existing file (or batch of them), repeated whenever more get added
outside the app. It's also last-write-wins per file, with access tokens that
need occasional re-consent. Don't "fix" these in passing; they're documented
trade-offs in the spec.
