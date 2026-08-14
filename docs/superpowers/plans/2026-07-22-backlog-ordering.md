# Backlog Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user re-order the backlog by priority, deadline, or creation time (newest/oldest) via a filter-bar dropdown and the `r` key, replacing the `recent` chip.

**Architecture:** One new pure CORE function `Core.sortBacklog(refs, mode)` (subsuming and deleting `Core.sortRecent`); APP gains `App.sort` state, a `<select id="sort">` control, an `r`-key cycle, and guards that disable manual reordering while a sort is active. Sorting is view-only — no file writes, round-trip invariant untouched.

**Tech Stack:** Vanilla JS in single-file `index.html` (CORE IIFE + APP script), `node:test` unit tests, CDP-driven e2e in `tests/ui-e2e.mjs`.

Spec: `docs/superpowers/specs/2026-07-22-backlog-ordering-design.md`

## Global Constraints

- Everything lives in `index.html`; do not alter the `// ===== CORE START =====` / `// ===== CORE END =====` / `// ===== APP =====` marker comments.
- CORE must never touch `document`/`window`; every CORE addition is exported via the IIFE `return {...}` and unit-tested.
- Round-trip invariant: `Core.serializeFile(Core.parseOrg(text)) === text` — sorting must never set `task.dirty` or write files.
- Sort modes (exact strings): `'topic'` (default), `'priority'`, `'deadline'`, `'created-desc'`, `'created-asc'`.
- Missing values (no priority / no deadline / no `:ADDED:`) sort **last in every mode**, including `created-asc`.
- Ties keep file order (stable sort over the file-ordered input).
- Backlog only: radar and Done sections are never re-sorted.
- Unit tests: `node --test 'tests/*.test.mjs'` (the bare-directory form does NOT work). E2e: `node tests/ui-e2e.mjs`.
- Top-level APP `function` declarations are globals monkey-patched by the e2e test — do not rename existing ones.

---

### Task 1: `Core.sortBacklog`

**Files:**
- Modify: `index.html` — CORE section, after `sortRecent` (~line 466) and the IIFE export list (~line 497-501)
- Test: `tests/model.test.mjs`

**Interfaces:**
- Consumes: `priRank` (CORE-internal, `{A:0,B:1,C:2}` else 3), task fields `priority`, `deadline`, `added` (ISO `YYYY-MM-DD` strings or null).
- Produces: `Core.sortBacklog(refs, mode) -> new Array` — `refs` is an array of `{ topic, index, task }`; `mode` is one of `'priority' | 'deadline' | 'created-desc' | 'created-asc'` (never called with `'topic'`). Input array and refs are not mutated. `Core.sortRecent` stays in place for now (Task 2 deletes it).

- [ ] **Step 1: Write the failing tests**

Append to `tests/model.test.mjs` (after the existing `sortRecent` test):

```js
test('sortBacklog: priority — A first, none last, stable ties', () => {
  const f = mk('* TODO none1\n* TODO [#C] c\n* TODO [#A] a\n* TODO none2\n* TODO [#B] b\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  assert.deepEqual(Core.sortBacklog(refs, 'priority').map(r => r.task.title),
                   ['a', 'b', 'c', 'none1', 'none2']);
});

test('sortBacklog: deadline — soonest first, missing last', () => {
  const f = mk('* TODO late\n  DEADLINE: <2026-09-01 Tue>\n* TODO none\n* TODO soon\n  DEADLINE: <2026-07-20 Mon>\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  assert.deepEqual(Core.sortBacklog(refs, 'deadline').map(r => r.task.title),
                   ['soon', 'late', 'none']);
});

test('sortBacklog: created-desc — newest first, missing ADDED last', () => {
  const f = mk('* TODO old\n  :PROPERTIES:\n  :ADDED:   [2026-07-01 Wed]\n  :END:\n' +
               '* TODO new\n  :PROPERTIES:\n  :ADDED:   [2026-07-18 Sat]\n  :END:\n' +
               '* TODO none\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  assert.deepEqual(Core.sortBacklog(refs, 'created-desc').map(r => r.task.title),
                   ['new', 'old', 'none']);
});

test('sortBacklog: created-asc — oldest first, missing ADDED still last', () => {
  const f = mk('* TODO new\n  :PROPERTIES:\n  :ADDED:   [2026-07-18 Sat]\n  :END:\n' +
               '* TODO none\n' +
               '* TODO old\n  :PROPERTIES:\n  :ADDED:   [2026-07-01 Wed]\n  :END:\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  assert.deepEqual(Core.sortBacklog(refs, 'created-asc').map(r => r.task.title),
                   ['old', 'new', 'none']);
});

test('sortBacklog: returns a new array, input untouched', () => {
  const f = mk('* TODO [#B] b\n* TODO [#A] a\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  const out = Core.sortBacklog(refs, 'priority');
  assert.notEqual(out, refs);
  assert.deepEqual(refs.map(r => r.task.title), ['b', 'a']);
  assert.deepEqual(out.map(r => r.task.title), ['a', 'b']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/model.test.mjs`
Expected: the 5 new tests FAIL with `Core.sortBacklog is not a function`; all pre-existing tests PASS.

- [ ] **Step 3: Implement `sortBacklog` in CORE**

In `index.html`, directly after the `sortRecent` function (ends ~line 466):

```js
  function sortBacklog(refs, mode) {
    const dir = mode === 'created-desc' ? -1 : 1;
    const val = r => mode === 'priority' ? priRank(r.task.priority)
      : mode === 'deadline' ? r.task.deadline
      : r.task.added;
    return [...refs].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av == null) return bv == null ? 0 : 1;   // missing values always last, even desc
      if (bv == null) return -1;
      return av === bv ? 0 : (av < bv ? -1 : 1) * dir;
    });
  }
```

(`priRank` never returns null — priority-less tasks get rank 3, which sorts them last among numbers; the `== null` branches only fire for `deadline`/`added`.)

Add `sortBacklog` to the IIFE export list — the last return line becomes:

```js
           deadlineBucket, buildModel, matchesFilter, matchesFamily, sortRecent, sortBacklog, linkify };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: all tests PASS (including the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/model.test.mjs
git commit -m "feat: Core.sortBacklog — priority/deadline/created backlog comparators"
```

---

### Task 2: Sort dropdown replaces the `recent` chip

**Files:**
- Modify: `index.html` — filter bar HTML (~line 81), CSS (~line 16), `App` state (~line 511), `render()` (~lines 702-706), chip click handler (~lines 1274-1279), `renderFilterState()` (~lines 1287-1296), `clearFilters()` (~line 1268), keydown guard (~line 1332), CORE `sortRecent` deletion (~lines 464-466, 501)
- Test: `tests/model.test.mjs` (delete `sortRecent` test), `tests/ui-e2e.mjs` (new checks)

**Interfaces:**
- Consumes: `Core.sortBacklog(refs, mode)` from Task 1.
- Produces: `App.sort` (string, one of the five mode names, default `'topic'`); `<select id="sort">` whose option values are exactly the mode names; APP-level const `SORT_LABELS` (`{ priority: 'by priority', deadline: 'by deadline', 'created-desc': 'newest first', 'created-asc': 'oldest first' }`). `Core.sortRecent` and `App.filter.recent` no longer exist.

- [ ] **Step 1: Swap the chip for a select in the HTML**

Replace line 81 `<button class="chip flt" data-k="recent" data-v="1">recent</button>` with:

```html
    <select id="sort" title="backlog order — r cycles">
      <option value="topic">order: topic</option>
      <option value="priority">by priority</option>
      <option value="deadline">by deadline</option>
      <option value="created-desc">newest first</option>
      <option value="created-asc">oldest first</option>
    </select>
```

Add a CSS rule after the `#search` rule (line 16):

```css
#sort { font:inherit; font-size:11px; padding:2px 4px; border:1px solid var(--line); border-radius:6px; background:none; color:inherit; }
```

- [ ] **Step 2: Add `App.sort`, drop `App.filter.recent`**

Line ~511 — the `App` literal's filter line currently reads:

```js
  filter: { deadline: null, priority: null, tag: null, topic: null, text: '', recent: false },
```

Replace with:

```js
  filter: { deadline: null, priority: null, tag: null, topic: null, text: '' },
  sort: 'topic',
```

In `clearFilters()` (~line 1268) remove `recent: false` the same way — sort is deliberately NOT reset there:

```js
function clearFilters() {
  App.filter = { deadline: null, priority: null, tag: null, topic: null, text: '' };
  $('#search').value = '';
  render();
}
```

- [ ] **Step 3: Rewire `render()`**

Add next to the other APP helpers (just above `function render()`):

```js
const SORT_LABELS = { priority: 'by priority', deadline: 'by deadline',
                      'created-desc': 'newest first', 'created-asc': 'oldest first' };
```

In `render()` replace the recent branch (lines 702-706):

```js
  if (App.filter.recent) {
    const open = [...radar, ...groups.flatMap(([, l]) => l)];
    radar = [];
    groups = [['recently added', Core.sortRecent(open)]];
  }
```

with (note: radar is NOT merged in and NOT hidden — sort applies to the backlog only):

```js
  if (App.sort !== 'topic') {
    const open = groups.flatMap(([, l]) => l);
    groups = [[SORT_LABELS[App.sort], Core.sortBacklog(open, App.sort)]];
  }
```

- [ ] **Step 4: Wire the control, drop the recent special-cases**

Chip click handler (lines 1274-1279) — remove the recent branch:

```js
document.querySelectorAll('.flt').forEach(b => b.onclick = () => {
  const { k, v } = b.dataset;
  App.filter[k] = App.filter[k] === v ? null : v;
  render();
});
```

After the `searchEl` listeners (~line 1286) add:

```js
const sortEl = $('#sort');
sortEl.addEventListener('change', () => { App.sort = sortEl.value; sortEl.blur(); render(); });
```

In `renderFilterState()` simplify the toggle and sync the select:

```js
function renderFilterState() {
  document.querySelectorAll('.flt').forEach(b => {
    const { k, v } = b.dataset;
    b.classList.toggle('on', App.filter[k] === v);
  });
  $('#sort').value = App.sort;
  const af = [];
  if (App.filter.tag) af.push('tag:' + App.filter.tag);
  if (App.filter.topic) af.push('topic:' + App.filter.topic);
  $('#active-flt').textContent = af.length ? af.join('  ') + '   (Esc clears)' : '';
}
```

Keydown guard (line 1332) — a focused select must own its keys:

```js
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'A' || tag === 'SELECT') return;   // inputs and links handle their own keys
```

- [ ] **Step 5: Delete `Core.sortRecent` and its test**

Remove the `sortRecent` function (lines 464-466) from CORE, remove `sortRecent, ` from the IIFE export list, and delete the `test('sortRecent: newest first, missing ADDED last', …)` block from `tests/model.test.mjs`. Grep to confirm no references remain:

Run: `grep -n "sortRecent\|filter.recent\|'recent'" index.html tests/*.mjs`
Expected: no matches.

- [ ] **Step 6: Run unit tests**

Run: `node --test 'tests/*.test.mjs'`
Expected: all PASS.

- [ ] **Step 7: Add e2e checks**

In `tests/ui-e2e.mjs`, insert before the teardown block (`ws.close();` at the bottom):

```js
// --- backlog sort dropdown ---
await evaljs(`(() => {
  __files.set('home.org',
    '* TODO bb\\n  :PROPERTIES:\\n  :ADDED:   [2026-07-10 Fri]\\n  :END:\\n' +
    '* TODO [#A] cc\\n  :PROPERTIES:\\n  :ADDED:   [2026-07-12 Sun]\\n  :END:\\n' +
    '* TODO aa\\n');
  __mtimes.set('home.org', 99999);
})()`);
await key('Escape', 'Escape', undefined, 27);   // clear any leftover filters
await sleep(2500);                              // let scanTick re-parse the outside edit

const backlogTitles = () => evaljs(
  `[...document.querySelectorAll('#backlog-list .task .title')].map(e => e.textContent)`);
const setSort = v => evaljs(
  `(() => { const s = document.querySelector('#sort'); s.value = '${v}'; s.dispatchEvent(new Event('change')); return App.sort; })()`);

const dflt = await backlogTitles();
check('default order keeps file order within the topic group',
      dflt.indexOf('bb') < dflt.indexOf('cc') && dflt.indexOf('cc') < dflt.indexOf('aa'),
      JSON.stringify(dflt));

await setSort('priority');
const byPri = await backlogTitles();
const hdr = await evaljs(`[...document.querySelectorAll('#backlog-list h3')].map(h => h.textContent)`);
check('priority sort puts #A first, flattens to a single labeled group',
      byPri.indexOf('cc') === 0 && hdr.length === 1 && hdr[0] === 'by priority',
      JSON.stringify({ byPri, hdr }));
check('priority ties keep file order', byPri.indexOf('bb') < byPri.indexOf('aa'), JSON.stringify(byPri));

await setSort('created-desc');
const byNew = await backlogTitles();
check('created-desc: newest first, missing ADDED last',
      byNew.indexOf('cc') < byNew.indexOf('bb') && byNew.indexOf('bb') < byNew.indexOf('aa'),
      JSON.stringify(byNew));

await setSort('created-asc');
const byOld = await backlogTitles();
check('created-asc: oldest first, missing ADDED still last',
      byOld.indexOf('bb') < byOld.indexOf('cc') && byOld.indexOf('cc') < byOld.indexOf('aa'),
      JSON.stringify(byOld));

await setSort('topic');
const backAgain = await backlogTitles();
check('back to topic order restores file order and topic headers',
      backAgain.indexOf('bb') < backAgain.indexOf('cc') &&
      (await evaljs(`[...document.querySelectorAll('#backlog-list h3')].map(h => h.textContent)`)).includes('home'),
      JSON.stringify(backAgain));
```

- [ ] **Step 8: Run the e2e suite**

Run: `node tests/ui-e2e.mjs`
Expected: `all e2e checks passed` (or `SKIP` if Chrome is missing — then verify manually per Step 9).

- [ ] **Step 9: Commit**

```bash
git add index.html tests/model.test.mjs tests/ui-e2e.mjs
git commit -m "feat: backlog sort dropdown (priority/deadline/created) replaces recent chip"
```

---

### Task 3: `r` shortcut + help panel

**Files:**
- Modify: `index.html` — keydown handler (add branch after the `/` branch, ~line 1363), `SORT_LABELS` area (add `SORT_CYCLE`), help panel (~lines 100 and 122-145)
- Test: `tests/ui-e2e.mjs`

**Interfaces:**
- Consumes: `App.sort`, `render()` from Task 2.
- Produces: APP-level const `SORT_CYCLE = ['topic', 'priority', 'deadline', 'created-desc', 'created-asc']`; `r` key cycles `App.sort` through it (wrapping), no-op while an input/select/link is focused (already guarded).

- [ ] **Step 1: Add `SORT_CYCLE` and the key branch**

Next to `SORT_LABELS`:

```js
const SORT_CYCLE = ['topic', 'priority', 'deadline', 'created-desc', 'created-asc'];
```

In the main keydown handler, after the `/` branch (line 1363):

```js
  if (k === 'r') {
    App.sort = SORT_CYCLE[(SORT_CYCLE.indexOf(App.sort) + 1) % SORT_CYCLE.length];
    render();
    return;
  }
```

(No `preventDefault` needed — `r` focuses nothing and has no browser default here; `renderFilterState()` inside `render()` updates the select so the current mode is visible.)

- [ ] **Step 2: Update the help panel**

Line ~100, the sentence `The backlog below is grouped by topic, in file order.` becomes:

```html
The backlog below is grouped by topic, in file order; the order dropdown (or
<kbd>r</kbd>) re-sorts it by priority, deadline, or when tasks were added.
```

In the shortcuts table, after the `Alt+↑/Alt+↓` row (line 125) add:

```html
<tr><td><kbd>r</kbd></td><td>cycle backlog order (topic / priority / deadline / newest / oldest)</td></tr>
```

- [ ] **Step 3: Add e2e check**

In `tests/ui-e2e.mjs`, directly after the Task 2 block (still before teardown):

```js
// --- r cycles sort modes ---
await key('r', 'KeyR', 'r', 82);
const afterR1 = await evaljs(`({ sort: App.sort, sel: document.querySelector('#sort').value })`);
check('r cycles topic -> priority and syncs the select',
      afterR1.sort === 'priority' && afterR1.sel === 'priority', JSON.stringify(afterR1));
await key('r', 'KeyR', 'r', 82);
await key('r', 'KeyR', 'r', 82);
await key('r', 'KeyR', 'r', 82);
await key('r', 'KeyR', 'r', 82);
check('r wraps back to topic after all five modes', (await evaljs(`App.sort`)) === 'topic');
```

- [ ] **Step 4: Run both suites**

Run: `node --test 'tests/*.test.mjs' && node tests/ui-e2e.mjs`
Expected: all PASS / `all e2e checks passed`.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: r key cycles backlog sort; help panel documents ordering"
```

---

### Task 4: Disable manual reordering while sorted

**Files:**
- Modify: `index.html` — Alt+Arrow branch (~lines 1364-1382), `row.ondragstart`/`row.ondrop` (~lines 820-848)
- Test: `tests/ui-e2e.mjs`

**Interfaces:**
- Consumes: `App.sort`, `toast(msg)` (existing APP global).
- Produces: while `App.sort !== 'topic'`, Alt+↑/↓, drag-start, and drop are no-ops that show the toast `Reordering needs topic order`.

- [ ] **Step 1: Guard the Alt+Arrow branch**

Insert right after its `e.preventDefault()` (line 1365):

```js
    if (App.sort !== 'topic') { toast('Reordering needs topic order'); return; }
```

- [ ] **Step 2: Guard drag start and drop**

Replace line 821:

```js
  row.ondragstart = e => e.dataTransfer.setData('text/plain', row.dataset.rk);
```

with:

```js
  row.ondragstart = e => {
    if (App.sort !== 'topic') { e.preventDefault(); toast('Reordering needs topic order'); return; }
    e.dataTransfer.setData('text/plain', row.dataset.rk);
  };
```

And in `row.ondrop`, right after its `e.preventDefault();` (line 824):

```js
    if (App.sort !== 'topic') { toast('Reordering needs topic order'); return; }
```

- [ ] **Step 3: Add e2e check**

In `tests/ui-e2e.mjs`, after the Task 3 block (before teardown):

```js
// --- reordering disabled while sorted ---
await evaljs(`(() => { const s = document.querySelector('#sort'); s.value = 'priority'; s.dispatchEvent(new Event('change')); })()`);
const fileBefore = await evaljs(`__files.get('home.org')`);
await evaljs(`(() => {   // select the first backlog row
  const i = App.visible.findIndex(r => r.task.title === 'cc');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
})()`);
await key('ArrowDown', 'ArrowDown', undefined, 40, 1);   // Alt+Down (modifiers: 1 = Alt)
await sleep(300);
const reorder = await evaljs(`({ file: __files.get('home.org'), toast: document.querySelector('#toast').textContent })`);
check('Alt+Down while sorted: toast shown, file bytes unchanged',
      reorder.file === fileBefore && reorder.toast === 'Reordering needs topic order',
      JSON.stringify({ changed: reorder.file !== fileBefore, toast: reorder.toast }));
await evaljs(`(() => { const s = document.querySelector('#sort'); s.value = 'topic'; s.dispatchEvent(new Event('change')); })()`);
```

- [ ] **Step 4: Run both suites**

Run: `node --test 'tests/*.test.mjs' && node tests/ui-e2e.mjs`
Expected: all PASS / `all e2e checks passed`.

- [ ] **Step 5: Manual smoke check**

Open `index.html` in Chrome (serve via `python3 -m http.server` if the picker is blocked on `file://`), connect `sample-tasks/`, and verify: dropdown re-sorts the backlog and collapses topic headers to one; `r` cycles with the select following; Alt+↓ and drag show the toast while sorted; radar order never changes.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: disable manual reordering while a backlog sort is active"
```
