# Clickable URL Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** URLs in task titles and note-body lines render as clickable links (org `[[url][label]]`, org `[[url]]`, and bare `http(s)://` URLs), opening in a new tab, without touching what's on disk.

**Architecture:** A pure tokenizer `Core.linkify(text)` in the CORE section splits a string into text/link segments (unit-tested via the existing harness). A small APP helper `renderLinkified(el, text)` renders those segments as text nodes and `<a>` elements; it replaces the `textContent` assignments for task titles in `taskRow` and non-image body lines in `bodyView`.

**Tech Stack:** Vanilla JS inside `index.html` (single file, no build), `node --test` unit tests, CDP-driven e2e in `tests/ui-e2e.mjs`.

**Spec:** `docs/superpowers/specs/2026-07-22-clickable-links-design.md`

## Global Constraints

- Everything lives in `index.html`; CORE code goes between `// ===== CORE START =====` and `// ===== CORE END =====` markers — do not alter the marker comments.
- CORE must never touch `document`/`window`; anything added to CORE must be exported through the IIFE `return {...}` and covered by unit tests.
- Round-trip invariant: this feature is render-only and must not mutate `task.raw`, `task.dirty`, or file contents.
- Only `http`/`https` schemes are linkified. `[[file:images/…]]` lines keep their existing image rendering in `bodyView`.
- Unit tests run with `node --test 'tests/*.test.mjs'` (the bare directory arg does NOT work); e2e with `node tests/ui-e2e.mjs` (needs Google Chrome).

---

### Task 1: `Core.linkify` tokenizer

**Files:**
- Modify: `index.html` (CORE section — add function near `sortRecent`, ~line 462, and export in the `return {...}` at lines 466-470)
- Create: `tests/linkify.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Core.linkify(text: string) -> Array<{text: string} | {url: string, label: string}>` — ordered segments covering the whole input; empty string returns `[]`. Task 2 relies on exactly this shape.

- [ ] **Step 1: Write the failing test**

Create `tests/linkify.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

test('plain text yields a single text segment', () => {
  assert.deepEqual(Core.linkify('no links here'), [{ text: 'no links here' }]);
});

test('empty string yields no segments', () => {
  assert.deepEqual(Core.linkify(''), []);
});

test('org link with label', () => {
  assert.deepEqual(Core.linkify('Read [[https://docs.foo][the docs]] now'), [
    { text: 'Read ' },
    { url: 'https://docs.foo', label: 'the docs' },
    { text: ' now' },
  ]);
});

test('org link without label uses the url as label', () => {
  assert.deepEqual(Core.linkify('[[https://a.b/c]]'), [
    { url: 'https://a.b/c', label: 'https://a.b/c' },
  ]);
});

test('bare url mid-text keeps query strings', () => {
  assert.deepEqual(Core.linkify('see https://x.y/z?q=1 ok'), [
    { text: 'see ' },
    { url: 'https://x.y/z?q=1', label: 'https://x.y/z?q=1' },
    { text: ' ok' },
  ]);
});

test('trailing punctuation is excluded from bare urls', () => {
  assert.deepEqual(Core.linkify('go to https://x.y/z.'), [
    { text: 'go to ' },
    { url: 'https://x.y/z', label: 'https://x.y/z' },
    { text: '.' },
  ]);
});

test('multiple links in one string', () => {
  assert.deepEqual(Core.linkify('[[https://a.b][A]] and https://c.d'), [
    { url: 'https://a.b', label: 'A' },
    { text: ' and ' },
    { url: 'https://c.d', label: 'https://c.d' },
  ]);
});

test('non-http schemes stay plain text', () => {
  assert.deepEqual(Core.linkify('[[file:images/x.png]] and mailto:a@b'), [
    { text: '[[file:images/x.png]] and mailto:a@b' },
  ]);
});

test('a url inside an org-link label is not double-matched', () => {
  assert.deepEqual(Core.linkify('[[https://a.b/c][see https://a.b/c]]'), [
    { url: 'https://a.b/c', label: 'see https://a.b/c' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/linkify.test.mjs`
Expected: FAIL — every test errors with `TypeError: Core.linkify is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, inside CORE, after the `sortRecent` function (~line 464) and before the `return {...}`:

```js
  // --- linkify (render-only; never mutates tasks) ---
  const ORG_LINK_RE = /\[\[(https?:\/\/[^\]\[]+)\](?:\[([^\]]*)\])?\]/g;
  // must end on a char that is not trailing punctuation, so "url." keeps the dot out
  const BARE_URL_RE = /https?:\/\/[^\s\]>]*[^\s\]>.,;:!?'")}]/g;

  function linkifyBare(s, out) {
    let last = 0, m;
    BARE_URL_RE.lastIndex = 0;
    while ((m = BARE_URL_RE.exec(s))) {
      if (m.index > last) out.push({ text: s.slice(last, m.index) });
      out.push({ url: m[0], label: m[0] });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ text: s.slice(last) });
  }

  function linkify(text) {
    const out = [];
    let last = 0, m;
    ORG_LINK_RE.lastIndex = 0;
    while ((m = ORG_LINK_RE.exec(text))) {
      if (m.index > last) linkifyBare(text.slice(last, m.index), out);
      out.push({ url: m[1], label: m[2] || m[1] });
      last = m.index + m[0].length;
    }
    if (last < text.length) linkifyBare(text.slice(last), out);
    return out;
  }
```

Export it: in the CORE `return {...}` (lines 466-470), add `linkify` to the last line:

```js
           deadlineBucket, buildModel, matchesFilter, matchesFamily, sortRecent, linkify };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/linkify.test.mjs`
Expected: PASS (9 tests).

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS — no regressions in the other suites.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/linkify.test.mjs
git commit -m "feat: Core.linkify — split text into plain and http(s) link segments"
```

---

### Task 2: Render links in titles and body lines

**Files:**
- Modify: `index.html` (APP section: `taskRow` title branch ~lines 722-729, `bodyView` ~line 849; CSS: add one rule after the `.bline` rule at line 41)
- Modify: `tests/ui-e2e.mjs` (append checks before the final `ws.close()` block)

**Interfaces:**
- Consumes: `Core.linkify(text)` from Task 1 — returns `Array<{text} | {url, label}>`.
- Produces: `renderLinkified(el, text)` — top-level APP function (global, like the other APP functions); appends text nodes and anchors to `el`. Nothing downstream consumes it.

- [ ] **Step 1: Write the failing e2e checks**

In `tests/ui-e2e.mjs`, insert immediately before the final `ws.close();` line:

```js
// --- clickable links in title and body ---
await evaljs(`(() => {
  __files.set('home.org',
    '* TODO Read [[https://docs.example][the docs]] and https://foo.bar/x.\\n' +
    '  see https://body.example/path\\n');
  __mtimes.set('home.org', 424242);
})()`);
await sleep(2000); // let the 1.5s poll pick up the external edit
const linkRow = await evaljs(`(() => {
  const row = [...document.querySelectorAll('.task')].find(r => r.textContent.includes('the docs'));
  if (!row) return { found: false };
  const as = [...row.querySelectorAll('.title a')]
    .map(a => ({ href: a.getAttribute('href'), text: a.textContent, target: a.target }));
  return { found: true, as };
})()`);
check('title org link renders as its label, opening in a new tab',
      linkRow.found && linkRow.as[0] && linkRow.as[0].href === 'https://docs.example' &&
      linkRow.as[0].text === 'the docs' && linkRow.as[0].target === '_blank',
      JSON.stringify(linkRow));
check('bare title url is linked with trailing punctuation excluded',
      linkRow.found && linkRow.as[1] && linkRow.as[1].href === 'https://foo.bar/x',
      JSON.stringify(linkRow));

await evaljs(`(() => {
  const i = App.visible.findIndex(r => r.task.title.startsWith('Read [[https://docs.example'));
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
  return i;
})()`);
await key('o', 'KeyO', 'o', 79);
await sleep(300);
const bodyLink = await evaljs(`(() => {
  const a = document.querySelector('.body a');
  return a ? { href: a.getAttribute('href'), text: a.textContent } : null;
})()`);
check('body line url renders as a link when the row is expanded',
      !!bodyLink && bodyLink.href === 'https://body.example/path', JSON.stringify(bodyLink));

const clickSel = await evaljs(`(() => {
  const row = [...document.querySelectorAll('.task')].find(r => r.querySelector('.title a'));
  const a = row.querySelector('.title a');
  App.sel = null; App.selPos = -1; updateSelClass();
  a.addEventListener('click', e => e.preventDefault()); // block navigation, keep handler order
  a.click();
  const afterLink = App.sel;
  row.click();
  return { afterLink, afterRow: App.sel };
})()`);
check('link click does not select the row; row click still does',
      clickSel.afterLink === null && !!clickSel.afterRow, JSON.stringify(clickSel));
```

- [ ] **Step 2: Run e2e to verify the new checks fail**

Run: `node tests/ui-e2e.mjs`
Expected: the four new checks FAIL (no `<a>` elements exist yet); all pre-existing checks still pass.

- [ ] **Step 3: Implement rendering**

In `index.html` APP section, add above `function taskRow(...)`:

```js
function renderLinkified(el, text) {
  for (const seg of Core.linkify(text)) {
    if (seg.url) {
      const a = document.createElement('a');
      a.href = seg.url;
      a.textContent = seg.label;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.draggable = false;
      a.onclick = e => e.stopPropagation();
      el.append(a);
    } else {
      el.append(seg.text);
    }
  }
}
```

Replace the title branch in `taskRow` (lines 722-729):

```js
  const title = div('title');
  if (mode === 'ctx' && ref.parent) {
    const c = span('parent-ctx');
    c.textContent = ref.parent.title + ' › ';
    title.append(c);
  }
  if (t.title) renderLinkified(title, t.title);
  else title.append('(untitled)');
```

In `bodyView`, replace the plain-line branch (line 848-849):

```js
      const p = div('bline');
      renderLinkified(p, line.replace(/^ {0,2}/, ''));
```

In the stylesheet, after the `.bline` rule (line 41), add:

```css
.title a, .body a { color:var(--accent); text-decoration:underline; }
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

Run: `node tests/ui-e2e.mjs`
Expected: `all e2e checks passed` — including the four new checks.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: URLs in titles and note bodies render as clickable links"
```
