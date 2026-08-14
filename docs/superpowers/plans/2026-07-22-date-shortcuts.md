# Date Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a numeric month-day date token (`@07-30`), a `@tom` alias for tomorrow, and `>` / `<` keys that move the selected task's deadline by ±1 day.

**Architecture:** All token parsing extends `Core.parseDateToken` inside the CORE IIFE of `index.html`, so quick-add, the `s` deadline editor, and the `e` heading editor pick the new forms up for free. The deadline move is a new exported CORE helper `Core.bumpDeadline(task, delta, today)`; APP wires it to two one-line `keydown` branches via the existing `withSel` wrapper.

**Tech Stack:** Vanilla JS in a single `index.html` (no build, no deps), `node --test` unit tests, CDP-driven Chrome e2e script.

**Spec:** `docs/superpowers/specs/2026-07-22-date-shortcuts-design.md`

## Global Constraints

- CORE (between `// ===== CORE START =====` and `// ===== CORE END =====`) must never touch `document`/`window`; new CORE functions must be exported through the IIFE's `return {...}` and covered by unit tests.
- Do not alter the marker comments — tooling greps for them.
- Round-trip invariant: `Core.serializeFile(Core.parseOrg(text)) === text` when nothing was edited. `bumpDeadline` must mutate only via the existing `setDeadline` (which calls `touch`).
- Unit tests: `node --test 'tests/*.test.mjs'` (the bare directory form does NOT work). E2E: `node tests/ui-e2e.mjs` (needs Google Chrome).
- Numeric token separator is `-` only; no `@+N` tokens; no week jumps; deadline only (no SCHEDULED).

---

### Task 1: `parseDateToken`: numeric month-day token and `tom` alias

**Files:**
- Modify: `index.html:169-186` (`parseDateToken` in CORE)
- Test: `tests/parser.test.mjs` (extend the existing `parseDateToken forms` test at line 16)

**Interfaces:**
- Consumes: existing `pad`, `addDays`, `MONTHS` internals of CORE.
- Produces: `Core.parseDateToken(tok, today)` additionally accepts `'tom'` (→ tomorrow) and `'M-D'`/`'MM-DD'` (→ ISO date in the current year, or next year if strictly before `today`; `null` if the month/day combination doesn't exist in the resolved year). No signature change; already exported.

- [ ] **Step 1: Write the failing tests**

In `tests/parser.test.mjs`, extend the existing test block (after line 24, before the `nonsense` assertion):

```js
  assert.equal(Core.parseDateToken('tom', T), '2026-07-19');       // alias for tomorrow
  assert.equal(Core.parseDateToken('07-30', T), '2026-07-30');
  assert.equal(Core.parseDateToken('7-30', T), '2026-07-30');      // 1-digit month
  assert.equal(Core.parseDateToken('12-1', T), '2026-12-01');      // 1-digit day
  assert.equal(Core.parseDateToken('07-18', T), '2026-07-18');     // equal to today stays this year
  assert.equal(Core.parseDateToken('01-05', T), '2027-01-05');     // past this year -> next year
  assert.equal(Core.parseDateToken('13-05', T), null);             // no such month
  assert.equal(Core.parseDateToken('02-30', T), null);             // no such day
  assert.equal(Core.parseDateToken('0-5', T), null);               // months are 1-based
  assert.equal(Core.parseDateToken('2-29', T), null);              // resolves to 2027: not a leap year
  assert.equal(Core.parseDateToken('2-29', '2028-01-01'), '2028-02-29'); // leap year: valid
```

Note the leap-year rule: validity is checked against the *resolved* year — `2-29` typed when today is `2026-07-18` resolves to 2027 (past this year), and 2027 is not a leap year, so it is `null`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/parser.test.mjs`
Expected: FAIL — `parseDateToken forms` asserts `'tom'` returns `'2026-07-19'` but gets `null`.

- [ ] **Step 3: Implement in `parseDateToken`**

In `index.html`, change the `tomorrow` line (173) to:

```js
    if (tok === 'tomorrow' || tok === 'tom') return addDays(today, 1);
```

and add the numeric branch after the existing month-name branch (after line 184, before `return null;`):

```js
    const n = tok.match(/^(\d{1,2})-(\d{1,2})$/);
    if (n) {
      const y = +today.slice(0, 4);
      const first = y + '-' + pad(+n[1]) + '-' + pad(+n[2]);
      const iso = first < today ? (y + 1) + first.slice(4) : first;
      const d = new Date(iso + 'T12:00:00Z');
      return d.getUTCMonth() + 1 === +n[1] && d.getUTCDate() === +n[2] ? iso : null;
    }
```

Why the round-trip check works: an out-of-range ISO string (`2026-02-30`, `2026-13-05`, month `00`) makes `new Date(...)` an Invalid Date, so `getUTCMonth()` is `NaN` and the comparison fails; an in-range date reproduces its own month and day. No conflict with other tokens: nothing else starts with 1–2 digits (`YYYY-MM-DD` requires a 4-digit year).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: all PASS (the full suite, not just parser — guards against regressions in quick-add, which routes `@...` words through `parseDateToken`).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/parser.test.mjs
git commit -m 'feat: date tokens @M-D (numeric month-day) and @tom (tomorrow alias)'
```

---

### Task 2: `Core.bumpDeadline(task, delta, today)`

**Files:**
- Modify: `index.html:291` area (CORE mutation helpers, next to `setDeadline`) and the IIFE export list at `index.html:454-458`
- Test: `tests/parser.test.mjs` (new test block at the end)

**Interfaces:**
- Consumes: CORE-internal `setDeadline(t, iso)` and `addDays(iso, n)`.
- Produces: `Core.bumpDeadline(task, delta, today)` — `task` is a parsed task object, `delta` an integer day count, `today` an ISO `YYYY-MM-DD` string. If `task.deadline` is set, shifts it by `delta` days; otherwise sets it to `today` regardless of `delta`'s sign. Always marks the task dirty (via `setDeadline` → `touch`). Returns nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/parser.test.mjs`:

```js
test('bumpDeadline shifts an existing deadline and seeds today when absent', () => {
  const f = Core.parseOrg('* TODO Pay bill\n  DEADLINE: <2026-07-31 Fri>\n');
  const t = f.tasks[0];
  Core.bumpDeadline(t, 1, '2026-07-18');
  assert.equal(t.deadline, '2026-08-01');            // crosses month boundary
  assert.equal(t.dirty, true);                        // parseOrg starts clean; bump dirties
  Core.bumpDeadline(t, -1, '2026-07-18');
  assert.equal(t.deadline, '2026-07-31');

  const plus = Core.parseOrg('* TODO Bare\n').tasks[0];
  Core.bumpDeadline(plus, 1, '2026-07-18');
  assert.equal(plus.deadline, '2026-07-18');          // no deadline: > starts at today
  const minus = Core.parseOrg('* TODO Bare\n').tasks[0];
  Core.bumpDeadline(minus, -1, '2026-07-18');
  assert.equal(minus.deadline, '2026-07-18');         // no deadline: < also starts at today
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/parser.test.mjs`
Expected: FAIL with `Core.bumpDeadline is not a function`.

- [ ] **Step 3: Implement**

In `index.html`, directly under `setDeadline` (line 291):

```js
  function bumpDeadline(t, delta, today) {
    setDeadline(t, t.deadline ? addDays(t.deadline, delta) : today);
  }
```

Add `bumpDeadline` to the IIFE's export list (line 455, after `setDeadline`):

```js
           renderTask, serializeFile, setState, setPriority, setTitle, setTags, setDeadline, bumpDeadline,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/parser.test.mjs
git commit -m 'feat: Core.bumpDeadline — shift a deadline by N days, seeding today when absent'
```

---

### Task 3: APP wiring (`>` / `<`), UI text, and e2e coverage

**Files:**
- Modify: `index.html` — main `keydown` handler (insert before the `if (k === 's')` branch at line 1340), the `s` editor placeholder (line 1343), the help-overlay token example (line 108) and shortcut table (after line 135)
- Test: `tests/ui-e2e.mjs` (insert after the deadline-editor round-trip check at line 211)

**Interfaces:**
- Consumes: `Core.bumpDeadline` from Task 2; `Core.parseDateToken` behavior from Task 1 (placeholder/help text mention the new tokens); APP globals `withSel(fn)` and `todayIso()`.
- Produces: user-facing behavior only; nothing downstream consumes this.

- [ ] **Step 1: Add the failing e2e checks**

In `tests/ui-e2e.mjs`, insert after line 211 (`check('deadline editor writes DEADLINE line', ...)`), while the selected task's deadline is the just-written `2026-08-01`:

```js
// --- >/< move the deadline; > on a bare task starts at today ---
await key('>', 'Period', '>', 190);
await sleep(500);
const afterGt = await evaljs(`__files.get('home.org')`);
check('> moves the deadline one day later', afterGt.includes('DEADLINE: <2026-08-02 Sun>'), afterGt);
await key('<', 'Comma', '<', 188);
await sleep(500);
const afterLt = await evaljs(`__files.get('home.org')`);
check('< moves it back', afterLt.includes('DEADLINE: <2026-08-01 Sat>'), afterLt);
await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Garage cleanup');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
})()`);
await key('>', 'Period', '>', 190);
await sleep(500);
const bare = await evaljs(`({ file: __files.get('home.org'), today: todayIso() })`);
check('> on a task without a deadline sets today', bare.file.includes('DEADLINE: <' + bare.today), bare.file);
// clear it again so Garage cleanup doesn't leak onto the radar for later checks
await key('s', 'KeyS', 's', 83);
await sleep(250);
await evaljs(`(() => { document.querySelector('.editor input').value = ''; })()`);
await key('Enter', 'Enter', '\r', 13);
await sleep(500);
const cleared = await evaljs(`__files.get('home.org')`);
check('empty deadline editor clears it back off Garage cleanup',
      !cleared.split('* TODO Garage cleanup')[1].includes('DEADLINE'), cleared);
```

The `>`/`<` pair restores the file to its prior state, and the trailing clear removes the deadline seeded onto `Garage cleanup`, so every later assertion in the script sees exactly the state it saw before this insertion.

- [ ] **Step 2: Run the e2e to verify the new checks fail**

Run: `node tests/ui-e2e.mjs`
Expected: `FAIL > moves the deadline one day later` (the key is currently unbound); all pre-existing checks still `ok`.

- [ ] **Step 3: Implement the APP changes**

1. In the main `keydown` handler, insert immediately before `if (k === 's') {` (line 1340):

```js
  if (k === '>') return withSel(t => Core.bumpDeadline(t, 1, todayIso()));
  if (k === '<') return withSel(t => Core.bumpDeadline(t, -1, todayIso()));
```

(No `preventDefault` needed — these don't focus an input, matching the `n`/`d`/priority branches.)

2. Update the `s` editor placeholder (line 1343):

```js
    if (r) inlineEdit(r.task.deadline || '', 'deadline: 2026-07-22 / jul22 / 7-30 / fri / tom — empty clears', async v => {
```

3. Help overlay, token example (line 108):

```html
<tr><td><code>@2026-07-22 @jul22 @07-30 @tom @fri</code></td><td>deadline</td></tr>
```

4. Help overlay, shortcut table — insert after the `s` row (line 135):

```html
<tr><td><kbd>&gt;</kbd> / <kbd>&lt;</kbd></td><td>move deadline +1 / −1 day</td></tr>
```

- [ ] **Step 4: Run both suites to verify everything passes**

Run: `node --test 'tests/*.test.mjs'`
Expected: all PASS.
Run: `node tests/ui-e2e.mjs`
Expected: every line `ok`, including the four new checks; exit code 0.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m 'feat: >/< move the selected task deadline; help + placeholder mention @tom and @M-D'
```
