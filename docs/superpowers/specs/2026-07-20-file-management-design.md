# File management and moving entries between files — design

Date: 2026-07-20
Status: approved (revised same day: connections carry their folder handle so
per-folder `images/` keeps working; images move with tasks across folders)

## Goal

Replace the single-folder connection model with individually connected `.org`
files: see what files are connected, disconnect them, connect new ones, and
move top-level tasks between files — including their pasted images.

## 1. Connection model (replaces the folder)

The app's source of truth is a flat list of individually connected `.org`
files. Because the File System Access API cannot reach a file's parent
directory from a file handle — and the image feature needs a sibling
`images/` folder — each connection is stored as a **(directory handle,
filename) pair**, persisted as an array under a new IndexedDB `files` key.
Entries from the same connect action share one directory handle object;
structured clone preserves that identity.

- **Connect flow:** connecting opens the *directory picker*; the app lists
  the `.org` files found in that folder and the user picks which to connect
  (all preselected). The folder is **not** auto-scanned afterwards — new
  files in it never appear until explicitly connected. Re-picking the same
  folder later connects more of its files; files already connected from it
  are skipped.
- **Migration:** none. On first load the old `dir` IndexedDB key is deleted
  if present; the user reconnects files once.
- **Polling:** `scanTick` polls each connected file handle's `lastModified`,
  diffing exactly as today. No directory enumeration.
- **Broken handles:** a file that becomes unreadable (deleted/renamed on
  disk) is marked broken on its entry — shown with that status in the files
  panel, hidden from the task list, never written to. It recovers
  automatically if the file reappears.
- **Permissions:** persisted handles need a re-grant after browser restart
  (user gesture required). The boot banner becomes "Reconnect files": one
  click requests permission for every stored directory handle (already-
  granted ones are skipped; Chromium keys grants by path, so one grant
  covers all entries from the same folder).
- **Topic identity:** topic = filename minus `.org`, unchanged, and unique
  across the app. Connecting a file whose topic name is taken is refused
  with a toast; rename the file on disk if both are wanted.

## 2. Files panel (`F`)

`F` opens a keyboard-navigable overlay listing each connected file: topic
name, task count, and status (ok / parse error / unreadable).

- **Disconnect** (`x` or button): removes the entry from the list and
  IndexedDB. The file on disk is untouched. No confirmation.
- **Connect** (`c`): directory picker → checklist of that folder's `.org`
  files (all preselected, clashes and already-connected marked and skipped)
  → confirm connects them.
- **New file** (`n`): type a topic name, then pick the folder; the file is
  created there (`dir.getFileHandle(name + '.org', {create: true})`) and
  connected. If a file with that name already exists in the chosen folder,
  its existing content is loaded rather than clobbered.
- `j`/`k` navigate rows, `Esc` closes (or backs out of the checklist). Rows
  also have clickable buttons.

## 3. Quick-add with an unknown topic

`#newtopic` keeps working: after the existing confirm, the file is created
**next to the file of the last-used topic** (falling back to the first
connected file). No picker — matches today's "it just lands somewhere
sensible" feel. If nothing is connected yet, quick-add asks to connect a
folder first (toast pointing at `F`).

## 4. Images

Each connected file's image root is `<its folder>/images/`, created on
demand. Files connected from the same folder share it automatically (same
directory handle → same `images/`). Paste-to-attach and `[[file:images/…]]`
rendering work exactly as today, resolved per-file instead of per-app.

## 5. Move entries (`m`)

With a task selected, `m` opens a small inline prompt (same style as the
heading editor) for the target topic. Enter moves the task to the **end of
the target file**; selection follows the task to its new topic.

- **Scope:** only top-level tasks move, and they move whole — the entire raw
  block (sub-tasks, notes, drawers, spacing) transfers **byte-for-byte**,
  except image-reference lines rewritten on rename (below). `m` on a
  sub-task shows a toast ("sub-tasks move with their parent").
- **Unknown target topic:** after a confirm, the file is created in the
  *source file's folder* (no picker; image moves are then never needed).
- **Write order:** append-to-target first, then remove-from-source. A crash
  mid-move can at worst duplicate a task, never lose one. Both writes go
  through the existing `saveFile` fresh-reparse flow.
- **Images move with the task.** When source and target files live in
  different folders (`isSameEntry` is false):
  1. Every `[[file:images/…]]` referenced by the task or its sub-tasks is
     copied to the target folder's `images/` (created if needed). The name
     is kept if free; on collision the copy gets a numeric suffix
     (`name-2.png`) and the reference line in the moved block is rewritten —
     the only deviation from byte-for-byte.
  2. After the task is removed from the source file, each source image is
     deleted only if no other *connected* file from that same folder still
     references it. Unconnected files in that folder cannot be checked — an
     image they reference could be removed (accepted trade-off).
  3. A missing source image doesn't block the move — the reference
     transfers as-is with a warning toast.
  Moves between files in the same folder skip all image work.

## 6. Core vs APP split

New CORE functions (pure, exported from the IIFE, unit-tested):

- `removeTaskAt(file, index)` — removes the top-level task block at `index`,
  returns its full raw text (heading + children + body), normalized to end
  with `\n`.
- `appendRaw(file, block)` — appends a raw block string to a file as a
  parsed task, preserving the block text verbatim on serialize; ensures the
  preceding content ends with a newline.

Round-trip unit tests prove a remove/append pair reproduces the moved block
byte-for-byte. All picker, permission, panel, image, and event code stays in
APP.

## 7. Testing

- **Unit:** removeTaskAt/appendRaw behavior and round-trip invariants,
  including blocks with sub-tasks, drawers, odd spacing, and a file whose
  last block lacks a trailing newline.
- **e2e:** the harness's fake directory grows `getFileHandle`,
  `getDirectoryHandle('images')`, and `isSameEntry`; setup connects it via
  the app's own connect path instead of `openFolder` (which is removed).
  Coverage: panel rendering, disconnect hides a topic, connect adds one,
  `m` move transfers block text, and a cross-folder move copies the image
  and rewrites nothing when names are free.

## Known trade-offs (carried forward or new)

- Chromium-only (File System Access API), unchanged.
- Duplicate topic names are refused, not disambiguated.
- Sub-tasks cannot move independently (matches the no-re-parenting rule).
- No auto-discovery: dropping a file into a connected folder does nothing
  until it is connected explicitly.
- Cross-folder image deletion can't see unconnected files that reference
  the same image.
