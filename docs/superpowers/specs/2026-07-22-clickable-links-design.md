# Clickable URL links in titles and note bodies — design

**Date:** 2026-07-22
**Status:** approved

## Goal

URLs in task titles and in note bodies render as clickable links that open in
a new tab. The org files on disk are never changed by this feature — it is
render-layer only.

## Recognized syntaxes

1. **Org links with description:** `[[https://url][label]]` renders as the
   label text, linked to the URL.
2. **Org links without description:** `[[https://url]]` renders as the URL
   text, linked.
3. **Bare URLs:** `https://…` or `http://…` anywhere in the text renders as a
   link. Trailing punctuation (`.` `,` `;` `:` `)` `]` `}` `!` `?` `'` `"`)
   is excluded from the URL, matching common linkifier behavior.

Only `http` and `https` schemes are recognized. `[[file:images/…]]` image
links keep their existing dedicated rendering in `bodyView`; org links with
any other scheme (`file:`, `mailto:`, …) and non-http bare text stay plain
text.

## Architecture

### CORE: `Core.linkify(text)`

Pure function, no DOM. Splits a string into an ordered array of segments:

- `{ text: string }` — plain text run
- `{ url: string, label: string }` — a link (for `[[url]]` and bare URLs,
  `label === url`)

Org-bracket links are matched first, then bare URLs in the remaining text
runs, so a URL inside `[[…][…]]` is never double-matched. Exported through
the CORE IIFE return and covered by unit tests.

### APP: `renderLinkified(el, text)`

Appends `Core.linkify(text)` segments to `el` as text nodes and
`<a href … target="_blank" rel="noopener noreferrer">` elements. Anchors get
`onclick = e => e.stopPropagation()` so a link click doesn't trigger row
selection, and `draggable = false` so dragging the link text doesn't fight
the row's drag-and-drop.

Call sites:

- `taskRow` title — both the plain branch and the `ctx` branch (parent
  context prefix stays plain text; only the task's own title is linkified).
- `bodyView` — every non-image, non-blank body line.

## Explicitly unchanged

- **Round-trip invariant:** untouched — this feature never mutates tasks or
  files.
- **Editors:** the `e` WYSIWYG heading editor and `N` notes editor keep
  showing raw syntax (the line is the whole truth).
- **Filter/search:** keeps matching against raw text, including link markup.
- **Quick-add:** no change.

## Testing

- **Unit (`tests/linkify.test.mjs`):** org link with label, org link without
  label, bare URL mid-text, trailing punctuation excluded, multiple links in
  one string, non-http schemes ignored, text with no links returns one text
  segment, empty string.
- **E2E (`tests/ui-e2e.mjs`):** a task whose title contains a URL renders an
  `<a>` with the expected `href`; clicking the row outside the link still
  selects the row; a body line link renders when the task is expanded.

## Known trade-offs

- Link text is not editable in place beyond the existing raw-line editors;
  that is the app's editing model, not a regression.
- No linkification in chips, toasts, or editors — titles and body lines only.
