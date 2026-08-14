# Org-backed Todo Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-file HTML todo app backed by org-mode files on local disk, with two-way sync via the File System Access API.

**Architecture:** Everything ships in one `index.html`. Inside its `<script>`, a marked **CORE** section holds pure logic (org parser/serializer, quick-add token parser, view model) with zero DOM/browser dependencies; the **APP** section below it does DOM, file access, and polling. A Node test harness extracts the CORE section from `index.html` with a regex and evaluates it in a `vm` context, so core logic is TDD-able while the app stays a single file.

**Tech Stack:** Vanilla JS/CSS/HTML (no dependencies, no build). File System Access API (Chromium). Node ≥ 18 built-in test runner (`node --test`) for dev-only tests.

**Spec:** `docs/superpowers/specs/2026-07-18-org-todo-page-design.md`

## Global Constraints

- The app is exactly one file, `index.html` — all CSS/JS inline, zero runtime dependencies, no build step.
- Data files are real org-mode syntax, Emacs-compatible: `* STATE [#P] Title :tags:`, `DEADLINE: <YYYY-MM-DD Day>`, `:PROPERTIES:` drawer with `:Effort:` and `:ADDED:`, `CLOSED: [timestamp]`.
- States are exactly `TODO`, `NEXT`, `DONE`. Priorities are exactly `A`, `B`, `C`, or none.
- Round-trip guarantee: `serializeFile(parseOrg(text)) === text` byte-for-byte when nothing was edited; edits rewrite only the edited heading block.
- Radar = all `NEXT` tasks + any non-DONE task with a deadline within the next **7** days.
- Tests run with `node --test 'tests/*.test.mjs'` (Node ≥ 18, dev-only; `tests/` is not part of the shipped app).
- Commit after every task. This repo has `commit.gpgsign=false` set locally — plain `git commit` works.
- All work happens on `main` in this fresh repo (no worktree needed unless the executor's process requires one).

## File Structure

```
index.html                      — the app (created Task 1, grown in every task)
tests/harness.mjs               — extracts CORE from index.html, exports Core (Task 1)
tests/smoke.test.mjs            — harness works (Task 1)
tests/fixtures.mjs              — shared org sample text (Task 2)
tests/parser.test.mjs           — dates + org parser (Task 2)
tests/serializer.test.mjs       — round-trip + mutations (Task 3)
tests/quickadd.test.mjs         — quick-add token parser (Task 4)
tests/model.test.mjs            — radar/backlog/filters (Task 5)
sample-tasks/work.org           — manual-testing fixture (Task 6)
sample-tasks/home.org           — manual-testing fixture (Task 6)
README.md                       — usage + smoke checklist (Task 14)
```

Inside `index.html`'s script, section markers (exact strings, the harness greps for them):

```
// ===== CORE START =====
const Core = (() => { ... return {...}; })();
// ===== CORE END =====
// ===== APP =====
... DOM / file access / events ...
```

**Known accepted limitations** (documented here so implementers don't "fix" them): tasks are identified in the UI by their heading line, so two tasks with byte-identical headings in the same file are indistinguishable (mutations hit the first); drag-and-drop reordering works within one topic only; CRLF line endings are not supported (org files are LF); reordering swaps positions in the *file*, which is only visible in the UI when both tasks are in the same visual section.

---

### Task 1: Scaffold — index.html skeleton, test harness, smoke test

**Files:**
- Create: `index.html`
- Create: `tests/harness.mjs`
- Test: `tests/smoke.test.mjs`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `index.html` with all CSS classes and DOM ids used by later tasks; `tests/harness.mjs` exporting `Core` (the object returned by the CORE IIFE). Later tasks insert functions inside the `Core` IIFE and add them to its `return {...}`.

- [ ] **Step 1: Create `index.html`**

The complete file. All CSS for every later task is defined here so UI tasks only add JS/markup.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Org Todo</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { --bg:#fafafa; --fg:#1a1a1a; --muted:#777; --line:#e4e4e4; --sel:#dbeafe; --accent:#2563eb; }
* { box-sizing: border-box; }
body { margin:0; font:14px/1.45 system-ui, sans-serif; background:var(--bg); color:var(--fg); }
header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid var(--line); padding:10px 16px; z-index:2; }
#quickadd { width:100%; font:inherit; padding:8px 10px; border:1px solid var(--line); border-radius:8px; }
#hint { font:12px/1.4 ui-monospace, monospace; color:var(--muted); min-height:16px; margin-top:4px; }
#filterbar { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-top:6px; }
#search { font:inherit; padding:4px 8px; border:1px solid var(--line); border-radius:6px; width:160px; }
main { max-width:860px; margin:0 auto; padding:12px 16px 80px; }
h2 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); border-bottom:1px solid var(--line); padding-bottom:4px; margin:18px 0 6px; }
h3 { font-size:13px; color:var(--muted); margin:10px 0 2px; }
.task { display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:8px; cursor:default; flex-wrap:wrap; }
.task.sel { background:var(--sel); outline:1px solid var(--accent); }
.pri { width:20px; height:20px; border-radius:6px; font:bold 12px/20px system-ui; text-align:center; color:#fff; flex:none; }
.pri-A { background:#dc2626; } .pri-B { background:#d97706; } .pri-C { background:#9ca3af; }
.pri-none { background:transparent; color:var(--muted); }
.title { flex:1 1 auto; min-width:200px; }
.st-DONE .title { text-decoration:line-through; color:var(--muted); }
.st-NEXT .title { font-weight:600; }
.meta { display:flex; gap:4px; align-items:center; flex-wrap:wrap; }
.chip { font-size:11px; padding:1px 7px; border-radius:999px; background:#eee; color:#444; border:none; cursor:pointer; font-family:inherit; }
.chip.topic { background:#e0e7ff; }
.chip.dl-overdue { background:#dc2626; color:#fff; }
.chip.dl-today { background:#ea580c; color:#fff; }
.chip.dl-week { background:#f59e0b; color:#fff; }
.chip.on { background:var(--accent); color:#fff; }
.body { flex-basis:100%; margin:2px 0 4px 28px; color:#333; }
.body img { max-width:100%; border:1px solid var(--line); border-radius:6px; display:block; margin:4px 0; }
.bline { white-space:pre-wrap; font-size:13px; }
.editor input { width:100%; font:inherit; padding:6px 8px; border:1px solid var(--accent); border-radius:6px; }
#banner { background:#fef3c7; border:1px solid #f59e0b; margin:12px 16px; padding:10px 12px; border-radius:8px; }
#banner button { margin-left:8px; }
#toast { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); background:#111; color:#fff; padding:8px 14px; border-radius:8px; z-index:9; }
#help { position:fixed; inset:10% 20%; overflow:auto; background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,.15); padding:20px 24px; z-index:8; }
#help kbd { background:#eee; border-radius:4px; padding:1px 6px; font:12px ui-monospace, monospace; }
#help td { padding:2px 10px 2px 0; }
#done-toggle { cursor:pointer; }
[hidden] { display:none !important; }
</style>
</head>
<body>
<header id="topbar">
  <input id="quickadd" placeholder="+ add task…   work: Title #A :tag: @fri ~2h" autocomplete="off">
  <div id="hint"></div>
  <div id="filterbar"></div>
</header>
<div id="banner" hidden></div>
<main>
  <section id="radar"><h2>On the radar</h2><div id="radar-list"></div></section>
  <section id="backlog"><h2>Backlog</h2><div id="backlog-list"></div></section>
  <section id="done"><h2 id="done-toggle">Done (<span id="done-count">0</span>)</h2><div id="done-list" hidden></div></section>
</main>
<div id="help" hidden></div>
<div id="toast" hidden></div>
<script>
// ===== CORE START =====
const Core = (() => {

  return { version: 1 };
})();
// ===== CORE END =====
// ===== APP =====
// (app code added in later tasks)
</script>
</body>
</html>
```

- [ ] **Step 2: Create `tests/harness.mjs`**

```js
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/\/\/ ===== CORE START =====([\s\S]*?)\/\/ ===== CORE END =====/);
if (!m) throw new Error('CORE section not found in index.html');
// Evaluate in the main realm (not vm) so arrays/objects share prototypes with
// the test file — deepStrictEqual compares prototypes across realms otherwise.
export const Core = new Function(m[1] + '\nreturn Core;')();
```

- [ ] **Step 3: Write the smoke test `tests/smoke.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

test('Core is extracted from index.html', () => {
  assert.equal(typeof Core, 'object');
  assert.equal(Core.version, 1);
});
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: `pass 1`, `fail 0`

- [ ] **Step 5: Commit**

```bash
git add index.html tests/
git commit -m "feat: scaffold single-file app shell and Node test harness"
```

---

### Task 2: Core dates + org parser

**Files:**
- Modify: `index.html` (inside the Core IIFE)
- Create: `tests/fixtures.mjs`
- Test: `tests/parser.test.mjs`

**Interfaces:**
- Consumes: `Core` IIFE + harness from Task 1
- Produces (all on `Core`):
  - `dayName(iso) -> 'Mon'…'Sun'`, `addDays(iso, n) -> iso`, `orgActive(iso) -> '<iso Day>'`, `orgInactive(iso) -> '[iso Day]'`
  - `parseDateToken(tok, todayIso) -> iso | null` — accepts `YYYY-MM-DD`, `today`, `tomorrow`, weekday names/3-letter prefixes (next occurrence, never today), `jul22`-style month+day (rolls to next year if past)
  - `parseOrg(text) -> file` where `file = { preamble: string, tasks: Task[] }` and `Task = { raw, dirty, state: 'TODO'|'NEXT'|'DONE'|null, priority: 'A'|'B'|'C'|null, title, tags: string[], deadline: iso|null, closed: string|null, scheduledRaw: string|null, propLines: string[], body: string[], added: iso|null, effort: string|null }`

- [ ] **Step 1: Create `tests/fixtures.mjs`**

```js
export const SAMPLE = `#+TITLE: Work

* NEXT [#A] Ship quarterly report :work:urgent:
  DEADLINE: <2026-07-22 Wed>
  :PROPERTIES:
  :Effort:   3h
  :ADDED:    [2026-07-18 Sat]
  :END:
  Notes about the task.
  [[file:images/mockup.png]]
* TODO Plain task
* DONE [#C] Old thing :misc:
  CLOSED: [2026-07-10 Fri 09:15]
** Sub-heading stays in body
   body of sub
`;
```

- [ ] **Step 2: Write failing tests `tests/parser.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';
import { SAMPLE } from './fixtures.mjs';

test('addDays crosses month boundary', () => {
  assert.equal(Core.addDays('2026-07-28', 7), '2026-08-04');
});

test('dayName and org timestamps', () => {
  assert.equal(Core.dayName('2026-07-18'), 'Sat');
  assert.equal(Core.orgActive('2026-07-22'), '<2026-07-22 Wed>');
  assert.equal(Core.orgInactive('2026-07-18'), '[2026-07-18 Sat]');
});

test('parseDateToken forms (today = 2026-07-18, a Saturday)', () => {
  const T = '2026-07-18';
  assert.equal(Core.parseDateToken('2026-07-22', T), '2026-07-22');
  assert.equal(Core.parseDateToken('today', T), '2026-07-18');
  assert.equal(Core.parseDateToken('tomorrow', T), '2026-07-19');
  assert.equal(Core.parseDateToken('fri', T), '2026-07-24');
  assert.equal(Core.parseDateToken('saturday', T), '2026-07-25'); // next, never today
  assert.equal(Core.parseDateToken('jul22', T), '2026-07-22');
  assert.equal(Core.parseDateToken('jan05', T), '2027-01-05');    // past this year -> next year
  assert.equal(Core.parseDateToken('nonsense', T), null);
});

test('parseOrg: preamble and block count', () => {
  const f = Core.parseOrg(SAMPLE);
  assert.equal(f.preamble, '#+TITLE: Work\n\n');
  assert.equal(f.tasks.length, 3);
});

test('parseOrg: heading and metadata fields', () => {
  const [a, b, c] = Core.parseOrg(SAMPLE).tasks;
  assert.equal(a.state, 'NEXT');
  assert.equal(a.priority, 'A');
  assert.equal(a.title, 'Ship quarterly report');
  assert.deepEqual(a.tags, ['work', 'urgent']);
  assert.equal(a.deadline, '2026-07-22');
  assert.equal(a.effort, '3h');
  assert.equal(a.added, '2026-07-18');
  assert.deepEqual(a.body, ['  Notes about the task.', '  [[file:images/mockup.png]]']);
  assert.equal(a.dirty, false);

  assert.equal(b.state, 'TODO');
  assert.equal(b.priority, null);
  assert.deepEqual(b.tags, []);
  assert.equal(b.title, 'Plain task');

  assert.equal(c.state, 'DONE');
  assert.equal(c.closed, '2026-07-10 Fri 09:15');
});

test('parseOrg: nested heading stays in parent body', () => {
  const c = Core.parseOrg(SAMPLE).tasks[2];
  assert.ok(c.body.includes('** Sub-heading stays in body'));
});

test('parseOrg: empty and preamble-only files', () => {
  assert.deepEqual(Core.parseOrg(''), { preamble: '', tasks: [] });
  assert.equal(Core.parseOrg('just notes\n').preamble, 'just notes\n');
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `node --test 'tests/*.test.mjs'`
Expected: parser tests FAIL (`Core.addDays is not a function` etc.); smoke test still passes.

- [ ] **Step 4: Implement in the Core IIFE**

Insert before the `return`:

```js
  // --- dates ---
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const WEEKDAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const pad = n => String(n).padStart(2, '0');

  function dayName(iso) { return DAYS[new Date(iso + 'T12:00:00Z').getUTCDay()]; }
  function addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function orgActive(iso) { return '<' + iso + ' ' + dayName(iso) + '>'; }
  function orgInactive(iso) { return '[' + iso + ' ' + dayName(iso) + ']'; }

  function parseDateToken(tok, today) {
    tok = tok.toLowerCase();
    if (/^\d{4}-\d{2}-\d{2}$/.test(tok)) return tok;
    if (tok === 'today') return today;
    if (tok === 'tomorrow') return addDays(today, 1);
    const wi = WEEKDAYS.findIndex(w => w === tok || w.slice(0, 3) === tok);
    if (wi >= 0) {
      const delta = (wi - new Date(today + 'T12:00:00Z').getUTCDay() + 7) % 7;
      return addDays(today, delta === 0 ? 7 : delta);
    }
    const m = tok.match(/^([a-z]{3})(\d{1,2})$/);
    if (m && MONTHS.includes(m[1])) {
      const y = +today.slice(0, 4);
      const iso = y + '-' + pad(MONTHS.indexOf(m[1]) + 1) + '-' + pad(+m[2]);
      return iso < today ? (y + 1) + iso.slice(4) : iso;
    }
    return null;
  }

  // --- org parser ---
  const HEADING_RE = /^\*\s+(?:(TODO|NEXT|DONE)\s+)?(?:\[#([ABC])\]\s+)?(.*)$/;
  const TAGS_RE = /\s+(:[A-Za-z0-9_@#%:]+:)\s*$/;
  const PLANNING_RE = /^\s*(?:DEADLINE|SCHEDULED|CLOSED):/;

  function parseHeading(line) {
    const m = line.match(HEADING_RE);
    let title = m[3] || '';
    let tags = [];
    const tm = title.match(TAGS_RE);
    if (tm) { tags = tm[1].slice(1, -1).split(':'); title = title.slice(0, tm.index); }
    return { state: m[1] || null, priority: m[2] || null, title: title.trim(), tags };
  }

  function parsePlanning(line, t) {
    const dm = line.match(/DEADLINE:\s*<(\d{4}-\d{2}-\d{2})[^>]*>/);
    if (dm) t.deadline = dm[1];
    const cm = line.match(/CLOSED:\s*\[([^\]]+)\]/);
    if (cm) t.closed = cm[1];
    const sm = line.match(/SCHEDULED:\s*[<\[][^>\]]+[>\]]/);
    if (sm) t.scheduledRaw = sm[0].trim();
  }

  function parseTaskBlock(raw) {
    const lines = raw.replace(/\n$/, '').split('\n');
    const h = parseHeading(lines[0]);
    const t = { raw, dirty: false, state: h.state, priority: h.priority, title: h.title,
                tags: h.tags, deadline: null, closed: null, scheduledRaw: null,
                propLines: [], body: [], added: null, effort: null };
    let i = 1;
    while (i < lines.length && PLANNING_RE.test(lines[i])) { parsePlanning(lines[i], t); i++; }
    if (i < lines.length && /^\s*:PROPERTIES:\s*$/i.test(lines[i])) {
      const end = lines.findIndex((l, j) => j > i && /^\s*:END:\s*$/i.test(l));
      if (end > -1) { t.propLines = lines.slice(i + 1, end); i = end + 1; }
    }
    t.body = lines.slice(i);
    for (const pl of t.propLines) {
      let pm;
      if ((pm = pl.match(/^\s*:Effort:\s*(\S.*?)\s*$/i))) t.effort = pm[1];
      if ((pm = pl.match(/^\s*:ADDED:\s*\[(\d{4}-\d{2}-\d{2})[^\]]*\]/i))) t.added = pm[1];
    }
    return t;
  }

  function parseOrg(text) {
    const starts = [];
    if (text.startsWith('* ')) starts.push(0);
    const re = /\n\* /g;
    let m;
    while ((m = re.exec(text))) starts.push(m.index + 1);
    const file = { preamble: starts.length ? text.slice(0, starts[0]) : text, tasks: [] };
    for (let i = 0; i < starts.length; i++) {
      const raw = text.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : text.length);
      file.tasks.push(parseTaskBlock(raw));
    }
    return file;
  }
```

And change the `return` to:

```js
  return { version: 1, dayName, addDays, orgActive, orgInactive, parseDateToken, parseOrg };
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/
git commit -m "feat: org parser and date helpers in core"
```

---

### Task 3: Serializer, round-trip guarantee, mutations

**Files:**
- Modify: `index.html` (inside the Core IIFE)
- Test: `tests/serializer.test.mjs`

**Interfaces:**
- Consumes: `parseOrg`, `orgActive`, `orgInactive`, `dayName` from Task 2
- Produces (all on `Core`; every mutation sets `task.dirty = true`):
  - `renderTask(task) -> string` — canonical org block, always ends `'\n'`
  - `serializeFile(file) -> string` — `preamble + blocks` (clean blocks emit `raw` verbatim)
  - `setState(task, state, now?)` — `now = { iso, hm }` required when state is `'DONE'` (writes `CLOSED`); any other state clears `closed`
  - `setPriority(task, p|null)`, `setTitle(task, s)`, `setTags(task, string[])`, `setDeadline(task, iso|null)`
  - `setProp(task, key, value|null)` — updates/inserts/removes a `:key:` line in `propLines`
  - `setEffort(task, v|null)` — sets `task.effort` and the `:Effort:` prop
  - `appendBody(task, line)` — pushes `'  ' + line`
  - `makeTask({title, priority?, tags?, deadline?, effort?}, todayIso) -> Task` — new dirty TODO task with `:ADDED:`
  - `moveTask(file, from, to) -> boolean` — reorders `file.tasks`, normalizes each `raw` to end with `'\n'`

- [ ] **Step 1: Write failing tests `tests/serializer.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';
import { SAMPLE } from './fixtures.mjs';

const CORPUS = [
  SAMPLE,
  '* TODO no trailing newline',
  '* Weird   spacing\n\n\n* TODO another\n  :LOGBOOK:\n  - note\n  :END:\n',
  'preamble only, no tasks\n',
  '',
  '* NEXT keep scheduled\n  SCHEDULED: <2026-08-01 Sat> DEADLINE: <2026-08-02 Sun>\n  body\n',
];

test('round-trip is byte-identical with no edits', () => {
  for (const text of CORPUS) {
    assert.equal(Core.serializeFile(Core.parseOrg(text)), text);
  }
});

test('editing one task leaves other blocks byte-identical', () => {
  const f = Core.parseOrg(SAMPLE);
  Core.setPriority(f.tasks[0], 'B');
  const out = Core.serializeFile(f);
  assert.ok(out.includes('* NEXT [#B] Ship quarterly report :work:urgent:'));
  assert.ok(out.includes('  :Effort:   3h'));                 // prop lines kept verbatim
  assert.ok(out.includes('  :ADDED:    [2026-07-18 Sat]'));   // original spacing kept
  assert.ok(out.includes('* TODO Plain task\n'));
  assert.ok(out.includes('** Sub-heading stays in body'));
  assert.ok(out.endsWith('   body of sub\n'));
});

test('setState DONE adds CLOSED, undo removes it', () => {
  const f = Core.parseOrg('* TODO x\n');
  Core.setState(f.tasks[0], 'DONE', { iso: '2026-07-18', hm: '14:30' });
  assert.equal(Core.serializeFile(f), '* DONE x\n  CLOSED: [2026-07-18 Sat 14:30]\n');
  Core.setState(f.tasks[0], 'TODO');
  assert.equal(Core.serializeFile(f), '* TODO x\n');
});

test('setDeadline sets and clears', () => {
  const f = Core.parseOrg('* TODO x\n');
  Core.setDeadline(f.tasks[0], '2026-07-22');
  assert.equal(Core.serializeFile(f), '* TODO x\n  DEADLINE: <2026-07-22 Wed>\n');
  Core.setDeadline(f.tasks[0], null);
  assert.equal(Core.serializeFile(f), '* TODO x\n');
});

test('setEffort creates and updates the properties drawer', () => {
  const f = Core.parseOrg('* TODO x\n');
  Core.setEffort(f.tasks[0], '2h');
  assert.equal(Core.serializeFile(f), '* TODO x\n  :PROPERTIES:\n  :Effort:   2h\n  :END:\n');
  Core.setEffort(f.tasks[0], '4h');
  assert.equal(Core.serializeFile(f), '* TODO x\n  :PROPERTIES:\n  :Effort:   4h\n  :END:\n');
  Core.setEffort(f.tasks[0], null);
  assert.equal(Core.serializeFile(f), '* TODO x\n');
});

test('setTags renders trailing tag group', () => {
  const f = Core.parseOrg('* TODO x\n');
  Core.setTags(f.tasks[0], ['a', 'b']);
  assert.equal(Core.serializeFile(f), '* TODO x :a:b:\n');
});

test('makeTask renders the full canonical block', () => {
  const t = Core.makeTask(
    { title: 'Ship report', priority: 'A', tags: ['urgent'], deadline: '2026-07-22', effort: '3h' },
    '2026-07-18');
  assert.equal(Core.renderTask(t),
    '* TODO [#A] Ship report :urgent:\n' +
    '  DEADLINE: <2026-07-22 Wed>\n' +
    '  :PROPERTIES:\n' +
    '  :ADDED:   [2026-07-18 Sat]\n' +
    '  :Effort:   3h\n' +
    '  :END:\n');
  assert.equal(t.added, '2026-07-18');
  assert.equal(t.state, 'TODO');
});

test('SCHEDULED survives an edit', () => {
  const f = Core.parseOrg('* NEXT keep :x:\n  SCHEDULED: <2026-08-01 Sat> DEADLINE: <2026-08-02 Sun>\n');
  Core.setPriority(f.tasks[0], 'A');
  const out = Core.serializeFile(f);
  assert.ok(out.includes('SCHEDULED: <2026-08-01 Sat>'));
  assert.ok(out.includes('DEADLINE: ' + Core.orgActive('2026-08-02')));
});

test('moveTask reorders and normalizes trailing newline', () => {
  const f = Core.parseOrg('* TODO a\n* TODO b\n* TODO c');
  assert.equal(Core.moveTask(f, 2, 0), true);
  assert.equal(Core.serializeFile(f), '* TODO c\n* TODO a\n* TODO b\n');
  assert.equal(Core.moveTask(f, 0, -1), false);
});

test('appendBody adds an indented line', () => {
  const f = Core.parseOrg('* TODO x\n');
  Core.appendBody(f.tasks[0], '[[file:images/shot-1.png]]');
  assert.equal(Core.serializeFile(f), '* TODO x\n  [[file:images/shot-1.png]]\n');
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `node --test 'tests/*.test.mjs'`
Expected: serializer tests FAIL (`Core.serializeFile is not a function`); Task 1–2 tests still pass.

- [ ] **Step 3: Implement in the Core IIFE**

Insert before the `return`:

```js
  // --- serializer + mutations ---
  function renderTask(t) {
    let head = '* ';
    if (t.state) head += t.state + ' ';
    if (t.priority) head += '[#' + t.priority + '] ';
    head += t.title;
    if (t.tags.length) head += ' :' + t.tags.join(':') + ':';
    const lines = [head];
    const plan = [];
    if (t.closed) plan.push('CLOSED: [' + t.closed + ']');
    if (t.deadline) plan.push('DEADLINE: ' + orgActive(t.deadline));
    if (t.scheduledRaw) plan.push(t.scheduledRaw);
    if (plan.length) lines.push('  ' + plan.join(' '));
    if (t.propLines.length) lines.push('  :PROPERTIES:', ...t.propLines, '  :END:');
    lines.push(...t.body);
    return lines.join('\n') + '\n';
  }

  function serializeFile(file) {
    return file.preamble + file.tasks.map(t => t.dirty ? renderTask(t) : t.raw).join('');
  }

  const touch = t => { t.dirty = true; };
  function setState(t, state, now) {
    t.state = state;
    t.closed = state === 'DONE' && now ? now.iso + ' ' + dayName(now.iso) + ' ' + now.hm : null;
    touch(t);
  }
  function setPriority(t, p) { t.priority = p; touch(t); }
  function setTitle(t, s) { t.title = s; touch(t); }
  function setTags(t, tags) { t.tags = tags; touch(t); }
  function setDeadline(t, iso) { t.deadline = iso; touch(t); }
  function setProp(t, key, value) {
    const re = new RegExp('^\\s*:' + key + ':', 'i');
    const idx = t.propLines.findIndex(l => re.test(l));
    if (value == null) { if (idx > -1) t.propLines.splice(idx, 1); }
    else if (idx > -1) t.propLines[idx] = '  :' + key + ':   ' + value;
    else t.propLines.push('  :' + key + ':   ' + value);
    touch(t);
  }
  function setEffort(t, v) { t.effort = v; setProp(t, 'Effort', v); }
  function appendBody(t, line) { t.body.push('  ' + line); touch(t); }

  function makeTask(fields, todayIso) {
    const t = { raw: '', dirty: true, state: 'TODO', priority: fields.priority || null,
                title: fields.title, tags: fields.tags || [], deadline: fields.deadline || null,
                closed: null, scheduledRaw: null, propLines: [], body: [],
                added: todayIso, effort: null };
    setProp(t, 'ADDED', orgInactive(todayIso));
    if (fields.effort) setEffort(t, fields.effort);
    return t;
  }

  function moveTask(file, from, to) {
    if (to < 0 || to >= file.tasks.length || from === to) return false;
    const [t] = file.tasks.splice(from, 1);
    file.tasks.splice(to, 0, t);
    for (const x of file.tasks) if (x.raw && !x.raw.endsWith('\n')) x.raw += '\n';
    return true;
  }
```

And extend the `return` to:

```js
  return { version: 1, dayName, addDays, orgActive, orgInactive, parseDateToken, parseOrg,
           renderTask, serializeFile, setState, setPriority, setTitle, setTags, setDeadline,
           setProp, setEffort, appendBody, makeTask, moveTask };
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass, 0 fail. Pay special attention to the round-trip test — if it fails, the parser/serializer contract is broken; do not "fix" the test.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/serializer.test.mjs
git commit -m "feat: round-trip-safe org serializer and task mutations"
```

---

### Task 4: Quick-add token parser

**Files:**
- Modify: `index.html` (inside the Core IIFE)
- Test: `tests/quickadd.test.mjs`

**Interfaces:**
- Consumes: `parseDateToken` from Task 2
- Produces: `Core.parseQuickAdd(input, todayIso) -> { topic: string|null, title: string, priority: 'A'|'B'|'C'|null, tags: string[], deadline: iso|null, effort: string|null }`
  - Tokens: leading `topic: ` (word + colon + whitespace), `#A/#B/#C`, `:tag:` or `:a:b:`, `@date` (any `parseDateToken` form), `~effort` (`\d+(\.\d+)?[hmd]`). Unrecognized tokens (e.g. `@john`) stay in the title.

- [ ] **Step 1: Write failing tests `tests/quickadd.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

const T = '2026-07-18';

test('full quick-add line', () => {
  const p = Core.parseQuickAdd('work: Ship report #A :urgent: @jul22 ~3h', T);
  assert.deepEqual(p, { topic: 'work', title: 'Ship report', priority: 'A',
                        tags: ['urgent'], deadline: '2026-07-22', effort: '3h' });
});

test('title only — everything else defaults', () => {
  const p = Core.parseQuickAdd('Just a task', T);
  assert.deepEqual(p, { topic: null, title: 'Just a task', priority: null,
                        tags: [], deadline: null, effort: null });
});

test('date forms pass through parseDateToken', () => {
  assert.equal(Core.parseQuickAdd('x @2026-07-22', T).deadline, '2026-07-22');
  assert.equal(Core.parseQuickAdd('x @tomorrow', T).deadline, '2026-07-19');
  assert.equal(Core.parseQuickAdd('x @fri', T).deadline, '2026-07-24');
});

test('unrecognized @token stays in the title', () => {
  const p = Core.parseQuickAdd('email @john about report', T);
  assert.equal(p.deadline, null);
  assert.equal(p.title, 'email @john about report');
});

test('multiple tag groups and effort forms', () => {
  const p = Core.parseQuickAdd('x :a: :b:c: ~30m', T);
  assert.deepEqual(p.tags, ['a', 'b', 'c']);
  assert.equal(p.effort, '30m');
  assert.equal(Core.parseQuickAdd('x ~1.5h', T).effort, '1.5h');
  assert.equal(Core.parseQuickAdd('x ~1d', T).effort, '1d');
});

test('lower-case priority accepted', () => {
  assert.equal(Core.parseQuickAdd('x #b', T).priority, 'B');
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `node --test 'tests/*.test.mjs'`
Expected: quickadd tests FAIL (`Core.parseQuickAdd is not a function`); everything else passes.

- [ ] **Step 3: Implement in the Core IIFE**

Insert before the `return`:

```js
  // --- quick-add tokens ---
  function parseQuickAdd(input, today) {
    let s = input.trim();
    const out = { topic: null, title: '', priority: null, tags: [], deadline: null, effort: null };
    const tm = s.match(/^([\w-]+):\s+/);
    if (tm) { out.topic = tm[1].toLowerCase(); s = s.slice(tm[0].length); }
    const titleWords = [];
    for (const w of s.split(/\s+/).filter(Boolean)) {
      let m;
      if ((m = w.match(/^#([ABCabc])$/))) out.priority = m[1].toUpperCase();
      else if ((m = w.match(/^:([A-Za-z0-9_@#%:-]+):$/))) out.tags.push(...m[1].split(':').filter(Boolean));
      else if ((m = w.match(/^@(\S+)$/)) && parseDateToken(m[1], today)) out.deadline = parseDateToken(m[1], today);
      else if ((m = w.match(/^~(\d+(?:\.\d+)?[hmd])$/))) out.effort = m[1];
      else titleWords.push(w);
    }
    out.title = titleWords.join(' ');
    return out;
  }
```

Add `parseQuickAdd` to the `return` object.

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/quickadd.test.mjs
git commit -m "feat: quick-add token parser"
```

---

### Task 5: View model — radar, backlog grouping, filters, recent sort

**Files:**
- Modify: `index.html` (inside the Core IIFE)
- Test: `tests/model.test.mjs`

**Interfaces:**
- Consumes: `parseOrg`, `addDays` from earlier tasks
- Produces (all on `Core`; a "ref" is `{ topic: string, index: number, task: Task }`):
  - `buildModel(files, todayIso) -> { radar: ref[], backlogByTopic: [topic, ref[]][], done: ref[] }` where `files = [{ topic, file }]`. Radar = `NEXT` or deadline ≤ today+7 (non-DONE); sorted deadline asc (null last) then priority A→C→none; backlog keeps file order, excludes radar members.
  - `deadlineBucket(iso|null, todayIso) -> 'overdue'|'today'|'week'|'later'|null`
  - `matchesFilter(ref, flt, todayIso) -> boolean` — `flt` keys all optional: `{ deadline, priority, tag, topic, text }`; `deadline:'week'` includes `today` and `overdue`; `text` is case-insensitive over title+tags+topic.
  - `sortRecent(refs) -> ref[]` — new array, `added` desc, missing `added` last.

- [ ] **Step 1: Write failing tests `tests/model.test.mjs`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

const T = '2026-07-18';
const mk = text => Core.parseOrg(text);

test('radar = NEXT + near deadlines, sorted by deadline then priority', () => {
  const files = [
    { topic: 'work', file: mk('* TODO [#A] far\n  DEADLINE: <2026-09-01 Tue>\n* NEXT [#B] next-no-dl\n* TODO due-soon\n  DEADLINE: <2026-07-19 Sun>\n') },
    { topic: 'home', file: mk('* NEXT [#A] next-with-dl\n  DEADLINE: <2026-07-20 Mon>\n* TODO backlog-item\n') },
  ];
  const m = Core.buildModel(files, T);
  assert.deepEqual(m.radar.map(r => r.task.title), ['due-soon', 'next-with-dl', 'next-no-dl']);
  assert.deepEqual(m.backlogByTopic.map(([t, l]) => [t, l.map(r => r.task.title)]),
                   [['work', ['far']], ['home', ['backlog-item']]]);
});

test('DONE tasks are split out', () => {
  const m = Core.buildModel([{ topic: 'w', file: mk('* DONE x\n* TODO y\n') }], T);
  assert.deepEqual(m.done.map(r => r.task.title), ['x']);
  assert.deepEqual(m.backlogByTopic, [['w', m.backlogByTopic[0][1]]]);
  assert.equal(m.backlogByTopic[0][1][0].task.title, 'y');
});

test('deadlineBucket', () => {
  assert.equal(Core.deadlineBucket('2026-07-17', T), 'overdue');
  assert.equal(Core.deadlineBucket('2026-07-18', T), 'today');
  assert.equal(Core.deadlineBucket('2026-07-25', T), 'week');   // today+7 inclusive
  assert.equal(Core.deadlineBucket('2026-07-26', T), 'later');
  assert.equal(Core.deadlineBucket(null, T), null);
});

test('matchesFilter combinations', () => {
  const file = mk('* TODO [#A] Pay taxes :money:\n  DEADLINE: <2026-07-18 Sat>\n');
  const r = { topic: 'home', index: 0, task: file.tasks[0] };
  assert.ok(Core.matchesFilter(r, { priority: 'A', tag: 'money', topic: 'home', deadline: 'today', text: 'tax' }, T));
  assert.ok(!Core.matchesFilter(r, { priority: 'B' }, T));
  assert.ok(!Core.matchesFilter(r, { tag: 'other' }, T));
  assert.ok(!Core.matchesFilter(r, { deadline: 'overdue' }, T));
  assert.ok(Core.matchesFilter(r, { deadline: 'week' }, T));  // week includes today+overdue
  assert.ok(Core.matchesFilter(r, { text: 'HOME' }, T));      // matches topic, case-insensitive
  assert.ok(Core.matchesFilter(r, {}, T));
});

test('sortRecent: newest first, missing ADDED last', () => {
  const f = mk('* TODO old\n  :PROPERTIES:\n  :ADDED:   [2026-07-01 Wed]\n  :END:\n' +
               '* TODO new\n  :PROPERTIES:\n  :ADDED:   [2026-07-18 Sat]\n  :END:\n' +
               '* TODO none\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  assert.deepEqual(Core.sortRecent(refs).map(r => r.task.title), ['new', 'old', 'none']);
});
```

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `node --test 'tests/*.test.mjs'`
Expected: model tests FAIL (`Core.buildModel is not a function`); everything else passes.

- [ ] **Step 3: Implement in the Core IIFE**

Insert before the `return`:

```js
  // --- view model ---
  const PRI_ORDER = { A: 0, B: 1, C: 2 };
  const priRank = p => (p in PRI_ORDER ? PRI_ORDER[p] : 3);

  function deadlineBucket(iso, today) {
    if (!iso) return null;
    if (iso < today) return 'overdue';
    if (iso === today) return 'today';
    if (iso <= addDays(today, 7)) return 'week';
    return 'later';
  }

  function buildModel(files, today) {
    const horizon = addDays(today, 7);
    const refs = [];
    for (const f of files) f.file.tasks.forEach((task, index) => refs.push({ topic: f.topic, index, task }));
    const done = refs.filter(r => r.task.state === 'DONE');
    const open = refs.filter(r => r.task.state !== 'DONE');
    const radar = open.filter(r => r.task.state === 'NEXT' || (r.task.deadline && r.task.deadline <= horizon));
    radar.sort((a, b) => {
      const ad = a.task.deadline || '9999', bd = b.task.deadline || '9999';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return priRank(a.task.priority) - priRank(b.task.priority);
    });
    const radarSet = new Set(radar);
    const backlogByTopic = [];
    for (const f of files) {
      const list = open.filter(r => r.topic === f.topic && !radarSet.has(r));
      if (list.length) backlogByTopic.push([f.topic, list]);
    }
    return { radar, backlogByTopic, done };
  }

  function matchesFilter(r, flt, today) {
    const t = r.task;
    if (flt.priority && t.priority !== flt.priority) return false;
    if (flt.tag && !t.tags.includes(flt.tag)) return false;
    if (flt.topic && r.topic !== flt.topic) return false;
    if (flt.deadline) {
      const b = deadlineBucket(t.deadline, today);
      if (flt.deadline === 'week') { if (!['week', 'today', 'overdue'].includes(b)) return false; }
      else if (b !== flt.deadline) return false;
    }
    if (flt.text) {
      const hay = (t.title + ' ' + t.tags.join(' ') + ' ' + r.topic).toLowerCase();
      if (!hay.includes(flt.text.toLowerCase())) return false;
    }
    return true;
  }

  function sortRecent(refs) {
    return [...refs].sort((a, b) => (b.task.added || '0000').localeCompare(a.task.added || '0000'));
  }
```

Add `deadlineBucket, buildModel, matchesFilter, sortRecent` to the `return` object.

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/model.test.mjs
git commit -m "feat: radar/backlog view model and filter predicates"
```

---

### Task 6: App boot — folder access, IndexedDB persistence, read-only rendering

Core is complete and tested; from here on tasks build the APP section (DOM + browser APIs), verified manually. **Append all APP code after the `// ===== APP =====` marker**, never inside CORE.

**Files:**
- Modify: `index.html` (APP section + `#help` div content later; nothing in CORE)
- Create: `sample-tasks/work.org`, `sample-tasks/home.org`

**Interfaces:**
- Consumes: `Core.parseOrg`, `Core.buildModel`, `Core.matchesFilter`, `Core.sortRecent`, `Core.deadlineBucket`, `Core.renderTask`
- Produces (used by every later task):
  - `App` state object: `{ dir, files: [{topic, handle, lastModified, text, file, parseError}], filter, sel, selPos, expanded: Set, visible: ref[], lastTopic }`
  - `todayIso()`, `nowHm()`, `taskKey(task) -> string` (first line of `raw`, or of `renderTask(t)` for dirty tasks), `refKey(ref) -> topic + '\t' + taskKey`
  - `render()` — full re-render, rebuilds `App.visible` in visual order (radar → backlog → done-if-expanded), restores selection by key with positional fallback
  - `scanOnce() -> boolean` — re-reads changed/new/removed `.org` files, true if anything changed
  - `taskRow(ref) -> HTMLElement`, `bodyView(ref) -> HTMLElement`, `updateSelClass()`, `banner(msg, btnLabel?, onClick?)`, `hideBanner()`, `toast(msg)`, `div(cls)`, `span(cls)`, `idbGet(k)`, `idbSet(k, v)`

- [ ] **Step 1: Create sample fixtures**

`sample-tasks/work.org`:

```org
#+TITLE: Work

* NEXT [#A] Ship quarterly report :report:urgent:
  DEADLINE: <2026-07-22 Wed>
  :PROPERTIES:
  :Effort:   3h
  :ADDED:    [2026-07-18 Sat]
  :END:
  Draft is in the shared folder.
* TODO [#B] Refactor org parser :api:
  :PROPERTIES:
  :Effort:   2h
  :ADDED:    [2026-07-15 Wed]
  :END:
* TODO [#C] Update onboarding docs
* DONE Set up repo
  CLOSED: [2026-07-16 Thu 11:00]
```

`sample-tasks/home.org`:

```org
* TODO [#B] Renew car insurance :paperwork:
  DEADLINE: <2026-07-20 Mon>
  :PROPERTIES:
  :Effort:   1h
  :ADDED:    [2026-07-14 Tue]
  :END:
* TODO [#C] Garage cleanup
  :PROPERTIES:
  :Effort:   4h
  :END:
```

(Deadlines are near 2026-07-18; if you're testing much later, edit them to be within a week of "today" so the radar populates.)

- [ ] **Step 2: Implement boot + scan + render in the APP section**

Replace the `// (app code added in later tasks)` comment with:

```js
const $ = s => document.querySelector(s);
const div = cls => { const d = document.createElement('div'); d.className = cls; return d; };
const span = cls => { const s = document.createElement('span'); s.className = cls; return s; };

const App = {
  dir: null,
  files: [],
  filter: { deadline: null, priority: null, tag: null, topic: null, text: '', recent: false },
  sel: null, selPos: 0,
  expanded: new Set(),
  visible: [],
  lastTopic: localStorage.getItem('lastTopic') || null,
};

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function nowHm() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function taskKey(t) { return (t.dirty || !t.raw ? Core.renderTask(t) : t.raw).split('\n', 1)[0]; }
function refKey(r) { return r.topic + '\t' + taskKey(r.task); }

// --- tiny IndexedDB kv store (persists the directory handle) ---
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('orgtodo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv').objectStore('kv').get(k);
    t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
  });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
    t.onsuccess = () => res(); t.onerror = () => rej(t.error);
  });
}

// --- banner / toast ---
function banner(msg, btnLabel, onClick) {
  const b = $('#banner');
  b.hidden = false;
  b.replaceChildren(msg + ' ');
  if (btnLabel) {
    const btn = document.createElement('button');
    btn.textContent = btnLabel; btn.onclick = onClick;
    b.append(btn);
  }
}
function hideBanner() { $('#banner').hidden = true; }
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

// --- boot / folder access ---
async function boot() {
  if (!window.showDirectoryPicker) {
    banner('This app needs Chrome or Edge — it reads your org files with the File System Access API.');
    return;
  }
  const saved = await idbGet('dir').catch(() => null);
  if (saved) {
    if (await saved.queryPermission({ mode: 'readwrite' }) === 'granted') return start(saved);
    banner('Folder access needs to be re-granted.', 'Re-grant access', async () => {
      if (await saved.requestPermission({ mode: 'readwrite' }) === 'granted') { hideBanner(); start(saved); }
    });
  } else {
    banner('Choose the folder that holds your .org task files.', 'Open tasks folder', openFolder);
  }
}
async function openFolder() {
  try {
    const h = await showDirectoryPicker({ mode: 'readwrite' });
    await idbSet('dir', h);
    hideBanner();
    start(h);
  } catch (e) { /* user cancelled the picker */ }
}
async function start(handle) {
  App.dir = handle;
  await scanOnce();
  render();
}

// --- scanning ---
async function scanOnce() {
  const seen = new Set();
  let changed = false;
  for await (const [name, handle] of App.dir.entries()) {
    if (handle.kind !== 'file' || !name.endsWith('.org')) continue;
    const topic = name.slice(0, -4);
    seen.add(topic);
    const f = await handle.getFile();
    let entry = App.files.find(e => e.topic === topic);
    if (!entry) {
      entry = { topic, handle, lastModified: 0, text: '', file: null, parseError: false };
      App.files.push(entry);
    }
    if (f.lastModified !== entry.lastModified) {
      entry.lastModified = f.lastModified;
      entry.text = await f.text();
      try { entry.file = Core.parseOrg(entry.text); entry.parseError = false; }
      catch (e) { entry.parseError = true; }
      changed = true;
    }
  }
  const before = App.files.length;
  App.files = App.files.filter(e => seen.has(e.topic));
  if (App.files.length !== before) changed = true;
  App.files.sort((a, b) => a.topic.localeCompare(b.topic));
  return changed;
}

// --- rendering ---
function render() {
  const today = todayIso();
  const files = App.files.filter(e => e.file && !e.parseError).map(e => ({ topic: e.topic, file: e.file }));
  const model = Core.buildModel(files, today);
  const pass = r => Core.matchesFilter(r, App.filter, today);
  let radar = model.radar.filter(pass);
  let groups = model.backlogByTopic.map(([t, l]) => [t, l.filter(pass)]).filter(([, l]) => l.length);
  const done = model.done.filter(pass);
  if (App.filter.recent) {
    const open = [...radar, ...groups.flatMap(([, l]) => l)];
    radar = [];
    groups = [['recently added', Core.sortRecent(open)]];
  }

  App.visible = [];
  $('#radar-list').replaceChildren(...radar.map(taskRow));
  $('#radar').hidden = !radar.length;
  const bl = [];
  for (const [topic, list] of groups) {
    const h = document.createElement('h3');
    h.textContent = topic;
    bl.push(h, ...list.map(taskRow));
  }
  $('#backlog-list').replaceChildren(...bl);
  $('#done-count').textContent = done.length;
  const showDone = !$('#done-list').hidden;
  $('#done-list').replaceChildren(...(showDone ? done.map(taskRow) : []));

  const broken = App.files.filter(e => e.parseError);
  const b = $('#banner');
  if (broken.length) {
    banner('Could not parse: ' + broken.map(e => e.topic + '.org').join(', ') + ' — hidden from the list, file left untouched.');
  } else if (!b.hidden && b.textContent.startsWith('Could not parse')) {
    hideBanner();
  }

  // selection: keep by key, fall back to same position
  let idx = App.visible.findIndex(r => refKey(r) === App.sel);
  if (idx === -1 && App.visible.length) {
    idx = Math.min(App.selPos, App.visible.length - 1);
    App.sel = refKey(App.visible[idx]);
  }
  if (idx === -1) App.sel = null; else App.selPos = idx;
  updateSelClass();
}

function updateSelClass() {
  document.querySelectorAll('.task').forEach(el => el.classList.toggle('sel', el.dataset.rk === App.sel));
}

function taskRow(ref) {
  const t = ref.task;
  App.visible.push(ref);
  const row = div('task');
  row.dataset.rk = refKey(ref);
  if (t.state) row.classList.add('st-' + t.state);
  const pri = div('pri ' + (t.priority ? 'pri-' + t.priority : 'pri-none'));
  pri.textContent = t.priority || '·';
  const title = div('title');
  title.textContent = t.title || '(untitled)';
  const meta = div('meta');
  const topic = span('chip topic');
  topic.textContent = ref.topic;
  topic.onclick = () => { App.filter.topic = ref.topic; render(); };
  meta.append(topic);
  for (const tg of t.tags) {
    const c = span('chip tag');
    c.textContent = tg;
    c.onclick = () => { App.filter.tag = tg; render(); };
    meta.append(c);
  }
  if (t.deadline) {
    const b = span('chip dl-' + (Core.deadlineBucket(t.deadline, todayIso()) || 'later'));
    b.textContent = '⏰ ' + t.deadline.slice(5);
    meta.append(b);
  }
  if (t.effort) {
    const e = span('chip eff');
    e.textContent = '~' + t.effort;
    meta.append(e);
  }
  row.append(pri, title, meta);
  row.onclick = () => {
    App.sel = row.dataset.rk;
    App.selPos = App.visible.findIndex(r => refKey(r) === App.sel);
    updateSelClass();
  };
  if (App.expanded.has(row.dataset.rk) && t.body.some(l => l.trim())) row.append(bodyView(ref));
  return row;
}

function bodyView(ref) {
  const box = div('body');
  for (const line of ref.task.body) {
    if (!line.trim()) continue;
    const p = div('bline');
    p.textContent = line.replace(/^ {0,2}/, '');
    box.append(p);
  }
  return box;
}

$('#done-toggle').onclick = () => { $('#done-list').hidden = !$('#done-list').hidden; render(); };

boot();
```

- [ ] **Step 3: Run the automated tests (must stay green)**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass — APP code must not have touched CORE.

- [ ] **Step 4: Manual verification**

1. Open the app in Chrome: `open -a "Google Chrome" index.html`. If the folder picker doesn't open from `file://`, serve it instead (dev only): `python3 -m http.server 8000` then open `http://localhost:8000`.
2. Click "Open tasks folder" → pick the repo's `sample-tasks/` folder → grant read/write.
3. Expect: radar shows "Ship quarterly report" (A, ⏰ 07-22) and "Renew car insurance" (B, ⏰ 07-20), deadline-sorted; backlog groups "home" and "work"; "Done (1)" collapsed; clicking it reveals "Set up repo" struck through.
4. Click a task → it highlights. Click a tag chip → list narrows (no way to clear yet — reload to reset).
5. Reload the page → a single "Re-grant access" click restores everything.

- [ ] **Step 5: Commit**

```bash
git add index.html sample-tasks/
git commit -m "feat: folder access, handle persistence, read-only task rendering"
```

---

### Task 7: Live sync polling

**Files:**
- Modify: `index.html` (APP section)

**Interfaces:**
- Consumes: `scanOnce`, `render`, `banner`, `boot`, `App`
- Produces: `scanTick()` — guarded poll used by `setInterval`; `start()` now kicks off the 1.5 s loop. Later tasks rely on polling picking up external edits automatically.

- [ ] **Step 1: Implement the poll loop**

Replace the existing `start` function with:

```js
let scanning = false;
let pollTimer = null;
async function start(handle) {
  App.dir = handle;
  await scanTick();
  if (!pollTimer) pollTimer = setInterval(scanTick, 1500);
}
async function scanTick() {
  if (scanning || !App.dir) return;
  scanning = true;
  try {
    if (await scanOnce()) render();
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      clearInterval(pollTimer); pollTimer = null;
      banner('Folder access was lost.', 'Re-grant access', async () => {
        if (await App.dir.requestPermission({ mode: 'readwrite' }) === 'granted') {
          hideBanner();
          start(App.dir);
        }
      });
    }
  } finally {
    scanning = false;
  }
}
```

- [ ] **Step 2: Run the automated tests (must stay green)**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 3: Manual verification**

1. Open the app on `sample-tasks/` as in Task 6.
2. In a text editor, change `* TODO [#C] Update onboarding docs` to `* NEXT [#A] Update onboarding docs` in `work.org` and save.
3. Expect: within ~2 s the task jumps to the radar with a red A pill — no reload, and your selection stays where it was.
4. Create `sample-tasks/errands.org` with `* TODO Buy stamps` → an "errands" group appears. Delete the file → it disappears.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: 1.5s polling keeps the page in sync with on-disk edits"
```

---

### Task 8: Write-back infrastructure + quick-add UI

**Files:**
- Modify: `index.html` (APP section)

**Interfaces:**
- Consumes: `Core.parseQuickAdd`, `Core.makeTask`, `Core.serializeFile`, `Core.parseOrg`, `App`, `render`, `toast`, `taskKey`
- Produces (every later mutating task goes through these):
  - `saveFile(entry, mutateFn)` — write-safety: re-reads the file first if it changed on disk, applies `mutateFn(file)`, serializes, writes, re-parses to reset dirty flags, renders
  - `mutateTask(topic, key, fn)` — looks up the entry and the task by `taskKey`, wraps `saveFile`; `fn(task, file)` applies Core mutations
  - `withSel(fn)` — `mutateTask` on the currently selected task
  - `selRef() -> ref|null`
  - `createTopic(topic) -> entry` — creates `<topic>.org` in the folder

- [ ] **Step 1: Implement write-back + quick-add**

Append to the APP section:

```js
// --- write-back ---
async function saveFile(entry, mutateFn) {
  if (entry.parseError) { toast('Refusing to write ' + entry.topic + '.org — it did not parse'); return; }
  try {
    const f = await entry.handle.getFile();
    if (f.lastModified !== entry.lastModified) {   // changed on disk since we read it
      entry.text = await f.text();
      entry.file = Core.parseOrg(entry.text);
    }
    mutateFn(entry.file);
    const out = Core.serializeFile(entry.file);
    const w = await entry.handle.createWritable();
    await w.write(out);
    await w.close();
    const f2 = await entry.handle.getFile();
    entry.lastModified = f2.lastModified;
    entry.text = out;
    entry.file = Core.parseOrg(out);               // reset raw/dirty to canonical state
    render();
  } catch (e) {
    toast('Write failed: ' + e.message);
  }
}
function findEntry(topic) { return App.files.find(e => e.topic === topic) || null; }
async function mutateTask(topic, key, fn) {
  const entry = findEntry(topic);
  if (!entry) return;
  await saveFile(entry, file => {
    const t = file.tasks.find(x => taskKey(x) === key);
    if (t) fn(t, file);
  });
}
function selRef() { return App.visible.find(r => refKey(r) === App.sel) || null; }
async function withSel(fn) {
  const r = selRef();
  if (r) await mutateTask(r.topic, taskKey(r.task), fn);
}
async function createTopic(topic) {
  const handle = await App.dir.getFileHandle(topic + '.org', { create: true });
  const entry = { topic, handle, lastModified: 0, text: '', file: Core.parseOrg(''), parseError: false };
  App.files.push(entry);
  App.files.sort((a, b) => a.topic.localeCompare(b.topic));
  return entry;
}

// --- quick-add ---
const qa = $('#quickadd');
function defaultTopic() { return App.files[0] ? App.files[0].topic : null; }
function hintText(p) {
  const parts = ['→ ' + (p.topic || App.lastTopic || defaultTopic() || '?') + '.org', '“' + p.title + '”'];
  if (p.priority) parts.push('#' + p.priority);
  if (p.tags.length) parts.push(':' + p.tags.join(':') + ':');
  if (p.deadline) parts.push('⏰ ' + p.deadline);
  if (p.effort) parts.push('~' + p.effort);
  return parts.join('  ');
}
qa.addEventListener('input', () => {
  $('#hint').textContent = qa.value.trim() ? hintText(Core.parseQuickAdd(qa.value, todayIso())) : '';
});
qa.addEventListener('keydown', async e => {
  e.stopPropagation();
  if (e.key === 'Escape') { qa.value = ''; $('#hint').textContent = ''; qa.blur(); return; }
  if (e.key !== 'Enter') return;
  const p = Core.parseQuickAdd(qa.value, todayIso());
  if (!p.title) { toast('Task needs a title'); return; }
  const topic = p.topic || App.lastTopic || defaultTopic();
  if (!topic) { toast('No topic yet — type "topic: title"'); return; }
  let entry = findEntry(topic);
  if (!entry) {
    if (!confirm('Create new topic file "' + topic + '.org"?')) return;
    entry = await createTopic(topic);
  }
  await saveFile(entry, file => { file.tasks.push(Core.makeTask(p, todayIso())); });
  App.lastTopic = topic;
  localStorage.setItem('lastTopic', topic);
  qa.value = '';
  $('#hint').textContent = '';
});
```

- [ ] **Step 2: Run the automated tests (must stay green)**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 3: Manual verification**

1. Open the app on `sample-tasks/`.
2. Type `work: Try the quick add #B :demo: @tomorrow ~1h` — the hint line shows `→ work.org  “Try the quick add”  #B  :demo:  ⏰ <tomorrow's date>  ~1h`. Press Enter.
3. Expect: task appears on the radar (deadline tomorrow). Open `work.org` in a text editor — the new block is appended at the end with `DEADLINE`, `:ADDED:`, `:Effort:`, and the rest of the file is byte-identical.
4. Type `groceries: Milk` → confirm dialog → `groceries.org` is created with the task.
5. Type `No topic prefix here` and Enter → lands in the last-used topic (groceries).
6. While the page is open, edit the same file in your editor and immediately add a task from the UI — both changes survive (the pre-write re-read).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: write-safe file saving and token-based quick-add"
```

---

### Task 9: Keyboard cursor, expand/collapse, help overlay

**Files:**
- Modify: `index.html` (APP section + `#help` div markup)

**Interfaces:**
- Consumes: `App`, `render`, `updateSelClass`, `refKey`, `qa`
- Produces: the global `keydown` handler (Tasks 10–11 add branches to it — keep it a single handler), `moveSel(delta)`, `toggleExpand()`

- [ ] **Step 1: Fill the `#help` div**

Replace `<div id="help" hidden></div>` with:

```html
<div id="help" hidden>
<h2>Shortcuts</h2>
<table>
<tr><td><kbd>j</kbd>/<kbd>k</kbd> or arrows</td><td>move cursor</td></tr>
<tr><td><kbd>Enter</kbd>/<kbd>o</kbd></td><td>expand / collapse</td></tr>
<tr><td><kbd>Alt+↑</kbd>/<kbd>Alt+↓</kbd></td><td>move task up / down</td></tr>
<tr><td><kbd>a</kbd></td><td>add task</td></tr>
<tr><td><kbd>e</kbd></td><td>edit heading (title #A :tag: @date ~2h)</td></tr>
<tr><td><kbd>n</kbd></td><td>toggle NEXT (radar)</td></tr>
<tr><td><kbd>d</kbd></td><td>done / not done</td></tr>
<tr><td><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>0</kbd></td><td>priority A / B / C / none</td></tr>
<tr><td><kbd>s</kbd></td><td>set deadline</td></tr>
<tr><td><kbd>t</kbd></td><td>edit tags</td></tr>
<tr><td><kbd>E</kbd></td><td>edit estimate</td></tr>
<tr><td><kbd>/</kbd></td><td>search</td></tr>
<tr><td><kbd>Esc</kbd></td><td>clear filters / close</td></tr>
<tr><td><kbd>?</kbd></td><td>this help</td></tr>
</table>
</div>
```

- [ ] **Step 2: Implement navigation in the APP section**

Append:

```js
// --- keyboard ---
function moveSel(delta) {
  if (!App.visible.length) return;
  let i = App.visible.findIndex(r => refKey(r) === App.sel);
  i = Math.max(0, Math.min(App.visible.length - 1, i + delta));
  App.sel = refKey(App.visible[i]);
  App.selPos = i;
  updateSelClass();
  const el = document.querySelector('.task.sel');
  if (el) el.scrollIntoView({ block: 'nearest' });
}
function toggleExpand() {
  if (!App.sel) return;
  App.expanded.has(App.sel) ? App.expanded.delete(App.sel) : App.expanded.add(App.sel);
  render();
}

document.addEventListener('keydown', async e => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;   // inputs handle their own keys
  const k = e.key;
  if (k === '?') { $('#help').hidden = !$('#help').hidden; return; }
  if (k === 'Escape') { if (!$('#help').hidden) { $('#help').hidden = true; return; } clearFilters(); return; }
  if (k === 'a') { e.preventDefault(); qa.focus(); return; }
  if (k === '/') { e.preventDefault(); const s = $('#search'); if (s) s.focus(); return; }
  // Task 11 inserts the Alt+arrow reorder branch HERE, before plain arrow handling
  if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); moveSel(1); return; }
  if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); moveSel(-1); return; }
  if (k === 'Enter' || k === 'o') { toggleExpand(); return; }
  // Task 10 inserts mutation branches HERE
});
```

Also add this stub (Task 12 replaces it):

```js
function clearFilters() {
  App.filter = { deadline: null, priority: null, tag: null, topic: null, text: '', recent: false };
  render();
}
```

- [ ] **Step 3: Run the automated tests (must stay green)**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 4: Manual verification**

1. Open the app on `sample-tasks/`. Press `j`/`k` — the highlight walks radar → backlog in visual order and scrolls into view.
2. Select "Ship quarterly report", press `Enter` — notes expand under the row; `o` collapses.
3. Press `?` — help overlay; `Esc` closes it. Press `a` — quick-add gets focus; typed letters go into the input, not shortcuts; `Esc` blurs.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: keyboard cursor, expand/collapse, shortcut help"
```

---

### Task 10: Mutation shortcuts — state, priority, deadline, tags, estimate, heading edit

**Files:**
- Modify: `index.html` (APP section)

**Interfaces:**
- Consumes: `withSel`, `selRef`, `mutateTask`, `Core.setState/setPriority/setTags/setDeadline/setEffort/setTitle`, `Core.parseDateToken`, `Core.parseQuickAdd`, `todayIso`, `nowHm`, `toast`
- Produces: `inlineEdit(initial, placeholder, onCommit)` — small input under the selected row (Enter commits, Esc cancels, blur cancels); used by Task 10 only

- [ ] **Step 1: Implement**

Append the helper:

```js
// --- inline editor ---
function inlineEdit(initial, placeholder, onCommit) {
  const row = document.querySelector('.task.sel');
  if (!row) return;
  const box = div('editor');
  const inp = document.createElement('input');
  inp.value = initial;
  inp.placeholder = placeholder;
  box.append(inp);
  row.after(box);
  inp.focus();
  inp.select();
  inp.onkeydown = async e => {
    e.stopPropagation();
    if (e.key === 'Escape') box.remove();
    if (e.key === 'Enter') { const v = inp.value.trim(); box.remove(); await onCommit(v); }
  };
  inp.onblur = () => box.remove();
}
```

Then add these branches inside the global `keydown` handler, at the `// Task 10 inserts mutation branches HERE` marker:

```js
  if (k === 'n') return withSel(t => Core.setState(t, t.state === 'NEXT' ? 'TODO' : 'NEXT'));
  if (k === 'd') return withSel(t => t.state === 'DONE'
      ? Core.setState(t, 'TODO')
      : Core.setState(t, 'DONE', { iso: todayIso(), hm: nowHm() }));
  if (k === '1') return withSel(t => Core.setPriority(t, 'A'));
  if (k === '2') return withSel(t => Core.setPriority(t, 'B'));
  if (k === '3') return withSel(t => Core.setPriority(t, 'C'));
  if (k === '0') return withSel(t => Core.setPriority(t, null));
  if (k === 's') {
    const r = selRef();
    if (r) inlineEdit(r.task.deadline || '', 'deadline: 2026-07-22 / jul22 / fri — empty clears', async v => {
      const iso = v ? Core.parseDateToken(v, todayIso()) : null;
      if (v && !iso) { toast('Unrecognized date: ' + v); return; }
      await mutateTask(r.topic, taskKey(r.task), t => Core.setDeadline(t, iso));
    });
    return;
  }
  if (k === 't') {
    const r = selRef();
    if (r) inlineEdit(r.task.tags.join(' '), 'tags separated by spaces — empty clears', async v => {
      await mutateTask(r.topic, taskKey(r.task), t => Core.setTags(t, v ? v.split(/[\s:]+/).filter(Boolean) : []));
    });
    return;
  }
  if (k === 'E') {
    const r = selRef();
    if (r) inlineEdit(r.task.effort || '', 'estimate: 30m / 2h / 1.5h / 1d — empty clears', async v => {
      if (v && !/^\d+(\.\d+)?[hmd]$/.test(v)) { toast('Estimate looks like 30m, 2h, 1.5h or 1d'); return; }
      await mutateTask(r.topic, taskKey(r.task), t => Core.setEffort(t, v || null));
    });
    return;
  }
  if (k === 'e') {
    const r = selRef();
    if (r) {
      const t = r.task;
      const cur = [t.title,
                   t.priority && '#' + t.priority,
                   ...t.tags.map(x => ':' + x + ':'),
                   t.deadline && '@' + t.deadline,
                   t.effort && '~' + t.effort].filter(Boolean).join(' ');
      inlineEdit(cur, 'title #A :tag: @date ~2h — omitted parts are removed', async v => {
        const p = Core.parseQuickAdd(v, todayIso());
        if (!p.title) { toast('Title required'); return; }
        await mutateTask(r.topic, taskKey(r.task), x => {
          Core.setTitle(x, p.title);
          Core.setPriority(x, p.priority);
          Core.setTags(x, p.tags);
          Core.setDeadline(x, p.deadline);
          Core.setEffort(x, p.effort);
        });
      });
    }
    return;
  }
```

Note the `e` semantics: the edit line is the whole truth for heading-level fields — deleting `#A` from it removes the priority. This is intentional (WYSIWYG heading edit).

- [ ] **Step 2: Run the automated tests (must stay green)**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 3: Manual verification**

1. Open the app on `sample-tasks/`, select "Garage cleanup".
2. `n` → moves to radar as NEXT (bold); `n` again → back to backlog. Verify `home.org` in an editor: state keyword flips, `:PROPERTIES:` untouched.
3. `1`/`2`/`3`/`0` → pill changes color/disappears; file shows `[#A]` etc.
4. `d` → task moves to Done with strikethrough; the file gains `CLOSED: [… …]`; `d` again → restored to TODO, `CLOSED` gone.
5. `s`, type `fri`, Enter → deadline chip appears; file has `DEADLINE: <… Fri>`. `s`, clear, Enter → gone.
6. `t`, type `garden weekend`, Enter → two tag chips. `E`, type `2h`, Enter → `~2h` chip.
7. `e` → input prefilled like `Garage cleanup #C :garden:weekend: ~2h`; change the title and remove `#C`, Enter → title updates, priority pill gone.
8. After each mutation, the selection stays on the task even though its heading changed (positional fallback).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: keyboard mutations for state, priority, deadline, tags, estimate"
```

---

### Task 11: Reordering — Alt+arrows and drag-and-drop

**Files:**
- Modify: `index.html` (APP section)

**Interfaces:**
- Consumes: `Core.moveTask`, `saveFile`, `findEntry`, `selRef`, `taskKey`, `refKey`, the `keydown` handler from Task 9, `taskRow` from Task 6
- Produces: nothing new for later tasks

- [ ] **Step 1: Keyboard reorder**

Insert at the `// Task 11 inserts the Alt+arrow reorder branch HERE` marker in the `keydown` handler:

```js
  if ((k === 'ArrowUp' || k === 'ArrowDown') && e.altKey) {
    e.preventDefault();
    const r = selRef();
    if (!r) return;
    const entry = findEntry(r.topic);
    const delta = k === 'ArrowUp' ? -1 : 1;
    await saveFile(entry, file => {
      const i = file.tasks.findIndex(t => taskKey(t) === taskKey(r.task));
      if (i > -1) Core.moveTask(file, i, i + delta);
    });
    return;
  }
```

- [ ] **Step 2: Drag-and-drop**

In `taskRow(ref)` (Task 6), before `return row;`, add:

```js
  row.draggable = true;
  row.ondragstart = e => e.dataTransfer.setData('text/plain', row.dataset.rk);
  row.ondragover = e => e.preventDefault();
  row.ondrop = async e => {
    e.preventDefault();
    const fromRk = e.dataTransfer.getData('text/plain');
    const toRk = row.dataset.rk;
    if (!fromRk || fromRk === toRk) return;
    // refKey is topic + '\t' + heading line; topics are filenames, never tabbed
    const fromTopic = fromRk.slice(0, fromRk.indexOf('\t'));
    const toTopic = toRk.slice(0, toRk.indexOf('\t'));
    if (fromTopic !== toTopic) { toast('Drag within one topic'); return; }
    const fromKey = fromRk.slice(fromTopic.length + 1);
    const toKey = toRk.slice(toTopic.length + 1);
    const entry = findEntry(fromTopic);
    await saveFile(entry, file => {
      const from = file.tasks.findIndex(t => taskKey(t) === fromKey);
      const to = file.tasks.findIndex(t => taskKey(t) === toKey);
      if (from > -1 && to > -1) Core.moveTask(file, from, to);
    });
  };
```

- [ ] **Step 3: Run the automated tests (must stay green)**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 4: Manual verification**

1. Open the app on `sample-tasks/`. In the "work" backlog group, select the lower of two tasks, press `Alt+↑` — rows swap, selection follows the moved task, and `work.org` on disk shows the blocks in the new order (byte-identical otherwise).
2. Drag a work task onto another work task — it lands at that position and the file order changes.
3. Drag a work task onto a home task — toast "Drag within one topic", files untouched.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: reorder tasks with Alt+arrows and drag-and-drop"
```

---

### Task 12: Filter bar — chips, search, recent

**Files:**
- Modify: `index.html` (`#filterbar` markup + APP section)

**Interfaces:**
- Consumes: `App.filter`, `render`, the `clearFilters` stub from Task 9, `Core.matchesFilter`/`Core.sortRecent` (already wired in `render`)
- Produces: `renderFilterState()` — called from `render()`; final `clearFilters()`

- [ ] **Step 1: Add markup inside `<div id="filterbar">`**

```html
  <input id="search" placeholder="/ search" autocomplete="off">
  <button class="chip flt" data-k="deadline" data-v="overdue">overdue</button>
  <button class="chip flt" data-k="deadline" data-v="today">today</button>
  <button class="chip flt" data-k="deadline" data-v="week">week</button>
  <button class="chip flt" data-k="priority" data-v="A">A</button>
  <button class="chip flt" data-k="priority" data-v="B">B</button>
  <button class="chip flt" data-k="priority" data-v="C">C</button>
  <button class="chip flt" data-k="recent" data-v="1">recent</button>
  <span id="active-flt"></span>
```

- [ ] **Step 2: Wire it up**

Append to the APP section:

```js
// --- filters ---
document.querySelectorAll('.flt').forEach(b => b.onclick = () => {
  const { k, v } = b.dataset;
  if (k === 'recent') App.filter.recent = !App.filter.recent;
  else App.filter[k] = App.filter[k] === v ? null : v;
  render();
});
const searchEl = $('#search');
searchEl.addEventListener('input', () => { App.filter.text = searchEl.value; render(); });
searchEl.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') { searchEl.value = ''; App.filter.text = ''; searchEl.blur(); render(); }
  if (e.key === 'Enter') searchEl.blur();
});
function renderFilterState() {
  document.querySelectorAll('.flt').forEach(b => {
    const { k, v } = b.dataset;
    b.classList.toggle('on', k === 'recent' ? App.filter.recent : App.filter[k] === v);
  });
  const af = [];
  if (App.filter.tag) af.push('tag:' + App.filter.tag);
  if (App.filter.topic) af.push('topic:' + App.filter.topic);
  $('#active-flt').textContent = af.length ? af.join('  ') + '   (Esc clears)' : '';
}
```

Replace the Task 9 `clearFilters` stub with:

```js
function clearFilters() {
  App.filter = { deadline: null, priority: null, tag: null, topic: null, text: '', recent: false };
  $('#search').value = '';
  render();
}
```

And add `renderFilterState();` as the last line of `render()`.

- [ ] **Step 3: Run the automated tests (must stay green)**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 4: Manual verification**

1. Open the app on `sample-tasks/`. Click `A` chip → only priority-A tasks remain, chip highlights; click again → off.
2. Click `week` → only tasks due within the week (incl. today/overdue). Combine with `A`.
3. Click a tag chip on a row → `tag:…` shows in the bar; `Esc` clears everything.
4. Press `/`, type `insur` → only "Renew car insurance"; `Esc` in the field clears and blurs.
5. Click `recent` → single flat list, newest `:ADDED:` first (radar section hides).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: combinable filters, text search, recently-added view"
```

---

### Task 13: Images — clipboard paste and inline rendering

**Files:**
- Modify: `index.html` (APP section; `bodyView` from Task 6 is replaced)

**Interfaces:**
- Consumes: `App.dir`, `selRef`, `mutateTask`, `Core.appendBody`, `toast`, `render`
- Produces: `slug(s)`, `loadImg(imgEl, path)`, image-aware `bodyView`

- [ ] **Step 1: Implement paste handling**

Append to the APP section:

```js
// --- images ---
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
document.addEventListener('paste', async e => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const r = selRef();
  if (!r || !App.dir) return;
  const item = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  try {
    const blob = item.getAsFile();
    const ext = (item.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const dir = await App.dir.getDirectoryHandle('images', { create: true });
    const base = slug(r.task.title) || 'img';
    let name, n = 1;
    for (;;) {
      name = base + '-' + n + '.' + ext;
      try { await dir.getFileHandle(name); n++; } catch { break; }
    }
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    App.expanded.add(App.sel);
    await mutateTask(r.topic, taskKey(r.task), t => Core.appendBody(t, '[[file:images/' + name + ']]'));
    toast('Image saved: images/' + name);
  } catch (err) {
    toast('Image paste failed: ' + err.message);
  }
});
```

- [ ] **Step 2: Make `bodyView` image-aware**

Replace the Task 6 `bodyView` with:

```js
const IMG_RE = /^\s*\[\[file:(images\/[^\]]+\.(?:png|jpe?g|gif|webp|svg))\]\]\s*$/i;
const imgUrls = new Map();
async function loadImg(img, path) {
  if (imgUrls.has(path)) { img.src = imgUrls.get(path); return; }
  try {
    const dir = await App.dir.getDirectoryHandle('images');
    const fh = await dir.getFileHandle(path.slice('images/'.length));
    const url = URL.createObjectURL(await fh.getFile());
    imgUrls.set(path, url);
    img.src = url;
  } catch {
    img.alt = 'missing: ' + path;
  }
}
function bodyView(ref) {
  const box = div('body');
  for (const line of ref.task.body) {
    const m = line.match(IMG_RE);
    if (m) {
      const img = document.createElement('img');
      loadImg(img, m[1]);
      box.append(img);
    } else if (line.trim()) {
      const p = div('bline');
      p.textContent = line.replace(/^ {0,2}/, '');
      box.append(p);
    }
  }
  return box;
}
```

- [ ] **Step 3: Run the automated tests (must stay green)**

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 4: Manual verification**

1. Open the app on `sample-tasks/`. Take any screenshot to the clipboard (`Cmd+Ctrl+Shift+4` on macOS).
2. Select a task (don't focus an input), press `Cmd+V` → toast "Image saved", the task expands and shows the image inline.
3. Check on disk: `sample-tasks/images/<task-slug>-1.png` exists; the org file's task body ends with `[[file:images/<task-slug>-1.png]]`.
4. Paste again on the same task → `-2` suffix, both images shown.
5. Collapse and re-expand → images render from cache instantly.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: paste screenshots into tasks, render org image links inline"
```

---

### Task 14: README and final smoke pass

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything
- Produces: user-facing docs; the smoke checklist below is the release gate

- [ ] **Step 1: Write `README.md`**

```markdown
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

States: `TODO` (backlog) / `NEXT` (on the radar) / `DONE`.
The radar also shows anything due within 7 days.

## Quick-add

One input, token syntax — only the title is required:

    work: Ship report #A :urgent: @jul22 ~3h

`topic:` file · `#A/#B/#C` priority · `:tag:` tags ·
`@2026-07-22 | @jul22 | @tomorrow | @fri` deadline · `~3h` estimate.

## Keyboard

Press `?` in the app for the full list. Highlights: `j/k` move · `n` radar
toggle · `d` done · `1/2/3/0` priority · `s` deadline · `t` tags ·
`E` estimate · `e` edit heading · `Alt+↑/↓` reorder · `/` search ·
paste an image onto a selected task to attach it.

## Development

No build. Tests (Node ≥ 18): `node --test 'tests/*.test.mjs'`
The test harness extracts the pure-logic CORE section from `index.html`,
so the app stays a single file.
```

- [ ] **Step 2: Full smoke checklist**

Run through all of these against `sample-tasks/`; every line must pass:

1. `node --test 'tests/*.test.mjs'` → all pass.
2. Fresh profile boot: banner → pick folder → tasks render (radar sorted by deadline, backlog grouped, Done collapsed).
3. Reload → one-click re-grant.
4. External edit in a text editor appears within ~2 s; new/deleted `.org` files appear/disappear.
5. Quick-add with every token; hint line correct; new topic creation via confirm.
6. All mutation keys (`n d 1 2 3 0 s t E e`) round-trip correctly in the file; untouched blocks stay byte-identical (verify once with `git diff` on a copy, or a before/after file compare).
7. Alt+↑/↓ and drag reorder persist file order.
8. Filters combine; `Esc` clears; `recent` sorts by `:ADDED:`; search narrows.
9. Image paste saves under `images/` and renders inline.
10. Interleaved edit (editor save + immediate UI edit) loses neither change.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, format, and shortcut reference"
```

---

## Execution notes

- Tasks must run in order — every task builds on the previous one's interfaces.
- Tasks 2–5 are strict TDD (test first, watch it fail, implement, watch it pass). Tasks 6–13 are DOM/browser code verified manually; the automated suite must stay green after each (it guards the CORE section).
- If a round-trip test ever fails, treat it as a stop-the-line bug in the parser/serializer contract — never adjust the test to match broken output.
- The plan's dates assume "today" ≈ 2026-07-18 for fixtures and examples; manual radar checks may need fixture deadlines nudged to within a week of the real today.


