# Share Filters (Privacy Presets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named, persistent share filters (e.g. `flo and !elena and !volha`) that hide sensitive tasks and file names everywhere in the UI so the user can screen-share safely.

**Architecture:** Expression parser + matcher live in CORE (pure, unit-tested). APP applies the active preset as a base visibility layer in `render()` before the existing quick filters, adds a share dropdown + indicator + `S` cycle key, a preset edit panel, and hides excluded topics from the files panel. State persists in `localStorage`.

**Tech Stack:** Vanilla JS inside `index.html` (single file, no build), `node --test` unit tests, CDP-driven e2e in `tests/ui-e2e.mjs`.

Spec: `docs/superpowers/specs/2026-07-24-share-filters-design.md` — read it first.

## Global Constraints

- Everything ships inside `index.html`; CORE code goes between `// ===== CORE START =====` and `// ===== CORE END =====` markers — never alter the marker comments.
- CORE must never touch `document`/`window`; every new CORE function is exported through the IIFE's `return {...}` and unit-tested.
- The round-trip invariant is untouched: this feature is render-only and must never write to `.org` files.
- Run unit tests with `node --test 'tests/*.test.mjs'` (the glob, not a bare directory). E2e: `node tests/ui-e2e.mjs` (skips cleanly if Chrome missing).
- Top-level `function` names in APP are monkey-patched by the e2e — do not rename existing ones.
- Words/expressions match case-insensitively; matcher output words are lowercased.
- Fail closed: an active preset whose expression has a parse error shows **no tasks**, never all of them.
- Commit after every task; `git commit` works (gpgsign is off locally).

---

### Task 1: `Core.parseShareExpr`

**Files:**
- Modify: `index.html` (CORE section — add after the `parseQuickAdd` function, before the `// --- view model ---` comment, ~line 413)
- Create: `tests/share.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Core.parseShareExpr(str: string) -> { include: string[], exclude: string[] } | { error: string }`. Empty/whitespace-only input → `{ include: [], exclude: [] }`. Words are lowercased. Used by Task 2's tests and Tasks 3–5.

- [ ] **Step 1: Write the failing tests**

Create `tests/share.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

test('parseShareExpr: includes and excludes', () => {
  assert.deepEqual(Core.parseShareExpr('flo and !elena and !volha'),
                   { include: ['flo'], exclude: ['elena', 'volha'] });
});

test('parseShareExpr: "and" is optional sugar', () => {
  assert.deepEqual(Core.parseShareExpr('flo !elena'),
                   Core.parseShareExpr('flo and !elena'));
});

test('parseShareExpr: case-insensitive, lowercases words', () => {
  assert.deepEqual(Core.parseShareExpr('FLO AND !Elena'),
                   { include: ['flo'], exclude: ['elena'] });
});

test('parseShareExpr: whitespace tolerated', () => {
  assert.deepEqual(Core.parseShareExpr('  flo   and   work  '),
                   { include: ['flo', 'work'], exclude: [] });
});

test('parseShareExpr: empty input matches everything', () => {
  assert.deepEqual(Core.parseShareExpr(''), { include: [], exclude: [] });
  assert.deepEqual(Core.parseShareExpr('   '), { include: [], exclude: [] });
});

test('parseShareExpr: only negatives', () => {
  assert.deepEqual(Core.parseShareExpr('!home'), { include: [], exclude: ['home'] });
});

test('parseShareExpr: tag charset allowed in words', () => {
  assert.deepEqual(Core.parseShareExpr('q3_plan and !one-on-one and !x@y'),
                   { include: ['q3_plan'], exclude: ['one-on-one', 'x@y'] });
});

test('parseShareExpr: malformed inputs error', () => {
  for (const bad of ['!', 'flo and', 'and flo', 'flo and and work', '!and', 'a?b', 'flo AND'])
    assert.ok(Core.parseShareExpr(bad).error, JSON.stringify(bad) + ' should be an error');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/share.test.mjs`
Expected: FAIL — `TypeError: Core.parseShareExpr is not a function`

- [ ] **Step 3: Implement `parseShareExpr` in CORE**

In `index.html`, inside the CORE IIFE, right after `parseQuickAdd`'s closing brace and before `// --- view model ---`, add:

```js
  // --- share filters (privacy presets) ---
  // Terms are whitespace-separated; "and" between terms is optional sugar.
  // Bare word = include, !word = exclude. Malformed input returns { error }.
  function parseShareExpr(str) {
    const include = [], exclude = [];
    const tokens = String(str || '').trim().split(/\s+/).filter(Boolean);
    let last = 'start';
    for (const tok of tokens) {
      if (/^and$/i.test(tok)) {
        if (last !== 'term') return { error: '"and" needs a term on each side' };
        last = 'and';
        continue;
      }
      const neg = tok.startsWith('!');
      const word = neg ? tok.slice(1) : tok;
      if (!word) return { error: 'dangling "!"' };
      if (/^and$/i.test(word)) return { error: '"and" cannot be a term' };
      if (!/^[A-Za-z0-9_@#%-]+$/.test(word)) return { error: 'bad characters in "' + tok + '"' };
      (neg ? exclude : include).push(word.toLowerCase());
      last = 'term';
    }
    if (last === 'and') return { error: '"and" needs a term on each side' };
    return { include, exclude };
  }
```

Then add `parseShareExpr` to the IIFE's `return {...}` list (it ends `deadlineBucket, buildModel, matchesFilter, matchesFamily, sortBacklog, linkify };` — append there):

```js
           deadlineBucket, buildModel, matchesFilter, matchesFamily, sortBacklog, linkify,
           parseShareExpr };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/share.test.mjs`
Expected: PASS (8 tests). Then run the full suite: `node --test 'tests/*.test.mjs'` — all pass.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/share.test.mjs
git commit -m "feat: Core.parseShareExpr — share-filter expression parser"
```

---

### Task 2: `Core.matchesShare` + `Core.shareTopicVisible`

**Files:**
- Modify: `index.html` (CORE section — directly below `parseShareExpr` from Task 1)
- Modify: `tests/share.test.mjs`

**Interfaces:**
- Consumes: `Core.parseShareExpr` (Task 1), `Core.parseOrg` (existing) in tests.
- Produces:
  - `Core.matchesShare(topic: string, task, parentTask, expr) -> boolean` — `task`/`parentTask` are parsed task objects (`parentTask` is `null` for top-level tasks); `expr` is `parseShareExpr` output. An `expr` with `.error` (or a falsy `expr`) matches nothing — fail closed.
  - `Core.shareTopicVisible(topic: string, expr) -> boolean` — whether a topic's *file name* may appear in chrome (files panel, pick list): false on error, false if the topic matches an exclude word, false if includes exist and the topic is not among them.

- [ ] **Step 1: Write the failing tests**

Append to `tests/share.test.mjs`:

```js
const mk = text => Core.parseOrg(text);
const X = s => Core.parseShareExpr(s);

test('matchesShare: word matches topic', () => {
  const t = mk('* TODO Ship report\n').tasks[0];
  assert.ok(Core.matchesShare('flo', t, null, X('flo')));
  assert.ok(!Core.matchesShare('home', t, null, X('flo')));
});

test('matchesShare: word matches tag, case-insensitively', () => {
  const t = mk('* TODO 1:1 prep :Elena:\n').tasks[0];
  assert.ok(!Core.matchesShare('flo', t, null, X('flo and !elena')));
  assert.ok(Core.matchesShare('flo', t, null, X('flo and !volha')));
});

test('matchesShare: positives are a union', () => {
  const t = mk('* TODO x\n').tasks[0];
  assert.ok(Core.matchesShare('work', t, null, X('flo and work')));
  assert.ok(Core.matchesShare('flo', t, null, X('flo and work')));
  assert.ok(!Core.matchesShare('home', t, null, X('flo and work')));
});

test('matchesShare: exclude wins over include', () => {
  const t = mk('* TODO 1:1 :elena:\n').tasks[0];
  assert.ok(!Core.matchesShare('flo', t, null, X('flo and elena and !elena')));
});

test('matchesShare: sub-tasks inherit parent tags', () => {
  const f = mk('* TODO Reports :elena:\n** TODO Review comp\n');
  const parent = f.tasks[0], child = parent.children[0];
  assert.ok(!Core.matchesShare('flo', child, parent, X('flo and !elena')));
  assert.ok(Core.matchesShare('flo', child, parent, X('flo')));
});

test('matchesShare: only negatives / empty expression', () => {
  const t = mk('* TODO x\n').tasks[0];
  assert.ok(Core.matchesShare('work', t, null, X('!home')));
  assert.ok(!Core.matchesShare('home', t, null, X('!home')));
  assert.ok(Core.matchesShare('anything', t, null, X('')));
});

test('matchesShare: error expression matches nothing (fail closed)', () => {
  const t = mk('* TODO x\n').tasks[0];
  assert.ok(!Core.matchesShare('flo', t, null, X('!')));
  assert.ok(!Core.matchesShare('flo', t, null, null));
});

test('shareTopicVisible', () => {
  assert.ok(Core.shareTopicVisible('flo', X('flo and !elena')));
  assert.ok(!Core.shareTopicVisible('home', X('flo and !elena')));   // not included
  assert.ok(!Core.shareTopicVisible('home', X('!home')));            // excluded
  assert.ok(Core.shareTopicVisible('work', X('!home')));             // no includes: rest visible
  assert.ok(Core.shareTopicVisible('anything', X('')));              // empty expr
  assert.ok(!Core.shareTopicVisible('flo', X('!')));                 // error: fail closed
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/share.test.mjs`
Expected: FAIL — `Core.matchesShare is not a function` (Task 1 tests still pass).

- [ ] **Step 3: Implement in CORE**

Directly below `parseShareExpr` in the CORE section, add:

```js
  function matchesShare(topic, task, parentTask, expr) {
    if (!expr || expr.error) return false;   // fail closed
    const hay = new Set([topic.toLowerCase(),
                         ...task.tags.map(t => t.toLowerCase()),
                         ...(parentTask ? parentTask.tags.map(t => t.toLowerCase()) : [])]);
    if (expr.exclude.some(w => hay.has(w))) return false;
    if (expr.include.length && !expr.include.some(w => hay.has(w))) return false;
    return true;
  }

  // Whether a topic's *file name* may appear in chrome (files panel, pick list).
  // Deliberately stricter than matchesShare: a topic outside the include list is
  // hidden even though a tag could theoretically match one of its tasks.
  function shareTopicVisible(topic, expr) {
    if (!expr || expr.error) return false;
    const t = topic.toLowerCase();
    if (expr.exclude.includes(t)) return false;
    if (expr.include.length && !expr.include.includes(t)) return false;
    return true;
  }
```

Extend the IIFE return (from Task 1) to:

```js
           parseShareExpr, matchesShare, shareTopicVisible };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/share.test.mjs
git commit -m "feat: Core.matchesShare + shareTopicVisible — share-filter matching"
```

---

### Task 3: APP base layer — state, dropdown, indicator, `S` key, persistence

**Files:**
- Modify: `index.html` (APP section: `App` state, new helper block, `render()`, `taskRows()`, filter-bar markup + CSS, filters wiring, keyboard handler)
- Modify: `tests/ui-e2e.mjs` (append checks near the end, before `ws.close();`)

**Interfaces:**
- Consumes: `Core.parseShareExpr`, `Core.matchesShare` (Tasks 1–2).
- Produces (used by Tasks 4–5): APP functions `shareExpr() -> exprObj|null` (null = off), `activePreset() -> {name, expr}|null`, `setShareActive(name|null)` (persists + renders), `persistSharePresets()`, `renderShareControl()`; state `App.share = { presets, active }`, `App.sharePanel = { open }`; localStorage keys `sharePresets` (JSON `[{name, expr}]`) and `shareActive`. The `#share` `<select>` uses value `'\u0000edit'` for the edit entry (NUL is untypeable in a preset name).

- [ ] **Step 1: Write the failing e2e checks**

In `tests/ui-e2e.mjs`, immediately before the final `ws.close();`, add:

```js
// --- share filters: base layer, indicator, S cycle, Esc keeps preset ---
await evaljs(`(() => {
  App.share.presets = [{ name: 'team', expr: 'home and !secret' }, { name: 'peers', expr: 'home' }];
  persistSharePresets();
  setShareActive('team');
})()`);
await evaljs(`(() => {   // add an excluded-tag task through the app itself
  const qa = document.querySelector('#quickadd');
  qa.value = 'home: Sensitive one-on-one :secret:';
  qa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(400);
const sh1 = await evaljs(`({
  topics: [...new Set(App.visible.map(r => r.topic))],
  groups: [...document.querySelectorAll('#backlog-list h3')].map(h => h.textContent),
  hasSecret: App.visible.some(r => r.task.title.includes('Sensitive')),
  inFile: __files.get('home.org').includes('Sensitive one-on-one'),
  ind: !document.querySelector('#share-ind').hidden,
  indText: document.querySelector('#share-ind').textContent,
  select: document.querySelector('#share').value,
})`);
check('share preset shows only included topic, hides excluded tag, saves to file',
      sh1.topics.every(t => t === 'home') && sh1.groups.every(g => g === 'home')
      && !sh1.hasSecret && sh1.inFile && sh1.ind && sh1.indText.includes('team')
      && sh1.select === 'team',
      JSON.stringify(sh1));

await key('Escape', 'Escape', undefined, 27);
check('Esc clears quick filters but keeps the share preset',
      (await evaljs(`App.share.active`)) === 'team');

await key('S', 'KeyS', 'S', 83);
const cyc1 = await evaljs(`App.share.active`);
await key('S', 'KeyS', 'S', 83);
const cyc2 = await evaljs(`({ active: App.share.active, indHidden: document.querySelector('#share-ind').hidden })`);
await key('S', 'KeyS', 'S', 83);
const cyc3 = await evaljs(`App.share.active`);
check('S cycles team -> peers -> off -> team',
      cyc1 === 'peers' && cyc2.active === null && cyc2.indHidden === true && cyc3 === 'team',
      JSON.stringify({ cyc1, cyc2, cyc3 }));

const persisted = await evaljs(`({ active: localStorage.getItem('shareActive'), presets: localStorage.getItem('sharePresets') })`);
check('share state persisted to localStorage',
      persisted.active === 'team' && persisted.presets.includes('!secret'), JSON.stringify(persisted));

await evaljs(`(() => {
  App.share.presets.push({ name: 'broken', expr: 'flo and' });
  persistSharePresets(); setShareActive('broken');
})()`);
const failClosed = await evaljs(`({
  vis: App.visible.length,
  doneCount: document.querySelector('#done-count').textContent,
  err: document.querySelector('#share-ind').classList.contains('err'),
  txt: document.querySelector('#share-ind').textContent,
})`);
check('malformed active preset fails closed (nothing shown, error indicator)',
      failClosed.vis === 0 && failClosed.doneCount === '0' && failClosed.err
      && failClosed.txt.includes('broken'),
      JSON.stringify(failClosed));
await evaljs(`(() => { App.share.presets = []; persistSharePresets(); setShareActive(null); })()`);
```

- [ ] **Step 2: Run e2e to verify the new checks fail**

Run: `node tests/ui-e2e.mjs`
Expected: existing checks pass; the new block throws (`App.share is undefined`) or FAILs. That's the red state.

- [ ] **Step 3: Add markup and CSS**

In the `#filterbar` div, after the `</select>` of `<select id="sort" …>` and before `<span id="active-flt"></span>`, insert:

```html
    <select id="share" title="share filter — S cycles"></select>
    <span id="share-ind" hidden></span>
```

In the `<style>` block, after the `#filterbar` rule, add:

```css
#share-ind { background:var(--accent); color:#fff; border-radius:999px; padding:2px 10px; font-size:12px; }
#share-ind.err { background:#b3261e; }
```

- [ ] **Step 4: Add share state and helpers**

In the `App` const, add two properties (after `panel: {...}`):

```js
  share: { presets: loadSharePresets(), active: localStorage.getItem('shareActive') },
  sharePanel: { open: false },
```

After the `keyPath` function (and before the IndexedDB section), add a new section:

```js
// --- share filters (privacy presets) ---
function loadSharePresets() {
  try {
    const v = JSON.parse(localStorage.getItem('sharePresets') || '[]');
    return Array.isArray(v) ? v.filter(p => p && typeof p.name === 'string' && typeof p.expr === 'string') : [];
  } catch { return []; }
}
function activePreset() {
  return App.share.presets.find(p => p.name === App.share.active) || null;
}
function shareExpr() {
  const p = activePreset();          // stale/absent active name = off
  return p ? Core.parseShareExpr(p.expr) : null;
}
function persistSharePresets() {
  localStorage.setItem('sharePresets', JSON.stringify(App.share.presets));
}
function setShareActive(name) {
  App.share.active = name;
  if (name) localStorage.setItem('shareActive', name);
  else localStorage.removeItem('shareActive');
  render();
}
```

(`loadSharePresets` is a hoisted function declaration, so the `App` literal may call it.)

- [ ] **Step 5: Apply the base layer in `render()` and `taskRows()`**

In `render()`, replace:

```js
  const pass = r => Core.matchesFilter(r, App.filter, today);
  const passFam = r => Core.matchesFamily(r, App.filter, today);
```

with:

```js
  const sx = shareExpr();
  const shareOk = r => !sx || Core.matchesShare(r.topic, r.task, r.parent || null, sx);
  const pass = r => shareOk(r) && Core.matchesFilter(r, App.filter, today);
  const passFam = r => shareOk(r) && (Core.matchesFilter(r, App.filter, today) || r.task.children.some(c => pass({ topic: r.topic, task: c, parent: r.task })));
```

(The radar/groups/done lines below stay unchanged — they already use `pass`/`passFam`. A family shows only if the parent passes the share layer (a child's quick-filter hit may still rescue a share-visible parent); empty topic groups already drop out via the existing `.filter(([, l]) => l.length)`.)

In `taskRows()`, a share-hidden child must not render under an expanded parent. Add `const sx = shareExpr();` after the existing `const today = todayIso();` line, then replace:

```js
    if (open || (filterOn && Core.matchesFilter(cref, f, today)))
      rows.push(taskRow(cref, 'sub'));
```

with:

```js
    if (sx && !Core.matchesShare(cref.topic, cref.task, cref.parent, sx)) return;
    if (open || (filterOn && Core.matchesFilter(cref, f, today)))
      rows.push(taskRow(cref, 'sub'));
```

(`return` inside the `forEach` callback skips just that child.)

- [ ] **Step 6: Wire the dropdown, indicator, and `S` key**

In the `// --- filters ---` section, after the `sortEl` wiring, add:

```js
const shareEl = $('#share');
shareEl.addEventListener('change', () => {
  const v = shareEl.value;
  shareEl.blur();
  if (v === '\u0000edit') { renderShareControl(); openSharePanel(); return; }
  setShareActive(v || null);
});
function renderShareControl() {
  const opts = [new Option('share: off', '')];
  for (const p of App.share.presets) opts.push(new Option('share: ' + p.name, p.name));
  opts.push(new Option('edit presets…', '\u0000edit'));
  shareEl.replaceChildren(...opts);
  shareEl.value = activePreset() ? App.share.active : '';
  const ind = $('#share-ind');
  const sx = shareExpr();
  ind.hidden = !sx;
  if (sx) {
    ind.textContent = sx.error ? '⛊ ' + App.share.active + ' — ' + sx.error + ' — nothing shown'
                               : '⛊ ' + App.share.active;
    ind.classList.toggle('err', !!sx.error);
  }
}
```

Until Task 4 exists, add a placeholder so the reference resolves — in the same section:

```js
function openSharePanel() { toast('Preset editing arrives in the next task'); }
```

(Task 4 replaces this stub with the real panel.)

In `renderFilterState()`, add a final line:

```js
  renderShareControl();
```

In the global keydown handler, after the `if (k === 'r') {...}` block, add:

```js
  if (k === 'S') {
    const names = App.share.presets.map(p => p.name);
    if (!names.length) { toast('No share presets yet — pick "edit presets…" in the share dropdown'); return; }
    const i = names.indexOf(App.share.active);   // -1 (off/stale) cycles to the first preset
    setShareActive(i === names.length - 1 ? null : names[i + 1]);
    return;
  }
```

`Escape`/`clearFilters()` need no change — they never touch `App.share`.

- [ ] **Step 7: Run tests**

Run: `node --test 'tests/*.test.mjs'` — all PASS (CORE untouched by this task).
Run: `node tests/ui-e2e.mjs` — all checks PASS including the new share block.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: share filter base layer — dropdown, indicator, S cycle, persistence"
```

---

### Task 4: Preset edit panel

**Files:**
- Modify: `index.html` (markup after `#files-panel`, CSS, replace the `openSharePanel` stub, keydown handler)
- Modify: `tests/ui-e2e.mjs` (append checks before `ws.close();`, after Task 3's block)

**Interfaces:**
- Consumes: `App.share`, `App.sharePanel`, `persistSharePresets()`, `setShareActive()`, `renderShareControl()`, `Core.parseShareExpr` (Tasks 1–3), existing `div()`/`span()`/`toast()` helpers.
- Produces: `openSharePanel()`, `closeSharePanel()`, `renderSharePanel()`; markup `#share-panel` / `#share-list` with rows `.srow` containing inputs `.sname`, `.sexpr`, error span `.serr`, a `delete` button per row, and a trailing `+ add preset` button.

- [ ] **Step 1: Write the failing e2e checks**

In `tests/ui-e2e.mjs`, before `ws.close();` (after Task 3's block), add:

```js
// --- share preset edit panel ---
await evaljs(`(() => {
  App.share.presets = [{ name: 'team', expr: 'home and !secret' }, { name: 'peers', expr: 'home' }];
  persistSharePresets(); setShareActive('team');
})()`);
await evaljs(`(() => { const s = document.querySelector('#share'); s.value = '\\u0000edit'; s.dispatchEvent(new Event('change')); })()`);
const panel1 = await evaljs(`({
  open: !document.querySelector('#share-panel').hidden,
  rows: document.querySelectorAll('#share-panel .srow').length,
  select: document.querySelector('#share').value,
})`);
check('"edit presets…" opens panel; select snaps back to active preset',
      panel1.open && panel1.rows === 2 && panel1.select === 'team', JSON.stringify(panel1));

await evaljs(`(() => {
  const row = [...document.querySelectorAll('#share-panel .srow')].find(r => r.querySelector('.sname').value === 'peers');
  const expr = row.querySelector('.sexpr');
  expr.value = 'home and'; expr.dispatchEvent(new Event('input'));
})()`);
check('live parse error shown while typing',
      await evaljs(`[...document.querySelectorAll('#share-panel .serr')].some(e => e.textContent.length > 0)`));

await evaljs(`(() => {
  const row = [...document.querySelectorAll('#share-panel .srow')].find(r => r.querySelector('.sname').value === 'team');
  row.querySelector('button').click();
})()`);
const afterDel = await evaljs(`({ active: App.share.active, count: App.share.presets.length, stored: localStorage.getItem('shareActive') })`);
check('deleting the active preset deactivates it first',
      afterDel.active === null && afterDel.count === 1 && afterDel.stored === null, JSON.stringify(afterDel));

await evaljs(`(() => { [...document.querySelectorAll('#share-list button')].find(b => b.textContent === '+ add preset').click(); })()`);
check('+ add preset appends a row',
      (await evaljs(`App.share.presets.length`)) === 2
      && (await evaljs(`document.querySelectorAll('#share-panel .srow').length`)) === 2);

await key('Escape', 'Escape', undefined, 27);
check('Esc closes the share panel',
      (await evaljs(`document.querySelector('#share-panel').hidden`)) === true);
await evaljs(`(() => { App.share.presets = []; persistSharePresets(); setShareActive(null); })()`);
```

- [ ] **Step 2: Run e2e to verify the new checks fail**

Run: `node tests/ui-e2e.mjs`
Expected: Task 3 block passes; the new block fails (`#share-panel` is null / panel never opens).

- [ ] **Step 3: Add markup and CSS**

After the `#files-panel` div (before `<div id="toast" hidden></div>`), add:

```html
<div id="share-panel" hidden>
<h2>Share filter presets</h2>
<div id="share-list"></div>
<p id="share-hint">Words match a topic or a tag; <code>!word</code> hides every
match and wins; <code>and</code> between words is optional.
Example: <code>flo and !elena and !volha</code>. Esc closes.</p>
</div>
```

In the CSS, change the `#files-panel` container rule to cover both panels:

```css
#files-panel, #share-panel { position:fixed; inset:15% 25%; overflow:auto; background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,.15); padding:20px 24px; z-index:8; }
```

(keep the existing `#files-panel input` rule as-is) and add:

```css
#share-panel input { font:inherit; padding:6px 8px; border:1px solid var(--line); border-radius:6px; }
.srow { display:flex; gap:8px; align-items:center; padding:5px 0; }
.srow .sname { flex:0 0 130px; }
.srow .sexpr { flex:1 1 auto; }
.srow .serr { color:#b3261e; font-size:12px; white-space:nowrap; }
#share-hint { color:var(--muted); font-size:12px; margin-top:10px; }
```

- [ ] **Step 4: Implement the panel**

Delete the `openSharePanel` stub from Task 3 and add a new section after the files-panel section (after `confirmPick`):

```js
// --- share presets panel ---
function openSharePanel() {
  App.sharePanel.open = true;
  renderSharePanel();
}
function closeSharePanel() {
  App.sharePanel.open = false;
  $('#share-panel').hidden = true;
  render();
}
function renderSharePanel() {
  $('#share-panel').hidden = !App.sharePanel.open;
  if (!App.sharePanel.open) return;
  const rows = App.share.presets.map((p, i) => {
    const row = div('srow');
    const name = document.createElement('input');
    name.className = 'sname'; name.value = p.name; name.placeholder = 'name';
    name.onchange = () => {
      const v = name.value.trim();
      if (!v || App.share.presets.some((q, j) => j !== i && q.name === v)) {
        toast(!v ? 'Name required' : 'Name already used');
        name.value = p.name; return;
      }
      if (App.share.active === p.name) { App.share.active = v; localStorage.setItem('shareActive', v); }
      p.name = v; persistSharePresets(); render();
    };
    const expr = document.createElement('input');
    expr.className = 'sexpr'; expr.value = p.expr;
    expr.placeholder = 'flo and !elena and !volha';
    const err = span('serr');
    const showErr = () => { err.textContent = Core.parseShareExpr(expr.value).error || ''; };
    showErr();
    expr.oninput = showErr;
    expr.onchange = () => { p.expr = expr.value; persistSharePresets(); render(); };
    const del = document.createElement('button');
    del.className = 'chip'; del.textContent = 'delete';
    del.onclick = () => {
      if (App.share.active === p.name) setShareActive(null);   // deactivate before deleting
      App.share.presets.splice(i, 1);
      persistSharePresets(); renderSharePanel(); render();
    };
    row.append(name, expr, err, del);
    return row;
  });
  const add = document.createElement('button');
  add.className = 'chip'; add.textContent = '+ add preset';
  add.onclick = () => {
    let n = App.share.presets.length + 1;
    while (App.share.presets.some(p => p.name === 'preset-' + n)) n++;
    App.share.presets.push({ name: 'preset-' + n, expr: '' });
    persistSharePresets(); renderSharePanel(); render();
  };
  $('#share-list').replaceChildren(...rows, add);
}
// Container-level so Escape works while a row input is focused (inputs bubble here
// before the document handler, which ignores INPUT-focused keys anyway).
$('#share-panel').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') closeSharePanel();
});
```

In the global keydown handler, right after the `if (App.panel.open) {...}` block's closing brace (before `if (k === 'F')`), add:

```js
  if (App.sharePanel.open) {
    if (k === 'Escape') closeSharePanel();
    return;   // panel swallows all other keys while open
  }
```

- [ ] **Step 5: Run tests**

Run: `node --test 'tests/*.test.mjs'` — all PASS.
Run: `node tests/ui-e2e.mjs` — all PASS including the panel block.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: share preset edit panel — add/rename/edit/delete with live errors"
```

---

### Task 5: Chrome hiding, quick-add hint, move toast, help docs

**Files:**
- Modify: `index.html` (files panel, `startPick`, keydown `x` branch, quick-add Enter handler, `m` branch, help panel)
- Modify: `tests/ui-e2e.mjs` (append checks before `ws.close();`, after Task 4's block)

**Interfaces:**
- Consumes: `Core.shareTopicVisible`, `Core.matchesShare`, `shareExpr()`, `App.share.active` (Tasks 2–3).
- Produces: `panelFiles() -> entry[]` (share-visible subset of `App.files`, same objects). No other new names.

- [ ] **Step 1: Write the failing e2e checks**

In `tests/ui-e2e.mjs`, before `ws.close();` (after Task 4's block), add:

```js
// --- share chrome hiding + quick-add hint + help ---
await evaljs(`(() => {
  App.share.presets = [{ name: 'demo', expr: '!home' }];
  persistSharePresets(); setShareActive('demo');
})()`);
await key('F', 'KeyF', 'F', 70);
const chrome1 = await evaljs(`({
  rows: [...document.querySelectorAll('#files-list .fname')].map(n => n.textContent),
  total: App.files.length,
})`);
check('files panel hides excluded topic while preset active',
      !chrome1.rows.includes('home.org') && chrome1.rows.length === chrome1.total - 1,
      JSON.stringify(chrome1));
await key('Escape', 'Escape', undefined, 27);   // close files panel

await evaljs(`(() => {
  const qa = document.querySelector('#quickadd');
  qa.value = 'home: hidden errand';
  qa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(400);
const qh = await evaljs(`({ hint: document.querySelector('#hint').textContent, inFile: __files.get('home.org').includes('hidden errand') })`);
check('quick-add into a hidden topic saves and explains itself',
      qh.hint.includes('hidden by share filter "demo"') && qh.inFile, JSON.stringify(qh));

check('help documents share filters',
      await evaljs(`document.querySelector('#help').textContent.includes('Share filters')`));
await evaljs(`(() => { App.share.presets = []; persistSharePresets(); setShareActive(null); })()`);
```

- [ ] **Step 2: Run e2e to verify the new checks fail**

Run: `node tests/ui-e2e.mjs`
Expected: earlier blocks pass; `files panel hides excluded topic` and `quick-add … explains itself` and `help documents` FAIL.

- [ ] **Step 3: Hide topics in the files panel and pick list**

Add next to `panelItemCount()`:

```js
function panelFiles() {
  const sx = shareExpr();
  return sx ? App.files.filter(e => Core.shareTopicVisible(e.topic, sx)) : App.files;
}
```

Change `panelItemCount()`'s list branch:

```js
function panelItemCount() {
  return App.panel.mode === 'pick' ? App.panel.names.length : panelFiles().length;
}
```

In `renderPanel()` list mode, replace:

```js
  if (!App.files.length) {
```
with
```js
  const pf = panelFiles();
  if (!pf.length) {
```

and replace `box.replaceChildren(...App.files.map((e, i) => {` with `box.replaceChildren(...pf.map((e, i) => {`, and inside that row builder change the disconnect button handler from `btn.onclick = () => disconnectAt(i);` to:

```js
      btn.onclick = () => disconnectAt(App.files.indexOf(e));
```

In the global keydown handler's files-panel `x` branch, replace `if (k === 'x') { disconnectAt(p.idx); return; }` with:

```js
      if (k === 'x') { const en = panelFiles()[p.idx]; if (en) disconnectAt(App.files.indexOf(en)); return; }
```

In `startPick()`, filter the folder listing (change `const names` to `let names`):

```js
    let names = await listOrgNames(dir);
    const sx = shareExpr();
    if (sx) names = names.filter(n => Core.shareTopicVisible(n.slice(0, -4), sx));
    if (!names.length) { toast('No .org files in that folder'); return; }
```

- [ ] **Step 4: Quick-add hidden hint**

In the quick-add Enter handler, the current tail is:

```js
  await saveFile(entry, file => { Core.addTask(file, null, Core.makeTask(p, todayIso())); });
  App.lastTopic = topic;
  localStorage.setItem('lastTopic', topic);
  qa.value = '';
  $('#hint').textContent = '';
```

Replace with:

```js
  await saveFile(entry, file => { Core.addTask(file, null, Core.makeTask(p, todayIso())); });
  App.lastTopic = topic;
  localStorage.setItem('lastTopic', topic);
  qa.value = '';
  const sx = shareExpr();
  const hidden = sx && !Core.matchesShare(topic, Core.makeTask(p, todayIso()), null, sx);
  $('#hint').textContent = hidden ? 'saved — hidden by share filter "' + App.share.active + '"' : '';
```

(The throwaway `makeTask` is only used to evaluate the tags; it is never saved.)

- [ ] **Step 5: Move-to-hidden-topic toast**

At the end of `moveSelTo`, after `App.sel = targetTopic + '\t' + block.split('\n', 1)[0];` and before `render();`, add:

```js
  const sx = shareExpr();
  if (sx && !Core.shareTopicVisible(targetTopic, sx))
    toast('Moved to ' + targetTopic + '.org — hidden by share filter "' + App.share.active + '"');
```

(No e2e for this path — the inline-editor flow is stateful; verify manually per Step 7.)

- [ ] **Step 6: Help panel**

Before the `<h2>Shortcuts</h2>` heading in `#help`, add:

```html
<h2>Share filters</h2>
<p>For screen sharing: the <b>share</b> dropdown applies a named preset that
limits what is visible everywhere — lists, Done, search, and file names. A
preset is words separated by <code>and</code> (optional): a bare word shows
only tasks whose topic or tag matches it (several words = any of them);
<code>!word</code> hides every match and always wins. Example:
<code>flo and !elena and !volha</code>. Sub-tasks inherit their parent's tags.
<kbd>S</kbd> cycles presets; <kbd>Esc</kbd> never turns them off. A broken
expression shows nothing rather than risking a leak.</p>
```

In the shortcuts table, after the `<kbd>r</kbd>` row, add:

```html
<tr><td><kbd>S</kbd></td><td>cycle share filter (off / presets)</td></tr>
```

- [ ] **Step 7: Run all tests + manual check**

Run: `node --test 'tests/*.test.mjs'` — all PASS.
Run: `node tests/ui-e2e.mjs` — all PASS.
Manual (Chrome, `sample-tasks/`): create preset `work` via the dropdown's edit panel, activate, press `m` on a work task, type `home` → task moves and the toast explains it's hidden.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: share filter chrome hiding, quick-add hint, move toast, help docs"
```
