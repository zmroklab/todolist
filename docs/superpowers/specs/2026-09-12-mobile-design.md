# Mobile: the whole app, usable by touch on a phone

**Date:** 2026-09-12
**Status:** draft — awaiting review

## Overview

Today almost everything is keyboard-only (`j/k`, `d`, `n`, `e`, `s`, `F`, …)
and the overlays are sized for a desktop window. On a phone you can type into
quick-add and tap a row to select it — nothing else, not even open the Files
panel to connect Google Drive.

Goal: **full parity by touch.** Everything the keyboard can do is reachable
with taps, on a phone-sized screen, without changing how desktop looks or
behaves with a mouse and keyboard.

The approach is one code path, two input methods: the keyboard shortcuts
become entries in a command table, and every touch control runs the same
command (`✓` runs `'d'`). No new editing surface, no new mutations — the
existing inline editors, `mutateTask`/`saveFile`, and the optimistic write
queue are reused as they are. CORE does not change.

## When the touch UI is on

Pure CSS: `@media (max-width: 720px), (pointer: coarse)`. The new markup
(action bar, sheets, touch buttons) is always in the DOM and hidden outside
that query, so desktop with a mouse renders exactly as today.

The few places JS needs to know use one helper, `isTouchUI()`, backed by
`matchMedia` with the **same query string** (kept next to a comment pointing
at the CSS rule — they must match). A `change` listener on that media query
calls `render()`.

Global touch-mode styling:

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`;
  the action bar pads with `env(safe-area-inset-bottom)`.
- Inputs, textareas and selects use `font-size: 16px` (below that iOS zooms
  the page on focus).
- Tap targets ≥ 44px tall: task rows, chips, sheet and panel buttons.
- `.title` drops its `min-width: 200px` so titles wrap instead of pushing the
  meta chips onto their own line.
- `touch-action: manipulation` on `body` (no double-tap-zoom delay).
- `main` gets bottom padding equal to the action bar height so the last row
  can scroll above it; `#toast` sits above the bar.
- Rows are not `draggable` in touch mode (HTML5 drag does not work reliably
  with touch and interferes with long-press); reordering is in the ⋯ sheet.

## Command table

The per-task and global branches of the `document` `keydown` handler move
into `async function runCommand(id, e)`. The command id is the key that
triggers it today (`'d'`, `'n'`, `'e'`, `'s'`, `'N'`, `'1'`, `'>'`, `'X'`, …);
the Alt+arrow reorder becomes `'Alt+ArrowUp'` / `'Alt+ArrowDown'`. The
`keydown` handler keeps its early returns (focused inputs, files panel, share
panel — panel key handling stays where it is) and then calls
`runCommand(id, e)`.

Touch controls carry `data-cmd="<id>"`; one delegated click handler calls
`runCommand(id, stubEvent)` where `stubEvent` provides a no-op
`preventDefault()`. Branches that call `e.preventDefault()` keep doing so —
for a real key event that is still what stops the key being typed into the
editor.

`runCommand` is a top-level `function` (a global), consistent with the other
APP functions the e2e test can reach. Existing function names do not change.

## Action bar

`#actionbar`, fixed to the bottom in touch mode:

| Button | Command |
|---|---|
| ✓ done | `d` |
| ★ next | `n` |
| ✎ edit | `e` |
| ⏰ date | `s` |
| ≡ notes | `N` |
| ⋯ more | opens the more sheet |

Task buttons are `disabled` when `selRef()` is null; the state is refreshed
from `updateSelClass()` and `render()`. The bar is hidden while an input or
textarea has focus (a `focusin`/`focusout` pair toggles `body.typing`) so it
doesn't float above the virtual keyboard over the editor.

### More sheet

`#more-sheet`, a bottom sheet opened by ⋯ and closed by tapping outside it or
its ✕. Entries:

- Priority **A / B / C / none** — `1` `2` `3` `0`
- **Expand / collapse** — `o`
- **Add sub-task** — `A`
- **Tags** — `t`; **Estimate** — `E`
- **Deadline +1 day / −1 day** — `>` `<`
- **Undo repeat** — `D`
- **Move up / Move down** — `Alt+ArrowUp` / `Alt+ArrowDown`
- **Move to file** — `m`
- **Copy title / Copy org block** — `y` `Y`
- **Attach image** — see below
- **Delete** — `X` (still asks `confirm()`)

Entries that are naturally tapped repeatedly (priority, ±1 day, move up/down)
leave the sheet open; entries that open an editor or dialog close it first.

### Attach image

The body of the `paste` handler becomes `async function attachImage(blob,
mimeType)`; the paste handler calls it with the clipboard item. A hidden
`<input type="file" accept="image/*" id="img-input">` is triggered by the
sheet entry and calls `attachImage(file, file.type)`. Behaviour (naming,
`images/` write, body link, expand, toast) is unchanged.

### Notes chip

The `≡` note chip on a row becomes clickable and toggles expand, like the `▸`
fold chip already does. This applies on desktop too — it changes nothing
visually and only adds a click.

## Inline editor on touch

`inlineEdit` closes on `blur`. Tapping a Save button blurs the input first,
so a naive Save button would close the editor **without** committing.

In touch mode the editor renders **Save** and **Cancel** buttons under the
input. Both handle `pointerdown` with `preventDefault()` so the input keeps
focus; `click` then runs the action. Enter, Save, Escape, Cancel and blur all
funnel through the existing idempotent `close()`, with commit extracted into
one `commit()` used by both Enter and Save. The input gets
`enterkeyhint="done"` (single-line) and is scrolled into view after focus so
the virtual keyboard doesn't cover it.

Single-line editors still commit on the keyboard's Enter/Go key. Notes
(multiline) commit via Save — a phone keyboard has no Cmd/Ctrl+Enter.

## Header

In touch mode the sticky header shows `#quickadd` and a `☰` button
(`#menu-btn`). `#filterbar` stays in the DOM and is restyled rather than
duplicated:

- **Closed:** only `#sync-ind`, `#share-ind` and `#active-flt` are visible
  (each still hides itself when empty/irrelevant).
- **Open** (`body.menu-open`, toggled by ☰): every filterbar control shows,
  wrapped, plus two touch-only buttons — **Files** (opens the files panel)
  and **Help**. Choosing Files or Help closes the menu.
- `☰` shows a dot (`.has-filter`, set in `renderFilterState`) while any
  filter — deadline, priority, tag, topic, or search text — is active.
- `#active-flt` becomes clickable and runs `clearFilters()` (there is no Esc
  key on a phone). Its text is unchanged; the click also works on desktop.

## Overlays

In touch mode `#help`, `#files-panel` and `#share-panel` are full-screen
(`inset: 0`, square corners). `#files-panel` and `#share-panel` gain a ✕
close button (help already has one) calling `closePanel()` /
`closeSharePanel()`.

Help gains a short **On a phone** paragraph: tap to select, action bar, ⋯ for
the rest, ☰ for filters and Files, local folders are desktop-only so phones
use Google Drive.

## Files panel on the phone

Local folders (File System Access API) don't exist in any mobile browser. On
a phone, selecting files means Google Drive, and `connectGDrive` already does
it: it opens the Google Picker with multi-select, grants access to the picked
files (`drive.file`), resolves the folder from them, and connects them. It was
only reachable via `g`.

List mode gains a touch-only button row, `#files-actions`:

- **Select Drive files** — if `gdrivePickerReady()`, `connectGDrive()`;
  otherwise switches to `gdrive-setup` mode. Re-usable to grant more files.
- **Drive settings** — `gdrive-setup` mode (same as `G`).
- **New file** — `new` mode.

Each connected file row keeps its **disconnect** button (bigger in touch
mode). Pick mode (FSA folder checklist) gets no touch treatment — it is only
reachable on desktop Chromium.

### Drive setup form

The Enter-only `submit(ev)` is split into `saveDriveSetup()` (the body) and a
key handler that calls it on Enter. Touch mode adds **Save & connect** and
**Cancel** buttons.

### New file on Drive

`new` mode currently refuses without FSA (`New local files need Chrome or
Edge on desktop`). New rule on confirm:

1. `FSA_OK` → folder picker, exactly as today.
2. Otherwise, if any Drive entry is connected → `createTopicInBackend` with a
   Drive backend: the last-used topic's backend if it is Drive, else the first
   connected Drive entry's backend (same preference as `createTopic`).
3. Otherwise → toast `Connect Google Drive first`.

Touch mode adds **Create** and **Cancel** buttons alongside Enter.

### Picker size

The Google Picker opens as a fixed desktop-sized dialog by default. When
`isTouchUI()`, `pickDriveFiles` calls `PickerBuilder.setSize(innerWidth,
innerHeight)`.

**Risk:** Google's web-Picker docs don't make claims about phone browsers, and
the e2e harness cannot run a real Google sign-in. Whether the Picker is
comfortable on a phone is verified manually on a real device over the HTTPS
deployment (see Testing). Fallback if it is not: `drive.file` grants are per
file, not per device — pick files once on desktop and the phone sees them.

## Testing

CORE is untouched, so no new unit tests; `node --test 'tests/*.test.mjs'`
must stay green.

`tests/ui-e2e.mjs` — the existing desktop checks run unchanged (they exercise
`runCommand` through real key events). Before any emulation, add a check that
`#actionbar` computes to `display: none`. Then a **mobile block** at the end:

- `Emulation.setDeviceMetricsOverride({ width: 390, height: 844,
  deviceScaleFactor: 3, mobile: true })` and
  `Emulation.setTouchEmulationEnabled({ enabled: true, maxTouchPoints: 5 })`;
  no reload (the fake directory lives in page state; media queries update
  live).
- Taps are trusted `Input.dispatchTouchEvent` touchStart/touchEnd at an
  element's centre (rect from `getBoundingClientRect`), so focus and blur
  ordering is real.

Checks:

1. `#actionbar` visible; filterbar chips hidden; `#quickadd` visible.
2. Tap a row → it gets `.sel`; action bar task buttons are enabled.
3. Tap ✓ → the row's state is DONE and, after the sync settles, the fake file
   contains the DONE heading.
4. ⋯ → **A** → priority A in DOM and file; sheet still open; ✕ closes it.
5. ✎ → type into the editor → tap **Save** → title changed in DOM and file
   (the blur-before-click regression).
6. ≡ → type a note → **Save** → note in file, task expanded.
7. ☰ → filter chips visible; tap `today` → filter on, ☰ has the dot; tap
   `today` again → cleared, dot gone. Tap a tag chip on a row → `#active-flt`
   shows it; tap `#active-flt` → cleared.
8. ☰ → **Files** → `#files-panel` fills the viewport; **Select Drive files**
   present; ✕ closes it.
9. With a focused editor, `#actionbar` is hidden (`body.typing`).

Finish with `Emulation.clearDeviceMetricsOverride` and touch emulation off.

Manual:

- In-app browser, mobile preset: walk through add, done, edit, date, notes,
  ⋯ entries, ☰, Files, Help.
- On a real phone over the GitHub Pages URL: **Select Drive files** → Picker
  opens, fits the screen, multi-select works, picked files appear connected;
  an edit made on the phone shows up on desktop.

## Out of scope

- Swipe gestures and long-press menus.
- A touch drag handle for reordering (the ⋯ sheet has move up/down).
- Local-folder connect or folder checklist on phones (no File System Access
  API; a plain file input gives read-only copies that can't be written back).
- Re-parenting, CRLF, and the other documented limitations — unchanged.
