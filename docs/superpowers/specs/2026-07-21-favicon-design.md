# Favicon — design spec (2026-07-21)

## Goal

Give the app a browser-tab icon. Today `index.html` has no `<link rel="icon">`,
so Chrome shows the generic globe/document icon.

## Decision

Inline SVG favicon as a `data:` URI — no separate icon file. This keeps the
app's core property intact: `index.html` is a single self-contained file with
no build step and no sibling assets. (A standalone `todo.svg` was considered
and rejected; an inline-only icon was chosen explicitly.)

## Icon design ("outline checkbox")

Chosen from four candidates reviewed at 96/32/16 px:

- `viewBox="0 0 16 16"`, transparent background.
- Rounded-rect outline: `x=1 y=1 width=14 height=14 rx=3.5`, `fill=none`,
  `stroke=#2563eb` (the app's `--accent`), `stroke-width=1.8`.
- Checkmark: path `M4.4 8.2 L7 10.8 L11.8 5.6`, `fill=none`,
  `stroke=#2563eb`, `stroke-width=2`, round caps and joins.

Accepted trade-off: the transparent background makes the icon subtler on dark
tab bars. The user chose this look knowingly.

## Implementation shape

One line added to `<head>` immediately after `<title>`:

```html
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect x='1' y='1' width='14' height='14' rx='3.5' fill='none' stroke='%232563eb' stroke-width='1.8'/><path d='M4.4 8.2 L7 10.8 L11.8 5.6' fill='none' stroke='%232563eb' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>">
```

- Encoding: URL-encoded UTF-8, not base64 — only `#` needs escaping (`%23`);
  attribute values use single quotes so the surrounding `href="…"` stays valid.
  Literal spaces inside the data URI are acceptable: Chromium (the app's only
  supported browser) parses them fine, and readability wins over strict URI
  validity here.
- No CORE changes, no APP-script changes, no new files, no effect on the
  round-trip invariant, marker comments untouched.

## Testing

- Static markup only — no unit test applies (CORE is unchanged).
- Run `node --test 'tests/*.test.mjs'` and `node tests/ui-e2e.mjs` to confirm
  nothing regressed.
- Manual: open `index.html` in Chrome and confirm the icon renders in the tab.
