# Org Todo

A single-file todo app (`index.html`) backed by plain org-mode files.
Open it in Chrome or Edge, point it at a folder of `.org` files, and manage
your backlog with the keyboard — every change is written back as clean,
Emacs-compatible org. Edit the files in any editor and the page updates
within ~2 seconds.

## Setup

1. Open `index.html` in Chrome/Edge (double-click, or serve the folder with
   any static server if your browser blocks the folder picker on `file://`).
2. Click **Open tasks folder** and pick the folder with your `.org` files
   (try the bundled `sample-tasks/` to explore).
3. Grant read/write access. On later visits a single **Re-grant access**
   click restores the connection.

## Data format

One `.org` file per topic (`work.org` → topic "work"):

    * NEXT [#A] Ship quarterly report :report:urgent:
      DEADLINE: <2026-07-22 Wed>
      :PROPERTIES:
      :Effort:   3h
      :ADDED:    [2026-07-18 Sat]
      :END:
      Notes and [[file:images/screenshot-1.png]] links.
    ** TODO Draft outline
    ** DONE Collect figures

States: `TODO` (backlog) / `NEXT` (on the radar) / `DONE`.
The radar also shows anything due within 7 days.
Sub-headings (`** `, one level deep) are sub-tasks: same fields and
shortcuts, shown indented under their parent, with their own radar rows.
Deeper headings (`***`+) are preserved as plain body text.

## Quick-add

One input, token syntax — only the title is required:

    work: Ship report #A :urgent: @jul22 ~3h

`topic:` file · `#A/#B/#C` priority · `:tag:` tags ·
`@2026-07-22 | @jul22 | @tomorrow | @fri` deadline · `~3h` estimate.

## Keyboard

Press `?` (or click the `?` button in the top bar) for usage help and the
full shortcut list. Highlights: `j/k` move · `n` radar
toggle · `d` done · `1/2/3/0` priority · `s` deadline · `t` tags ·
`E` estimate · `e` edit heading · `A` add sub-task · `Alt+↑/↓` reorder · `/` search ·
paste an image onto a selected task to attach it.

## Development

No build. Tests (Node ≥ 18): `node --test 'tests/*.test.mjs'`
The test harness extracts the pure-logic CORE section from `index.html`,
so the app stays a single file.
