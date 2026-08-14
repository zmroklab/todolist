# Duplicate-Selection Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a selected task renders twice (radar row + nested backlog row with the same `data-rk`), give the current copy the full `.sel` highlight and the other copy a lighter `.sel-dup` echo, so the user can see where the selection cursor actually is.

**Architecture:** The app is a single `index.html`; all changes live in the APP section (below `// ===== APP =====`) and its CSS. `taskRow()` pushes each ref into `App.visible` in exact DOM creation order and the three list containers (`#radar-list`, `#backlog-list`, `#done-list`) appear in that same order in the document, so `document.querySelectorAll('.task')[i]` corresponds to `App.visible[i]`. `App.selPos` already disambiguates which copy of a duplicated key is current (that is how `moveSel()` walks past duplicates). We make `updateSelClass()` position-aware on that basis, and fix the two places that normalize `selPos` back to the first key match (row click, `render()` selection restore).

**Tech Stack:** Vanilla JS in `index.html`, no build step. Tests: `tests/ui-e2e.mjs` (headless Chrome via CDP; APP code is not unit-testable). Spec: `docs/superpowers/specs/2026-07-25-duplicate-selection-highlight-design.md`.

## Global Constraints

- Zero CORE changes — nothing between `// ===== CORE START =====` and `// ===== CORE END =====` may be touched; the round-trip invariant is not in play.
- Do not rename top-level APP functions (`updateSelClass`, `render`, `taskRow`, `moveSel`, …) — the e2e test calls them as globals.
- `.frow.sel` (files panel) styling and behavior are untouched.
- Test commands: `node tests/ui-e2e.mjs` (needs Google Chrome; skips cleanly if missing). Run `node --test 'tests/*.test.mjs'` once at the end as a regression guard (the glob, NOT a bare directory arg).
- Line numbers below are as of commit `5acd562`; verify surrounding code matches before editing.

---

### Task 1: `.sel-dup` CSS + position-aware `updateSelClass()`

**Files:**
- Modify: `index.html:24` (CSS, add one rule after `.task.sel`)
- Modify: `index.html:868-870` (`updateSelClass()`)
- Test: `tests/ui-e2e.mjs` (insert new section immediately before the final `ws.close();` line, currently line ~1088)

**Interfaces:**
- Consumes: existing globals `App` (`.sel`, `.selPos`, `.visible`, `.expanded`), `refKey(r)`, `render()`, `updateSelClass()`, e2e page globals `__files`, `__mtimes`, `todayIso()`.
- Produces: `updateSelClass()` now guarantees **exactly one** `.task.sel` element (the one at index `App.selPos` when its `data-rk` matches `App.sel`, else the first `data-rk` match) and puts `.sel-dup` on every other element with the same `data-rk`. Tasks 2 and 3 rely on this. The e2e fixture task titled `Dup radar child` (duplicated radar sub-task in `home.org`, parent `Dup parent` expanded) is reused by Tasks 2 and 3.

- [ ] **Step 1: Write the failing e2e checks**

In `tests/ui-e2e.mjs`, insert immediately before the final `ws.close();`:

```js
// --- duplicate radar sub-task: one .sel on the current copy, .sel-dup echo on the other ---
await evaljs(`(() => {
  __files.set('home.org', __files.get('home.org') +
    '* TODO Dup parent\\n** NEXT Dup radar child\\n   DEADLINE: <' + todayIso() + '>\\n');
  __mtimes.set('home.org', 9999999999);
  return true;
})()`);
await sleep(2500);
const dupSel = await evaljs(`(() => {
  const pi = App.visible.findIndex(r => !r.parent && r.task.title === 'Dup parent');
  App.expanded.add(refKey(App.visible[pi])); render();
  const idxs = App.visible.flatMap((r, i) => r.task.title === 'Dup radar child' ? [i] : []);
  App.sel = refKey(App.visible[idxs[0]]); App.selPos = idxs[0]; updateSelClass();
  const rows = [...document.querySelectorAll('.task')];
  return { idxs,
           selIdx: rows.findIndex(el => el.classList.contains('sel')),
           dupIdx: rows.findIndex(el => el.classList.contains('sel-dup')),
           selCount: rows.filter(el => el.classList.contains('sel')).length,
           dupCount: rows.filter(el => el.classList.contains('sel-dup')).length };
})()`);
check('radar copy current: one .sel at selPos, one .sel-dup on the nested copy',
      dupSel.idxs.length === 2 && dupSel.selCount === 1 && dupSel.dupCount === 1 &&
      dupSel.selIdx === dupSel.idxs[0] && dupSel.dupIdx === dupSel.idxs[1],
      JSON.stringify(dupSel));
const dupSel2 = await evaljs(`(() => {
  const idxs = App.visible.flatMap((r, i) => r.task.title === 'Dup radar child' ? [i] : []);
  App.sel = refKey(App.visible[idxs[1]]); App.selPos = idxs[1]; updateSelClass();
  const rows = [...document.querySelectorAll('.task')];
  return { idxs,
           selIdx: rows.findIndex(el => el.classList.contains('sel')),
           dupIdx: rows.findIndex(el => el.classList.contains('sel-dup')),
           selCount: rows.filter(el => el.classList.contains('sel')).length,
           dupCount: rows.filter(el => el.classList.contains('sel-dup')).length };
})()`);
check('backlog copy current: .sel and .sel-dup swap',
      dupSel2.selCount === 1 && dupSel2.dupCount === 1 &&
      dupSel2.selIdx === dupSel2.idxs[1] && dupSel2.dupIdx === dupSel2.idxs[0],
      JSON.stringify(dupSel2));
const noDup = await evaljs(`(() => {
  const i = App.visible.findIndex(r => !r.parent && r.task.title === 'Dup parent');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
  return { sel: document.querySelectorAll('.task.sel').length,
           dup: document.querySelectorAll('.task.sel-dup').length };
})()`);
check('non-duplicated selection: one .sel, zero .sel-dup', noDup.sel === 1 && noDup.dup === 0,
      JSON.stringify(noDup));
```

- [ ] **Step 2: Run the e2e test to verify the new checks fail**

Run: `node tests/ui-e2e.mjs`
Expected: `FAIL radar copy current: …` (old code puts `.sel` on both copies, so `selCount === 2`) and `FAIL backlog copy current: …`. The `non-duplicated selection` check and all pre-existing checks pass. Exit code 1.

- [ ] **Step 3: Implement the CSS rule and position-aware `updateSelClass()`**

In `index.html`, after line 24 (`.task.sel { … }`), add:

```css
.task.sel-dup { background:#eff6ff; outline:1px dashed #93c5fd; }
```

Replace `updateSelClass()` (currently lines 868-870):

```js
function updateSelClass() {
  document.querySelectorAll('.task').forEach(el => el.classList.toggle('sel', el.dataset.rk === App.sel));
}
```

with:

```js
function updateSelClass() {
  // duplicate data-rk (radar copy + nested copy): the row at selPos is the
  // current one; any other match gets the lighter echo
  const rows = [...document.querySelectorAll('.task')];
  const cur = rows[App.selPos]?.dataset.rk === App.sel
    ? rows[App.selPos] : rows.find(el => el.dataset.rk === App.sel);
  for (const el of rows) {
    el.classList.toggle('sel', el === cur);
    el.classList.toggle('sel-dup', el !== cur && el.dataset.rk === App.sel);
  }
}
```

(`App.sel === null` matches no `data-rk`, so `cur` is `undefined` and both classes clear everywhere — same as before. `rows[App.selPos]` with a stale/oversized `selPos` is `undefined`, so the `?.` falls back to the first key match.)

- [ ] **Step 4: Run the e2e test to verify all checks pass**

Run: `node tests/ui-e2e.mjs`
Expected: all checks `ok`, final line `all e2e checks passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: lighter sel-dup echo on the duplicate copy of a selected task"
```

---

### Task 2: Clicking a duplicate copy makes it the current copy

**Files:**
- Modify: `index.html:943-947` (`row.onclick` inside `taskRow()`)
- Test: `tests/ui-e2e.mjs` (append after Task 1's checks, still before `ws.close();`)

**Interfaces:**
- Consumes: Task 1's `updateSelClass()` contract and the `Dup radar child` fixture (already in `home.org` from Task 1's checks, parent still expanded).
- Produces: `row.onclick` sets `App.selPos` to the clicked row's own index in `App.visible` order (captured as `const pos = App.visible.length - 1;` at `taskRow()` creation time, since `taskRow` pushes its ref immediately before creating the row).

- [ ] **Step 1: Write the failing e2e check**

Append after Task 1's checks in `tests/ui-e2e.mjs`:

```js
// --- clicking the duplicate copy makes IT current (selPos = clicked row's index) ---
const dupClick = await evaljs(`(() => {
  const idxs = App.visible.flatMap((r, i) => r.task.title === 'Dup radar child' ? [i] : []);
  const rows = [...document.querySelectorAll('.task')];
  rows[idxs[1]].click();
  return { idxs, selPos: App.selPos,
           selIdx: [...document.querySelectorAll('.task')].findIndex(el => el.classList.contains('sel')) };
})()`);
check('clicking the backlog copy makes it current',
      dupClick.selPos === dupClick.idxs[1] && dupClick.selIdx === dupClick.idxs[1],
      JSON.stringify(dupClick));
```

- [ ] **Step 2: Run the e2e test to verify the new check fails**

Run: `node tests/ui-e2e.mjs`
Expected: `FAIL clicking the backlog copy makes it current` — old `onclick` computes `App.selPos` via `findIndex` on the key, which resolves to the radar copy (`idxs[0]`). All other checks pass. Exit 1.

- [ ] **Step 3: Implement the click fix**

In `index.html`, `taskRow()`, replace (currently lines 943-947):

```js
  row.onclick = () => {
    App.sel = row.dataset.rk;
    App.selPos = App.visible.findIndex(r => refKey(r) === App.sel);
    updateSelClass();
  };
```

with:

```js
  // this row's own index in App.visible (ref was pushed just above) — a key
  // lookup would normalize duplicate keys to the first (radar) copy
  const pos = App.visible.length - 1;
  row.onclick = () => {
    App.sel = row.dataset.rk;
    App.selPos = pos;
    updateSelClass();
  };
```

Place `const pos = …` on the line directly above `row.onclick`.

- [ ] **Step 4: Run the e2e test to verify all checks pass**

Run: `node tests/ui-e2e.mjs`
Expected: all checks `ok`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "fix: clicking a duplicate copy makes it the current selection"
```

---

### Task 3: Re-render keeps the current copy (selPos-stable restore)

**Files:**
- Modify: `index.html:857-863` (selection restore at the end of `render()`)
- Test: `tests/ui-e2e.mjs` (append after Task 2's check, still before `ws.close();`)

**Interfaces:**
- Consumes: Task 1's `updateSelClass()` contract and the `Dup radar child` fixture.
- Produces: `render()` keeps `App.selPos` on the copy it was on whenever `refKey(App.visible[App.selPos]) === App.sel` still holds — the same disambiguation `moveSel()` performs (`index.html:1460-1463`).

- [ ] **Step 1: Write the failing e2e check**

Append after Task 2's check in `tests/ui-e2e.mjs`:

```js
// --- re-render keeps the current copy instead of normalizing to the radar copy ---
const dupRender = await evaljs(`(() => {
  const idxs = App.visible.flatMap((r, i) => r.task.title === 'Dup radar child' ? [i] : []);
  App.sel = refKey(App.visible[idxs[1]]); App.selPos = idxs[1]; updateSelClass();
  render();
  return { idxs, selPos: App.selPos,
           selIdx: [...document.querySelectorAll('.task')].findIndex(el => el.classList.contains('sel')) };
})()`);
check('re-render keeps selection on the backlog copy',
      dupRender.selPos === dupRender.idxs[1] && dupRender.selIdx === dupRender.idxs[1],
      JSON.stringify(dupRender));
```

- [ ] **Step 2: Run the e2e test to verify the new check fails**

Run: `node tests/ui-e2e.mjs`
Expected: `FAIL re-render keeps selection on the backlog copy` — old restore sets `idx` via `findIndex`, normalizing to `idxs[0]`. All other checks pass. Exit 1.

- [ ] **Step 3: Implement the selPos-stable restore**

In `index.html`, `render()`, replace (currently lines 857-863):

```js
  // selection: keep by key, fall back to same position
  let idx = App.visible.findIndex(r => refKey(r) === App.sel);
  if (idx === -1 && App.visible.length) {
    idx = Math.min(App.selPos, App.visible.length - 1);
    App.sel = refKey(App.visible[idx]);
  }
  if (idx === -1) App.sel = null; else App.selPos = idx;
```

with:

```js
  // selection: keep by key, fall back to same position
  let idx = App.visible.findIndex(r => refKey(r) === App.sel);
  // duplicate keys resolve to the first match; stay on the copy selPos was on
  if (idx !== -1 && App.selPos < App.visible.length &&
      refKey(App.visible[App.selPos]) === App.sel) idx = App.selPos;
  if (idx === -1 && App.visible.length) {
    idx = Math.min(App.selPos, App.visible.length - 1);
    App.sel = refKey(App.visible[idx]);
  }
  if (idx === -1) App.sel = null; else App.selPos = idx;
```

- [ ] **Step 4: Run the e2e test to verify all checks pass**

Run: `node tests/ui-e2e.mjs`
Expected: all checks `ok`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "fix: re-render keeps selection on the copy at selPos"
```

---

### Task 4: CLAUDE.md gotcha update + full regression run

**Files:**
- Modify: `CLAUDE.md` (the radar-duplicate bullet under "UI gotchas learned the hard way")

**Interfaces:**
- Consumes: the final behavior from Tasks 1-3.
- Produces: documentation only.

- [ ] **Step 1: Update the gotcha bullet**

In `CLAUDE.md`, replace:

```markdown
- A sub-task that qualifies for the radar renders twice with the same
  `data-rk` (radar row + nested row under its parent). Selection highlights
  both and normalizes to the radar copy (first in `App.visible`); the inline
  editor opens under that first copy. Accepted display quirk — don't dedupe
  by mangling `refKey`, it is identity for key-path mutations.
```

with:

```markdown
- A sub-task that qualifies for the radar renders twice with the same
  `data-rk` (radar row + nested row under its parent). The copy at
  `App.selPos` gets `.sel`; the other copy gets the lighter `.sel-dup` echo.
  Click, re-render, scroll, and the inline editor all follow the current
  copy — this works because DOM `.task` order matches `App.visible` order
  (`taskRow` pushes in creation order). Don't dedupe by mangling `refKey`,
  it is identity for key-path mutations.
```

(If the bullet's line wrapping in `CLAUDE.md` differs from the above, match on its full text and preserve the file's wrapping style.)

- [ ] **Step 2: Full regression run**

Run: `node --test 'tests/*.test.mjs'`
Expected: all unit tests pass (nothing in CORE changed).

Run: `node tests/ui-e2e.mjs`
Expected: `all e2e checks passed`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: duplicate-selection highlight gotcha in CLAUDE.md"
```
