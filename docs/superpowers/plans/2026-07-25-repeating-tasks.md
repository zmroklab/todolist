# Repeating Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add org-native deadline repeaters (`DEADLINE: <2026-08-01 Sat +1w>`) so completing a task with `d` advances its deadline one interval instead of archiving it, with `D` rolling it back.

**Architecture:** All parsing, serialization, date arithmetic, and mutations live in the CORE IIFE (`index.html`, between the `// ===== CORE START =====` / `END` markers) and are covered by Node unit tests. The APP layer gains only key wiring (`d` / `D`), editor plumbing (`s`, `e`, quick-add), and a recurrence chip. A repeater is stored as `t.repeat` (a cookie string like `+1w`, or `null`) and only exists alongside a deadline.

**Tech Stack:** Single-file vanilla JS (`index.html`), no build. Node ≥ 18 built-in test runner (`node --test`), no dependencies. Browser e2e via Chrome DevTools Protocol (`tests/ui-e2e.mjs`).

## Global Constraints

- **Round-trip invariant:** `Core.serializeFile(Core.parseOrg(text)) === text` byte-for-byte when nothing was edited. `t.repeat` is re-rendered only when the block is dirty; untouched blocks pass through `t.raw` verbatim. If a round-trip test fails, fix the code, never the test.
- **CORE purity:** Anything in the CORE section must not touch `document` / `window`, must be exported through the IIFE's `return { ... }`, and must be unit-tested.
- **Marker comments** (`// ===== CORE START =====`, `// ===== CORE END =====`, `// ===== APP =====`) are grepped by tooling — never alter them.
- **Repeater grammar:** `+` then one or more digits then one of `d w m y` (lowercase). Plain `+` only — no `++` / `.+` variants. A repeater requires a deadline; without one it is dropped.
- **Units:** `d` days, `w` weeks (7 days), `m` calendar months, `y` calendar years. Month/year arithmetic clamps the day to the last valid day of the target month.
- **Commit style:** plain `git commit` works (repo sets `commit.gpgsign=false` locally). Run tests with `node --test 'tests/*.test.mjs'` (the glob is required; a bare directory arg does not work).

---

### Task 1: `addInterval` date arithmetic helper (CORE)

Pure date math: shift an ISO date forward/back by a repeater cookie, clamping month/year overflow to month-end. No dependencies on other new code — build it first.

**Files:**
- Modify: `index.html` — add `addInterval` inside CORE (near `addDays`, ~line 201–205) and to the export list (~line 589–594).
- Create: `tests/repeat.test.mjs`

**Interfaces:**
- Consumes: existing `pad` (in scope in CORE), `addDays(iso, n)`.
- Produces: `Core.addInterval(iso, sign, repeat)` → new ISO `YYYY-MM-DD` string, or `null` if `repeat` is unparseable. `sign` is `+1` (advance) or `-1` (roll back). Shift is `sign * count` of the unit.

- [ ] **Step 1: Write the failing test**

Create `tests/repeat.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

test('addInterval: day and week arithmetic', () => {
  assert.equal(Core.addInterval('2026-07-25', 1, '+1d'), '2026-07-26');
  assert.equal(Core.addInterval('2026-07-25', -1, '+1d'), '2026-07-24');
  assert.equal(Core.addInterval('2026-07-25', 1, '+2w'), '2026-08-08');
  assert.equal(Core.addInterval('2026-08-08', -1, '+2w'), '2026-07-25');
});

test('addInterval: month arithmetic with end-of-month clamp', () => {
  assert.equal(Core.addInterval('2026-01-31', 1, '+1m'), '2026-02-28'); // Feb has 28
  assert.equal(Core.addInterval('2026-03-31', -1, '+1m'), '2026-02-28');
  assert.equal(Core.addInterval('2026-01-15', 1, '+3m'), '2026-04-15');  // no clamp needed
  assert.equal(Core.addInterval('2026-12-15', 1, '+1m'), '2027-01-15');  // year rollover
});

test('addInterval: year arithmetic with leap-day clamp', () => {
  assert.equal(Core.addInterval('2028-02-29', 1, '+1y'), '2029-02-28');
  assert.equal(Core.addInterval('2026-07-25', 1, '+1y'), '2027-07-25');
});

test('addInterval: unparseable cookie returns null', () => {
  assert.equal(Core.addInterval('2026-07-25', 1, '1w'), null);   // missing +
  assert.equal(Core.addInterval('2026-07-25', 1, '+1x'), null);  // bad unit
  assert.equal(Core.addInterval('2026-07-25', 1, null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/repeat.test.mjs`
Expected: FAIL — `Core.addInterval is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `index.html`, immediately after `addDays` (after line 205), add:

```js
  function addInterval(iso, sign, repeat) {
    const m = /^\+(\d+)([dwmy])$/.exec(repeat || '');
    if (!m) return null;
    const n = (+m[1]) * sign, unit = m[2];
    if (unit === 'd') return addDays(iso, n);
    if (unit === 'w') return addDays(iso, n * 7);
    // m / y: shift year-month, then clamp day to the target month's last day
    let [y, mo, d] = iso.split('-').map(Number);
    if (unit === 'y') y += n;
    else { mo += n; y += Math.floor((mo - 1) / 12); mo = ((mo - 1) % 12 + 12) % 12 + 1; }
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate(); // day 0 of next month
    if (d > lastDay) d = lastDay;
    return y + '-' + pad(mo) + '-' + pad(d);
  }
```

Add `addInterval` to the export object (line ~589), e.g. after `addDays`:

```js
  return { version: 1, dayName, addDays, addInterval, orgActive, orgInactive, parseDateToken, parseOrg,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/repeat.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/repeat.test.mjs
git commit -m "feat: addInterval date helper for repeaters (day/week/month/year, month-end clamp)"
```

---

### Task 2: Parse and serialize the repeater cookie (CORE)

Capture `+1w` out of the `DEADLINE:` timestamp into `t.repeat`, and re-emit it. Preserve the byte-for-byte round-trip.

**Files:**
- Modify: `index.html` — `parsePlanning` (line 250–257), the `parseNode` task object literal (line 262–264), `orgActive` (line 206), `renderTask`'s DEADLINE line (line 316).
- Modify: `tests/repeat.test.mjs` (add cases).

**Interfaces:**
- Consumes: `Core.addInterval` (Task 1) — not directly here, but same feature file.
- Produces: `t.repeat` (string `+1w` or `null`) on every parsed/created task; `Core.orgActive(iso, repeat)` now accepts an optional second arg and appends ` +1w` when present.

- [ ] **Step 1: Write the failing test**

Append to `tests/repeat.test.mjs`:

```js
test('parseOrg captures repeater into t.repeat', () => {
  const f = Core.parseOrg('* TODO Water plants\n  DEADLINE: <2026-08-01 Sat +1w>\n');
  assert.equal(f.tasks[0].deadline, '2026-08-01');
  assert.equal(f.tasks[0].repeat, '+1w');
});

test('parseOrg leaves repeat null when no cookie', () => {
  const f = Core.parseOrg('* TODO Plain\n  DEADLINE: <2026-08-01 Sat>\n');
  assert.equal(f.tasks[0].repeat, null);
});

test('orgActive appends repeater when given', () => {
  assert.equal(Core.orgActive('2026-08-01', '+1w'), '<2026-08-01 Sat +1w>');
  assert.equal(Core.orgActive('2026-08-01'), '<2026-08-01 Sat>');
});

test('round-trip preserves a repeating deadline byte-for-byte', () => {
  const text = '* NEXT Water plants\n  DEADLINE: <2026-08-01 Sat +1w>\n  :PROPERTIES:\n  :ADDED:   [2026-07-25 Sat]\n  :END:\n';
  assert.equal(Core.serializeFile(Core.parseOrg(text)), text);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/repeat.test.mjs`
Expected: FAIL — `t.repeat` is `undefined`; `orgActive` ignores the 2nd arg.

- [ ] **Step 3: Write minimal implementation**

`parsePlanning` (line 251) — capture the optional cookie. Replace:

```js
    const dm = line.match(/DEADLINE:\s*<(\d{4}-\d{2}-\d{2})[^>]*>/);
    if (dm) t.deadline = dm[1];
```

with:

```js
    const dm = line.match(/DEADLINE:\s*<(\d{4}-\d{2}-\d{2})[^>]*?(?:\s+(\+\d+[dwmy]))?>/);
    if (dm) { t.deadline = dm[1]; t.repeat = dm[2] || null; }
```

`parseNode` task literal (line 263) — initialize the field. Add `repeat: null,` next to `deadline: null`:

```js
                title: h.title, tags: h.tags, deadline: null, repeat: null, closed: null, scheduledRaw: null,
```

`orgActive` (line 206) — accept the cookie:

```js
  function orgActive(iso, repeat) { return '<' + iso + ' ' + dayName(iso) + (repeat ? ' ' + repeat : '') + '>'; }
```

`renderTask` DEADLINE line (line 316) — pass the cookie:

```js
    if (t.deadline) plan.push('DEADLINE: ' + orgActive(t.deadline, t.repeat));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/repeat.test.mjs`
Expected: PASS (all repeat tests).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS (existing `orgActive` call with one arg still returns `<... >` unchanged; round-trip suites green).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/repeat.test.mjs
git commit -m "feat: parse and serialize org deadline repeaters (t.repeat)"
```

---

### Task 3: `setDeadline(iso, repeat)` + `advanceRepeat` mutations (CORE)

Make the deadline setter carry the repeater, add the advance/roll-back mutation, and keep `bumpDeadline` from wiping an existing repeater.

**Files:**
- Modify: `index.html` — `setDeadline` (line 339), `bumpDeadline` (line 340–342), `makeTask` literal is handled in Task 4; add `advanceRepeat` near `setState` (after line 335); export both (line 590).
- Modify: `tests/repeat.test.mjs`.

**Interfaces:**
- Consumes: `Core.addInterval` (Task 1), `t.repeat` (Task 2), existing `touch`, `setState`.
- Produces:
  - `Core.setDeadline(task, iso, repeat = null)` — sets `task.deadline` and `task.repeat` together; when `iso` is `null`, forces `repeat` to `null`; marks dirty.
  - `Core.advanceRepeat(task, dir)` — `dir` is `+1` (advance) or `-1` (roll back); no-op when `!task.repeat || !task.deadline`; shifts the deadline by one interval; never sets DONE / writes CLOSED; on advance reopens a DONE task to TODO; marks dirty.

- [ ] **Step 1: Write the failing test**

Append to `tests/repeat.test.mjs`:

```js
function repeating(state = 'NEXT') {
  const f = Core.parseOrg(`* ${state} Water plants\n  DEADLINE: <2026-08-01 Sat +1w>\n`);
  return f.tasks[0];
}

test('advanceRepeat advances one interval and keeps state', () => {
  const t = repeating('NEXT');
  Core.advanceRepeat(t, 1);
  assert.equal(t.deadline, '2026-08-08');
  assert.equal(t.state, 'NEXT');
  assert.equal(t.closed, null);
  assert.equal(t.dirty, true);
});

test('advanceRepeat roll-back is the exact inverse', () => {
  const t = repeating('NEXT');
  Core.advanceRepeat(t, 1);
  Core.advanceRepeat(t, -1);
  assert.equal(t.deadline, '2026-08-01');
});

test('advanceRepeat on a DONE repeat reopens to TODO without CLOSED', () => {
  const t = repeating('DONE');
  Core.advanceRepeat(t, 1);
  assert.equal(t.state, 'TODO');
  assert.equal(t.closed, null);
  assert.equal(t.deadline, '2026-08-08');
});

test('advanceRepeat is a no-op without a repeater or deadline', () => {
  const plain = Core.parseOrg('* TODO Plain\n  DEADLINE: <2026-08-01 Sat>\n').tasks[0];
  Core.advanceRepeat(plain, 1);
  assert.equal(plain.deadline, '2026-08-01');
  assert.equal(plain.dirty, false);
});

test('setDeadline carries repeat; clearing the date clears repeat', () => {
  const t = repeating('NEXT');
  Core.setDeadline(t, '2026-09-01', '+2d');
  assert.equal(t.deadline, '2026-09-01');
  assert.equal(t.repeat, '+2d');
  Core.setDeadline(t, null);
  assert.equal(t.deadline, null);
  assert.equal(t.repeat, null);
});

test('bumpDeadline preserves an existing repeater', () => {
  const t = repeating('NEXT');
  Core.bumpDeadline(t, 1, '2026-07-25');
  assert.equal(t.deadline, '2026-08-02');
  assert.equal(t.repeat, '+1w');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/repeat.test.mjs`
Expected: FAIL — `Core.advanceRepeat is not a function`; `setDeadline` ignores repeat.

- [ ] **Step 3: Write minimal implementation**

`setDeadline` (line 339) — replace:

```js
  function setDeadline(t, iso) { t.deadline = iso; touch(t); }
```

with:

```js
  function setDeadline(t, iso, repeat = null) { t.deadline = iso; t.repeat = iso ? repeat : null; touch(t); }
```

`bumpDeadline` (line 340–342) — preserve the repeater:

```js
  function bumpDeadline(t, delta, today) {
    setDeadline(t, t.deadline ? addDays(t.deadline, delta) : today, t.repeat);
  }
```

Add `advanceRepeat` after `setState` (after line 335):

```js
  function advanceRepeat(t, dir) {
    if (!t.repeat || !t.deadline) return;
    const next = addInterval(t.deadline, dir, t.repeat);
    if (!next) return;
    t.deadline = next;
    if (dir === 1 && t.state === 'DONE') t.state = 'TODO';
    t.closed = null;
    touch(t);
  }
```

Export both (line 590) — `setDeadline` is already exported; add `advanceRepeat`:

```js
           renderTask, serializeFile, setState, setPriority, setTitle, setTags, setDeadline, advanceRepeat, bumpDeadline,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/repeat.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS. (Existing single-arg `Core.setDeadline(x, iso)` callers in APP now pass `repeat = null` — correct, they have no repeat yet; verified fully in Task 5.)

- [ ] **Step 6: Commit**

```bash
git add index.html tests/repeat.test.mjs
git commit -m "feat: advanceRepeat mutation + repeat-aware setDeadline/bumpDeadline"
```

---

### Task 4: Quick-add `+1w` token and `makeTask` (CORE)

Recognize a bare `+1w` token in quick-add and the `e` heading editor grammar, attaching it only when a deadline is also present.

**Files:**
- Modify: `index.html` — `parseQuickAdd` `out` literal + token loop (line 426–438), `makeTask` literal (line 360–363).
- Modify: `tests/repeat.test.mjs`.

**Interfaces:**
- Consumes: existing `parseQuickAdd`, `makeTask`, `parseDateToken`.
- Produces: `parseQuickAdd(...)` result now includes `repeat` (`+1w` or `null`), set only when `deadline` is also present. `makeTask(fields, todayIso)` sets `t.repeat = fields.repeat || null`.

- [ ] **Step 1: Write the failing test**

Append to `tests/repeat.test.mjs`:

```js
test('parseQuickAdd reads +1w when a deadline is present', () => {
  const p = Core.parseQuickAdd('Water plants @2026-08-01 +1w', '2026-07-25');
  assert.equal(p.deadline, '2026-08-01');
  assert.equal(p.repeat, '+1w');
  assert.equal(p.title, 'Water plants');
});

test('parseQuickAdd drops +1w when there is no deadline', () => {
  const p = Core.parseQuickAdd('Water plants +1w', '2026-07-25');
  assert.equal(p.deadline, null);
  assert.equal(p.repeat, null);
});

test('parseQuickAdd token order is independent', () => {
  const p = Core.parseQuickAdd('+2d @fri Buy milk', '2026-07-25'); // fri = 2026-07-31
  assert.equal(p.repeat, '+2d');
  assert.equal(p.title, 'Buy milk');
});

test('makeTask stores a repeater', () => {
  const t = Core.makeTask({ title: 'Water', deadline: '2026-08-01', repeat: '+1w' }, '2026-07-25');
  assert.equal(t.repeat, '+1w');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/repeat.test.mjs`
Expected: FAIL — `p.repeat` is `undefined`; `makeTask` result has no `repeat`.

- [ ] **Step 3: Write minimal implementation**

`parseQuickAdd` (line 426) — add `repeat: null` to `out`:

```js
    const out = { topic: null, title: '', priority: null, tags: [], deadline: null, repeat: null, effort: null };
```

Add a token branch in the loop (after the `@`-date branch, line 434):

```js
      else if ((m = w.match(/^\+\d+[dwmy]$/))) out.repeat = w;
```

After the loop, before `return out` (after line 438) — drop a dangling repeater:

```js
    if (!out.deadline) out.repeat = null;
```

`makeTask` literal (line 360–363) — add `repeat`:

```js
    const t = { raw: '', dirty: true, level: 1, children: [], state: 'TODO', priority: fields.priority || null,
                title: fields.title, tags: fields.tags || [], deadline: fields.deadline || null,
                repeat: fields.repeat || null, closed: null, scheduledRaw: null, propLines: [], body: [],
                added: todayIso, effort: null };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/repeat.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS (existing quick-add tests unaffected — they assert specific fields, and `repeat` is additive).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/repeat.test.mjs
git commit -m "feat: +1w quick-add/heading token and makeTask repeat field"
```

---

### Task 5: APP wiring — keys, editors, chip, help, e2e

Wire the CORE pieces into the UI: `d` advances a repeat, `D` rolls it back, the `s` and `e` editors read/write the cookie, a `🔁` chip renders, and the help overlay documents it. This is the only APP-facing task.

**Files:**
- Modify: `index.html` — `d` key handler (line 1671–1673), add a `D` branch beside it, `s` editor (line 1680–1689), `e` editor prefill + save (line 1739–1755), deadline chip block (line 928–932), the `?` help table (near the `s`/`>`/`<` rows, ~line 154–168).
- Modify: `tests/ui-e2e.mjs` — add assertions after the existing deadline-editor block (~line 238).

**Interfaces:**
- Consumes: `Core.advanceRepeat`, `Core.setDeadline(t, iso, repeat)`, `Core.parseQuickAdd` (now with `repeat`), `Core.parseDateToken`. Existing `withSel`, `mutateTask`, `selRef`, `keyPath`, `inlineEdit`, `toast`, `todayIso`.
- Produces: no new exported symbols; behavior only.

- [ ] **Step 1: Wire the `d` and `D` keys**

Replace the `d` handler (line 1671–1673):

```js
  if (k === 'd') return withSel(t => t.state === 'DONE'
      ? Core.setState(t, 'TODO')
      : Core.setState(t, 'DONE', { iso: todayIso(), hm: nowHm() }));
```

with (repeat takes precedence; plain tasks keep the toggle):

```js
  if (k === 'd') return withSel(t => t.repeat
      ? Core.advanceRepeat(t, 1)
      : (t.state === 'DONE'
          ? Core.setState(t, 'TODO')
          : Core.setState(t, 'DONE', { iso: todayIso(), hm: nowHm() })));
  if (k === 'D') {
    const r = selRef();
    if (r && !r.task.repeat) { toast('Not a repeating task'); return; }
    return withSel(t => Core.advanceRepeat(t, -1));
  }
```

- [ ] **Step 2: Wire the `s` deadline editor to read/write the cookie**

Replace the `s` editor body (line 1682–1687) so the prefill includes the repeater and the input is split into date + optional cookie:

```js
    if (r) inlineEdit((r.task.deadline || '') + (r.task.repeat ? ' ' + r.task.repeat : ''),
        'deadline: 2026-08-01 / fri / tom [+1w] — empty clears', async v => {
      let s = v.trim(), repeat = null;
      const rm = s.match(/\s*(\+\d+[dwmy])$/);
      if (rm) { repeat = rm[1]; s = s.slice(0, rm.index).trim(); }
      const iso = s ? Core.parseDateToken(s, todayIso()) : null;
      if (s && !iso) { toast('Unrecognized date: ' + s); return; }
      if (repeat && !iso) { toast('A repeater needs a date'); return; }
      await mutateTask(r.topic, keyPath(r), t => Core.setDeadline(t, iso, repeat));
    });
```

- [ ] **Step 3: Wire the `e` heading editor prefill + save**

In the `e` handler, add the repeater to the prefill line (line 1739–1743) — insert after the `@date` entry:

```js
      const cur = [t.title,
                   t.priority && '#' + t.priority,
                   ...t.tags.map(x => ':' + x + ':'),
                   t.deadline && '@' + t.deadline,
                   t.repeat,
                   t.effort && '~' + t.effort].filter(Boolean).join(' ');
```

Update the save call (line 1753) to pass the parsed repeat:

```js
          Core.setDeadline(x, p.deadline, p.repeat);
```

- [ ] **Step 4: Render the recurrence chip**

After the deadline chip block (after line 932), add:

```js
  if (t.repeat) {
    const rc = span('chip rpt');
    rc.textContent = '🔁 ' + t.repeat.slice(1);
    meta.append(rc);
  }
```

- [ ] **Step 5: Update the `?` help overlay**

In the help table, update the `d`/`s` rows and add a `D` row. Change the existing `d` row to note repeat behavior and add beneath the deadline rows:

```html
<tr><td><kbd>d</kbd></td><td>toggle DONE — or, on a repeating task, advance its deadline one interval</td></tr>
<tr><td><kbd>D</kbd></td><td>roll a repeating task's deadline back one interval (undo)</td></tr>
```

And where date-token examples are listed (the quick-add / heading token help), add a note that `+1w` / `+2d` / `+3m` / `+1y` on a deadline makes the task repeat.

- [ ] **Step 6: Add e2e assertions**

In `tests/ui-e2e.mjs`, after the deadline-editor block (after line 238), add a repeating-task scenario. Select a task, set a repeating deadline via `s`, press `d` to advance, `D` to roll back:

```js
// --- repeating task: s sets a repeater, d advances, D rolls back ---
await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Garage cleanup');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
})()`);
await key('s', 'KeyS', 's', 83);
await sleep(250);
await evaljs(`(() => { document.querySelector('.editor input').value = '2026-08-01 +1w'; })()`);
await key('Enter', 'Enter', '\r', 13);
await sleep(500);
const repSet = await evaljs(`__files.get('home.org')`);
check('s writes a repeating deadline', repSet.includes('DEADLINE: <2026-08-01 Sat +1w>'), repSet);

await key('d', 'KeyD', 'd', 68);
await sleep(500);
const repAdv = await evaljs(`__files.get('home.org')`);
check('d advances a repeat one interval (no DONE)',
      repAdv.includes('DEADLINE: <2026-08-08 Sat +1w>') &&
      repAdv.split('* TODO Garage cleanup')[1] !== undefined, repAdv);

await key('D', 'KeyD', 'D', 68, 8); // 8 = Shift modifier
await sleep(500);
const repBack = await evaljs(`__files.get('home.org')`);
check('D rolls the repeat back one interval', repBack.includes('DEADLINE: <2026-08-01 Sat +1w>'), repBack);

// clear it so it doesn't leak into later checks
await key('s', 'KeyS', 's', 83);
await sleep(250);
await evaljs(`(() => { document.querySelector('.editor input').value = ''; })()`);
await key('Enter', 'Enter', '\r', 13);
await sleep(500);
```

Note: confirm the `key(k, code, text, vk, modifiers)` helper signature at line ~70 passes `modifiers` through to `Input.dispatchKeyEvent`; if the existing calls omit it, the 5th arg defaults are fine and Shift=8 is the CDP modifier bit. If `Garage cleanup` renders as `NEXT`/reordered after advancing (it gains a near deadline → radar), match on title only as shown rather than on a specific state.

- [ ] **Step 7: Run unit tests + e2e**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS (all suites, including `repeat.test.mjs`).

Run: `node tests/ui-e2e.mjs`
Expected: PASS — including the three new repeating-task checks.

- [ ] **Step 8: Manual smoke check**

Open `index.html` in Chrome, connect `sample-tasks/`. On a task: press `s`, enter `fri +1w`, confirm the `🔁 1w` chip and `⏰` chip appear. Press `d` → deadline jumps a week, task stays open (not struck through). Press `D` → deadline returns. Press `e` → confirm the line shows `+1w`; delete it, save → chip gone. Press `d` → now archives as DONE.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: repeating tasks UI — d advances, D rolls back, s/e edit, chip, help"
```

---

## Self-Review

**Spec coverage:**
- Storage `t.repeat` + parse/serialize → Task 2. ✓
- `addInterval` day/week/month/year + clamp → Task 1. ✓
- `advanceRepeat` (advance/roll-back, reopen DONE, no-op guards) → Task 3. ✓
- `setDeadline(iso, repeat)` + `bumpDeadline` preserve → Task 3. ✓
- Quick-add / `e` token, `makeTask` → Task 4 (CORE) + Task 5 (editor plumbing). ✓
- `s` editor WYSIWYG over date + cookie → Task 5. ✓
- `d` / `D` keys → Task 5. ✓
- `🔁` chip → Task 5. ✓
- Help text → Task 5. ✓
- Finish-permanently (clear repeat then `d`) → no code; covered by `d` precedence in Task 5 + `e`/`s` clearing. Smoke-checked in Task 5 Step 8. ✓
- No logging / plain `+` only / no SCHEDULED → nothing to build (non-goals). ✓
- Round-trip invariant → Task 2 test + full-suite runs in Tasks 2–5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows exact code and commands.

**Type consistency:** `t.repeat` is `+1w`-form (leading `+`) everywhere — stored by `setDeadline`/`parsePlanning`/`makeTask`, consumed by `advanceRepeat`/`orgActive`/`addInterval` (all expect the `+`), displayed with `.slice(1)`. `advanceRepeat(t, dir)` two-arg signature is consistent across Task 3 and Task 5. `setDeadline(t, iso, repeat)` three-arg form consistent across Tasks 3 and 5. `parseQuickAdd` `repeat` field consistent across Task 4 and the `e` editor in Task 5.
