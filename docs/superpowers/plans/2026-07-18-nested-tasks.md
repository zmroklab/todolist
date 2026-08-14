# Nested Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `** ` sub-headings become real one-level sub-tasks — full metadata parity, own radar rows, creatable (`A`), reorderable within their parent — per spec `docs/superpowers/specs/2026-07-18-nested-tasks-design.md`.

**Architecture:** Explicit tree in CORE: every task gets `level` (1|2) and `children: []`; each node keeps its own `raw`/`dirty`, so the byte-for-byte round-trip invariant holds per node. APP refs gain an optional `parent` (the parent *task object*), `refKey` gains a parent segment, and `mutateTask` takes a key path. Sub-task rows render under their parent wherever the parent row appears; qualifying sub-tasks also get standalone radar rows labeled with the parent.

**Tech Stack:** Single-file `index.html` (vanilla JS, no build, no deps), Node ≥ 18 built-in test runner, headless-Chrome CDP e2e.

## Global Constraints

- Everything lives in `index.html`'s one `<script>`. The marker comments `// ===== CORE START =====`, `// ===== CORE END =====`, `// ===== APP =====` must remain byte-exact — tooling greps for them.
- CORE must never touch `document`/`window`; every new CORE function is exported through the IIFE's `return {...}` and covered by unit tests.
- **Round-trip invariant (stop-the-line):** `Core.serializeFile(Core.parseOrg(text)) === text` byte-for-byte when nothing was edited. If a round-trip test fails, fix the code, never the test. This plan makes one *sanctioned semantic* change — `** ` headings parse as children instead of body lines — but round-trip bytes must still be identical.
- Unit tests: `node --test 'tests/*.test.mjs'` (the glob is required; a bare directory arg does NOT work). E2E: `node tests/ui-e2e.mjs` (skips cleanly if Chrome is missing).
- Top-level APP `function` declarations `showDirectoryPicker` (window prop), `idbSet`, `openFolder` are monkey-patched by the e2e test — do not rename. `App`, `App.visible`, `App.sel`, `refKey`, `updateSelClass` are also used from e2e `evaljs` snippets.
- Keyboard branches that focus an input must call `e.preventDefault()` (else the triggering key is typed into the input). The inline editor funnels Enter/Escape/blur through one idempotent `close()` — never add separate `box.remove()` calls.
- `sample-tasks/*.org` have pre-existing uncommitted local edits that are NOT part of this work. Never `git add sample-tasks` — the Task 8 fixture edit stays local, uncommitted.
- Line numbers below are from the pre-plan state of `index.html` and shift as tasks land; anchor on the quoted code, not the numbers.

---

### Task 1: Parser — `** ` headings become children (round-trip preserved)

**Files:**
- Modify: `index.html` — CORE org parser (`HEADING_RE` line 158, `parseHeading` 162, `parseTaskBlock` 180, `serializeFile` 233)
- Modify: `tests/fixtures.mjs`
- Modify: `tests/parser.test.mjs`
- Modify: `tests/serializer.test.mjs` (round-trip corpus only)

**Interfaces:**
- Consumes: existing `parseOrg(text)`, `serializeFile(file)`.
- Produces: every parsed task has `level: 1|2` and `children: []` (level-2 nodes keep an always-empty `children` for uniform shape). A level-1 task's `raw` covers only its own lines — heading, planning, properties, body up to the first `** ` — and each child has its own `raw`/`dirty`. `serializeFile` writes `preamble + Σ [ nodeText(parent) + Σ nodeText(child) ]` where `nodeText(t) = t.dirty ? renderTask(t) : t.raw`. `parseOrg`'s top-level split and `preamble` behavior are unchanged (`** ` before any `* ` stays in the preamble because `/\n\* /` requires star-then-space).

- [ ] **Step 1: Add the NESTED fixture**

Append to `tests/fixtures.mjs`:

```js

export const NESTED = `#+TITLE: Nested

* NEXT [#A] Ship quarterly report :work:
  DEADLINE: <2026-07-22 Wed>
  :PROPERTIES:
  :Effort:   3h
  :END:
  Parent notes.
** TODO [#B] Draft outline :writing:
   DEADLINE: <2026-07-19 Sun>
   :PROPERTIES:
   :ADDED:    [2026-07-18 Sat]
   :Effort:   1h
   :END:
   Sub notes.
** DONE Collect figures
   CLOSED: [2026-07-17 Fri 10:00]
*** Deep heading stays verbatim
    deep body
* TODO Plain task
`;
```

- [ ] **Step 2: Write the failing parser tests**

In `tests/parser.test.mjs`, change the import line to `import { SAMPLE, NESTED } from './fixtures.mjs';`, **delete** the old test `'parseOrg: nested heading stays in parent body'` (lines 55–58 — its behavior is superseded by the spec), and add:

```js
test('parseOrg: ** headings parse as children, not body', () => {
  const [a, b] = Core.parseOrg(NESTED).tasks;
  assert.equal(a.level, 1);
  assert.equal(a.children.length, 2);
  assert.deepEqual(a.body, ['  Parent notes.']);
  const [c1, c2] = a.children;
  assert.equal(c1.level, 2);
  assert.equal(c1.state, 'TODO');
  assert.equal(c1.priority, 'B');
  assert.equal(c1.title, 'Draft outline');
  assert.deepEqual(c1.tags, ['writing']);
  assert.equal(c1.deadline, '2026-07-19');
  assert.equal(c1.effort, '1h');
  assert.equal(c1.added, '2026-07-18');
  assert.deepEqual(c1.body, ['   Sub notes.']);
  assert.equal(c1.dirty, false);
  assert.equal(c2.state, 'DONE');
  assert.equal(c2.closed, '2026-07-17 Fri 10:00');
  assert.deepEqual(b.children, []);
});

test('parseOrg: *** and deeper stay verbatim in the nearest sub-task body', () => {
  const c2 = Core.parseOrg(NESTED).tasks[0].children[1];
  assert.ok(c2.body.includes('*** Deep heading stays verbatim'));
  assert.ok(c2.body.includes('    deep body'));
});

test('parseOrg: orphan ** before any * stays in preamble', () => {
  const f = Core.parseOrg('** orphan\nnotes\n* TODO real\n');
  assert.equal(f.preamble, '** orphan\nnotes\n');
  assert.equal(f.tasks.length, 1);
});

test('parseOrg: SAMPLE sub-heading is now a child task', () => {
  const c = Core.parseOrg(SAMPLE).tasks[2];
  assert.equal(c.children.length, 1);
  assert.equal(c.children[0].title, 'Sub-heading stays in body');
  assert.deepEqual(c.children[0].body, ['   body of sub']);
  assert.ok(!c.body.includes('** Sub-heading stays in body'));
});
```

Note `parseOrg: empty` still expects `deepEqual(Core.parseOrg(''), { preamble: '', tasks: [] })` — leave it; the file shape is unchanged.

- [ ] **Step 3: Extend the round-trip corpus**

In `tests/serializer.test.mjs`, change the import line to `import { SAMPLE, NESTED } from './fixtures.mjs';` and add to `CORPUS`:

```js
  NESTED,
  '* TODO parent\n** TODO child one\n   child body\n** DONE child two\n*** deep stays\n    deep body\n* TODO after\n',
  '* TODO parent\n** child no trailing newline',
  '** orphan before any task\n* TODO real\n',
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `node --test 'tests/*.test.mjs'`
Expected: FAIL — new parser tests fail (`children` is `undefined`); round-trip on nested corpus may fail once the parser changes, and currently passes — the failing set at this point is the four new parser tests.

- [ ] **Step 5: Implement the tree parser and child-aware serializer**

In `index.html` CORE, replace `HEADING_RE` and `parseHeading`:

```js
  const HEADING_RE = /^(\*{1,2})\s+(?:(TODO|NEXT|DONE)\s+)?(?:\[#([ABC])\]\s+)?(.*)$/;
```

```js
  function parseHeading(line) {
    const m = line.match(HEADING_RE);
    let title = m[4] || '';
    let tags = [];
    const tm = title.match(TAGS_RE);
    if (tm) { tags = tm[1].slice(1, -1).split(':'); title = title.slice(0, tm.index); }
    return { state: m[2] || null, priority: m[3] || null, title: title.trim(), tags };
  }
```

Replace `parseTaskBlock` with a node parser plus a splitter (rename the old body to `parseNode`; the split regex `/\n\*\* /` cannot match `***` lines because it requires star-star-space):

```js
  function parseNode(raw, level) {
    const lines = raw.replace(/\n$/, '').split('\n');
    const h = parseHeading(lines[0]);
    const t = { raw, dirty: false, level, children: [], state: h.state, priority: h.priority,
                title: h.title, tags: h.tags, deadline: null, closed: null, scheduledRaw: null,
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

  function parseTaskBlock(raw) {
    const cuts = [];
    const re = /\n\*\* /g;
    let m;
    while ((m = re.exec(raw))) cuts.push(m.index + 1);
    const t = parseNode(cuts.length ? raw.slice(0, cuts[0]) : raw, 1);
    for (let i = 0; i < cuts.length; i++) {
      t.children.push(parseNode(raw.slice(cuts[i], i + 1 < cuts.length ? cuts[i + 1] : raw.length), 2));
    }
    return t;
  }
```

`parseOrg` is unchanged. Replace `serializeFile`:

```js
  const nodeText = t => t.dirty ? renderTask(t) : t.raw;
  function serializeFile(file) {
    return file.preamble +
      file.tasks.map(t => nodeText(t) + t.children.map(nodeText).join('')).join('');
  }
```

- [ ] **Step 6: Run the full unit suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS — all files. The pre-existing serializer test `'editing one task leaves other blocks byte-identical'` must still pass: the SAMPLE sub-heading is now a child but its `raw` is written verbatim, so `out.includes('** Sub-heading stays in body')` and `out.endsWith('   body of sub\n')` still hold. If any *round-trip* assertion fails, stop and fix the parser/serializer — never the test.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/fixtures.mjs tests/parser.test.mjs tests/serializer.test.mjs
git commit -m "feat: parse ** headings as one-level child tasks, round-trip preserved"
```

---

### Task 2: Serializer — level-aware rendering, per-node dirty granularity

**Files:**
- Modify: `index.html` — CORE `renderTask` (line 216), `makeTask` (line 258)
- Test: `tests/serializer.test.mjs`

**Interfaces:**
- Consumes: Task 1's tree shape.
- Produces: `renderTask(t)` emits `'*'.repeat(t.level || 1) + ' '` as the heading prefix (planning/properties/body indentation stays the canonical 2-space regardless of level). `makeTask(fields, todayIso)` now initializes `level: 1, children: []`. All existing setters (`setState`, `setPriority`, `setTitle`, `setTags`, `setDeadline`, `setEffort`, `appendBody`) already take a task node and therefore work on children unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `tests/serializer.test.mjs`:

```js
test('renderTask: level-2 node renders ** heading', () => {
  const f = Core.parseOrg('* TODO p\n** TODO [#B] c :x:\n   DEADLINE: <2026-07-19 Sun>\n');
  const c = f.tasks[0].children[0];
  Core.setPriority(c, 'A');
  assert.equal(Core.renderTask(c), '** TODO [#A] c :x:\n  DEADLINE: <2026-07-19 Sun>\n');
});

test('editing one child re-renders only that child', () => {
  const f = Core.parseOrg(NESTED);
  Core.setPriority(f.tasks[0].children[0], 'C');
  const out = Core.serializeFile(f);
  assert.ok(out.startsWith('#+TITLE: Nested\n\n* NEXT [#A] Ship quarterly report :work:\n'));
  assert.ok(out.includes('** TODO [#C] Draft outline :writing:\n'));
  assert.ok(out.includes('** DONE Collect figures\n   CLOSED: [2026-07-17 Fri 10:00]\n*** Deep heading stays verbatim\n    deep body\n'));
  assert.ok(out.endsWith('* TODO Plain task\n'));
});

test('editing the parent leaves children verbatim', () => {
  const f = Core.parseOrg(NESTED);
  Core.setState(f.tasks[0], 'TODO');
  const out = Core.serializeFile(f);
  assert.ok(out.includes('* TODO [#A] Ship quarterly report :work:\n'));
  assert.ok(out.includes('** TODO [#B] Draft outline :writing:\n   DEADLINE: <2026-07-19 Sun>\n'));
});

test('makeTask initializes level 1 with empty children', () => {
  const t = Core.makeTask({ title: 'x' }, '2026-07-18');
  assert.equal(t.level, 1);
  assert.deepEqual(t.children, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/serializer.test.mjs`
Expected: FAIL — `renderTask` emits `* ` for the child (single star), `makeTask` has no `level`.

- [ ] **Step 3: Implement**

In `renderTask`, replace `let head = '* ';` with:

```js
    let head = '*'.repeat(t.level || 1) + ' ';
```

In `makeTask`, replace the object literal's first line so it reads:

```js
    const t = { raw: '', dirty: true, level: 1, children: [], state: 'TODO', priority: fields.priority || null,
                title: fields.title, tags: fields.tags || [], deadline: fields.deadline || null,
                closed: null, scheduledRaw: null, propLines: [], body: [],
                added: todayIso, effort: null };
```

- [ ] **Step 4: Run the full unit suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/serializer.test.mjs
git commit -m "feat: level-aware renderTask; child edits rewrite only the touched node"
```

---

### Task 3: Mutations — `addTask`, sibling-scoped `moveTask`

**Files:**
- Modify: `index.html` — CORE `moveTask` (line 268) and a new `addTask` next to it; add `addTask` to the IIFE `return {...}` (line 349)
- Test: `tests/serializer.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `moveTask(file, from, to, parent)` — 4th arg optional; with `parent` (a level-1 task object) it reorders `parent.children`, without it `file.tasks` (existing 3-arg callers unaffected); returns boolean as before. `addTask(file, parent, t)` — appends `t` to `parent.children` (setting `t.level = 2`) or, with `parent = null`, to `file.tasks` (setting `t.level = 1`); returns `t`. Both end with a private `normalizeNewlines(file)` that appends `\n` to any node `raw` missing it (only the file's last node can lack one; without this, appending or moving after it would glue two headings onto one line).

- [ ] **Step 1: Write the failing tests**

Add to `tests/serializer.test.mjs`:

```js
test('moveTask: moving a parent carries its subtree', () => {
  const f = Core.parseOrg('* TODO a\n** TODO a1\n* TODO b\n');
  assert.equal(Core.moveTask(f, 0, 1), true);
  assert.equal(Core.serializeFile(f), '* TODO b\n* TODO a\n** TODO a1\n');
});

test('moveTask: sibling-scoped move within a parent', () => {
  const f = Core.parseOrg('* TODO p\n** TODO c1\n** TODO c2\n* TODO q\n');
  const p = f.tasks[0];
  assert.equal(Core.moveTask(f, 1, 0, p), true);
  assert.equal(Core.serializeFile(f), '* TODO p\n** TODO c2\n** TODO c1\n* TODO q\n');
  assert.equal(Core.moveTask(f, 0, 2, p), false);   // out of range among 2 children
});

test('moveTask: last child without trailing newline is normalized', () => {
  const f = Core.parseOrg('* TODO p\n** TODO c1\n** TODO c2');
  Core.moveTask(f, 1, 0, f.tasks[0]);
  assert.equal(Core.serializeFile(f), '* TODO p\n** TODO c2\n** TODO c1\n');
});

test('addTask: appends a level-2 child and fixes missing trailing newline', () => {
  const f = Core.parseOrg('* TODO p');
  const t = Core.addTask(f, f.tasks[0], Core.makeTask({ title: 'sub' }, '2026-07-18'));
  assert.equal(t.level, 2);
  assert.equal(Core.serializeFile(f),
    '* TODO p\n** TODO sub\n  :PROPERTIES:\n  :ADDED:   [2026-07-18 Sat]\n  :END:\n');
});

test('addTask: null parent appends top-level', () => {
  const f = Core.parseOrg('');
  Core.addTask(f, null, Core.makeTask({ title: 'x' }, '2026-07-18'));
  assert.equal(Core.serializeFile(f),
    '* TODO x\n  :PROPERTIES:\n  :ADDED:   [2026-07-18 Sat]\n  :END:\n');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/serializer.test.mjs`
Expected: FAIL — `Core.addTask is not a function`; sibling-scoped `moveTask` reorders `file.tasks` instead of children.

- [ ] **Step 3: Implement**

Replace `moveTask` in CORE with:

```js
  function normalizeNewlines(file) {
    for (const t of file.tasks) {
      if (t.raw && !t.raw.endsWith('\n')) t.raw += '\n';
      for (const c of t.children) if (c.raw && !c.raw.endsWith('\n')) c.raw += '\n';
    }
  }
  function moveTask(file, from, to, parent) {
    const list = parent ? parent.children : file.tasks;
    if (to < 0 || to >= list.length || from === to) return false;
    const [t] = list.splice(from, 1);
    list.splice(to, 0, t);
    normalizeNewlines(file);
    return true;
  }
  function addTask(file, parent, t) {
    t.level = parent ? 2 : 1;
    (parent ? parent.children : file.tasks).push(t);
    normalizeNewlines(file);
    return t;
  }
```

Add `addTask` to the IIFE's `return {...}` list (after `makeTask, moveTask,`).

- [ ] **Step 4: Run the full unit suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS (the pre-existing `moveTask` test uses the 3-arg form and still passes).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/serializer.test.mjs
git commit -m "feat: addTask and sibling-scoped moveTask with newline normalization"
```

---

### Task 4: View model — sub-task refs, radar, family filter

**Files:**
- Modify: `index.html` — CORE `buildModel` (line 307), new `matchesFamily` after `matchesFilter` (line 343); add `matchesFamily` to the IIFE `return {...}`
- Test: `tests/model.test.mjs`

**Interfaces:**
- Consumes: tree shape from Task 1.
- Produces: `buildModel(files, today)` returns the same `{ radar, backlogByTopic, done }` shape, but refs now come in two forms: top-level `{ topic, index, task }` and sub-task `{ topic, index, ci, task, parent }` where `parent` is the parent *task object* and `ci` the child index. `radar` may contain both forms (same qualification rule: `NEXT` or deadline ≤ today+7; same sort). `backlogByTopic` and `done` contain **top-level refs only**. `matchesFamily(r, flt, today)` = `matchesFilter(r, …)` OR any child of `r.task` matches on its own fields.

- [ ] **Step 1: Write the failing tests**

Add to `tests/model.test.mjs`:

```js
test('buildModel: qualifying sub-tasks get their own radar refs with parent', () => {
  const f = mk('* TODO p1\n** NEXT c1\n** TODO c2\n   DEADLINE: <2026-07-19 Sun>\n* NEXT p2\n');
  const m = Core.buildModel([{ topic: 'w', file: f }], T);
  assert.deepEqual(m.radar.map(r => r.task.title), ['c2', 'c1', 'p2']);
  assert.equal(m.radar[0].parent.title, 'p1');
  assert.equal(m.radar[0].ci, 1);
  assert.deepEqual(m.backlogByTopic.map(([t, l]) => [t, l.map(r => r.task.title)]),
                   [['w', ['p1']]]);   // backlog lists top-level refs only
});

test('buildModel: done lists only top-level DONE; children of DONE parents can hit radar', () => {
  const f = mk('* DONE p\n  CLOSED: [2026-07-10 Fri 09:15]\n** NEXT c\n');
  const m = Core.buildModel([{ topic: 'w', file: f }], T);
  assert.deepEqual(m.done.map(r => r.task.title), ['p']);
  assert.deepEqual(m.radar.map(r => r.task.title), ['c']);
  assert.equal(m.backlogByTopic.length, 0);
});

test('matchesFamily: parent passes when only a child matches', () => {
  const f = mk('* TODO p\n** TODO c :urgent:\n');
  const r = { topic: 'w', index: 0, task: f.tasks[0] };
  assert.ok(!Core.matchesFilter(r, { tag: 'urgent' }, T));
  assert.ok(Core.matchesFamily(r, { tag: 'urgent' }, T));
  assert.ok(!Core.matchesFamily(r, { tag: 'other' }, T));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/model.test.mjs`
Expected: FAIL — radar misses `c1`/`c2` (no sub refs), `Core.matchesFamily is not a function`.

- [ ] **Step 3: Implement**

Replace the ref-collection and filtering part of `buildModel` so it reads:

```js
  function buildModel(files, today) {
    const horizon = addDays(today, 7);
    const refs = [];
    for (const f of files) f.file.tasks.forEach((task, index) => {
      refs.push({ topic: f.topic, index, task });
      task.children.forEach((child, ci) =>
        refs.push({ topic: f.topic, index, ci, task: child, parent: task }));
    });
    const open = refs.filter(r => r.task.state !== 'DONE');
    const done = refs.filter(r => !r.parent && r.task.state === 'DONE');
    const radar = open.filter(r => r.task.state === 'NEXT' || (r.task.deadline && r.task.deadline <= horizon));
    radar.sort((a, b) => {
      const ad = a.task.deadline || '9999', bd = b.task.deadline || '9999';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return priRank(a.task.priority) - priRank(b.task.priority);
    });
    const radarSet = new Set(radar);
    const backlogByTopic = [];
    for (const f of files) {
      const list = open.filter(r => !r.parent && r.topic === f.topic && !radarSet.has(r));
      if (list.length) backlogByTopic.push([f.topic, list]);
    }
    return { radar, backlogByTopic, done };
  }
```

Add after `matchesFilter`:

```js
  function matchesFamily(r, flt, today) {
    if (matchesFilter(r, flt, today)) return true;
    return r.task.children.some(c => matchesFilter({ topic: r.topic, task: c }, flt, today));
  }
```

Add `matchesFamily` to the IIFE `return {...}` (after `matchesFilter`).

- [ ] **Step 4: Run the full unit suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS (existing model tests unaffected: their fixtures have no `** ` headings).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/model.test.mjs
git commit -m "feat: sub-task refs in the view model, own radar rows, family filter"
```

---

### Task 5: APP plumbing — identity, key-path mutations, move & drag within parent

**Files:**
- Modify: `index.html` — APP: `refKey` (line 381), new `keyPath` beside it, `mutateTask` (line 680), `withSel` (line 689), the `s`/`t`/`E`/`e` handlers (lines 838–890), the paste handler (line 920), Alt+↑/↓ (lines 815–826), the drop handler (lines 599–616), quick-add submit (line 728)

**Interfaces:**
- Consumes: `Core.addTask`, `Core.moveTask(file, from, to, parent)`, refs with optional `parent` task object.
- Produces: `refKey(r)` = `topic \t [parentKey \t] taskKey` (2 or 3 segments). `keyPath(r)` returns `[taskKey(r.task)]` or `[taskKey(r.parent), taskKey(r.task)]`. `mutateTask(topic, path, fn)` takes the array form only — every caller updated in this task. No unit tests (APP is e2e-tested in Task 8); the unit suite must stay green.

- [ ] **Step 1: Update identity helpers**

Replace `refKey` (keep the tab-separator comment above it):

```js
function refKey(r) {
  return r.topic + '\t' + (r.parent ? taskKey(r.parent) + '\t' : '') + taskKey(r.task);
}
function keyPath(r) {
  return r.parent ? [taskKey(r.parent), taskKey(r.task)] : [taskKey(r.task)];
}
```

- [ ] **Step 2: Key-path mutateTask and call sites**

Replace `mutateTask` and `withSel`:

```js
async function mutateTask(topic, path, fn) {
  const entry = findEntry(topic);
  if (!entry) return;
  await saveFile(entry, file => {
    let t = file.tasks.find(x => taskKey(x) === path[0]);
    if (t && path.length > 1) t = t.children.find(c => taskKey(c) === path[1]);
    if (t) fn(t, file);
  });
}
function selRef() { return App.visible.find(r => refKey(r) === App.sel) || null; }
async function withSel(fn) {
  const r = selRef();
  if (r) await mutateTask(r.topic, keyPath(r), fn);
}
```

In the four inline-editor handlers (`s`, `t`, `E`, `e`) and the paste handler, replace every `mutateTask(r.topic, taskKey(r.task), …)` with `mutateTask(r.topic, keyPath(r), …)` (5 call sites).

- [ ] **Step 3: Alt+↑/↓ moves within the sibling list**

Replace the body of the Alt-arrow branch's `saveFile` callback:

```js
    await saveFile(entry, file => {
      if (r.parent) {
        const p = file.tasks.find(t => taskKey(t) === taskKey(r.parent));
        if (!p) return;
        const i = p.children.findIndex(c => taskKey(c) === taskKey(r.task));
        if (i > -1) Core.moveTask(file, i, i + delta, p);
      } else {
        const i = file.tasks.findIndex(t => taskKey(t) === taskKey(r.task));
        if (i > -1) Core.moveTask(file, i, i + delta);
      }
    });
```

- [ ] **Step 4: Drag-and-drop within one parent**

Replace `row.ondrop` (this drops the string-slicing of `rk` — both rows are on screen, so resolve refs from `App.visible` instead; delete the old `// refKey is topic + '\t' + heading line…` comment):

```js
  row.ondrop = async e => {
    e.preventDefault();
    const fromRk = e.dataTransfer.getData('text/plain');
    const toRk = row.dataset.rk;
    if (!fromRk || fromRk === toRk) return;
    const from = App.visible.find(r => refKey(r) === fromRk);
    const to = App.visible.find(r => refKey(r) === toRk);
    if (!from || !to) return;
    if (from.topic !== to.topic) { toast('Drag within one topic'); return; }
    const fromParent = from.parent ? taskKey(from.parent) : null;
    const toParent = to.parent ? taskKey(to.parent) : null;
    if (fromParent !== toParent) { toast('Drag within one parent'); return; }
    const entry = findEntry(from.topic);
    await saveFile(entry, file => {
      let list = file.tasks, parent = null;
      if (fromParent) {
        parent = file.tasks.find(t => taskKey(t) === fromParent);
        if (!parent) return;
        list = parent.children;
      }
      const fi = list.findIndex(t => taskKey(t) === taskKey(from.task));
      const ti = list.findIndex(t => taskKey(t) === taskKey(to.task));
      if (fi > -1 && ti > -1) Core.moveTask(file, fi, ti, parent);
    });
  };
```

- [ ] **Step 5: Quick-add goes through addTask**

In the quick-add Enter handler, replace
`await saveFile(entry, file => { file.tasks.push(Core.makeTask(p, todayIso())); });` with:

```js
  await saveFile(entry, file => { Core.addTask(file, null, Core.makeTask(p, todayIso())); });
```

- [ ] **Step 6: Verify the unit suite is still green**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS (this task touches only APP).

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: key-path identity and mutations; sibling-scoped move and drag"
```

---

### Task 6: Rendering — nested rows, radar context label, family filters

**Files:**
- Modify: `index.html` — CSS (after `.task.sel`, line 20), `render()` (lines 508–534), `taskRow` (line 559) plus new `taskRows`/`rowsFor` helpers

**Interfaces:**
- Consumes: `Core.matchesFamily`, model refs with `parent`/`ci`, `refKey` from Task 5.
- Produces: `taskRow(ref, mode)` — `mode` is `undefined` (top-level), `'sub'` (indented child row), or `'ctx'` (standalone radar sub row with `Parent › ` prefix). `taskRows(ref)` returns `[parentRow, ...childRows]`. `rowsFor(r)` picks per ref: `r.parent ? [taskRow(r, 'ctx')] : taskRows(r)`. Every list render goes through `rowsFor` so children appear wherever their parent row appears (radar, backlog, done, recent).

- [ ] **Step 1: CSS**

Add after the `.task.sel` rule:

```css
.task.sub { margin-left:28px; }
.parent-ctx { color:var(--muted); }
```

- [ ] **Step 2: taskRow mode + row helpers**

In `taskRow`, change the signature to `function taskRow(ref, mode)`, change the row creation line to:

```js
  const row = div('task' + (mode === 'sub' ? ' sub' : ''));
```

and replace the title lines with:

```js
  const title = div('title');
  if (mode === 'ctx' && ref.parent) {
    const c = span('parent-ctx');
    c.textContent = ref.parent.title + ' › ';
    title.append(c, document.createTextNode(t.title || '(untitled)'));
  } else {
    title.textContent = t.title || '(untitled)';
  }
```

Everything else in `taskRow` (chips, drag, expand/body) stays as is. Add after `taskRow`:

```js
function taskRows(ref) {
  const rows = [taskRow(ref)];
  ref.task.children.forEach((c, ci) =>
    rows.push(taskRow({ topic: ref.topic, index: ref.index, ci, task: c, parent: ref.task }, 'sub')));
  return rows;
}
const rowsFor = r => r.parent ? [taskRow(r, 'ctx')] : taskRows(r);
```

(Do not pass `taskRows`/`taskRow` directly as a `flatMap`/`map` callback anywhere — the index argument would land in `mode`. Always go through `rowsFor`.)

- [ ] **Step 3: render() — family filters and rowsFor**

In `render()`, replace the filtering block with:

```js
  const pass = r => Core.matchesFilter(r, App.filter, today);
  const passFam = r => Core.matchesFamily(r, App.filter, today);
  let radar = model.radar.filter(r => r.parent ? pass(r) : passFam(r));
  let groups = model.backlogByTopic.map(([t, l]) => [t, l.filter(passFam)]).filter(([, l]) => l.length);
  const done = model.done.filter(passFam);
```

and the three list renders with:

```js
  $('#radar-list').replaceChildren(...radar.flatMap(rowsFor));
```

```js
    bl.push(h, ...list.flatMap(rowsFor));
```

```js
  $('#done-list').replaceChildren(...(showDone ? done.flatMap(rowsFor) : []));
```

The `recent` branch is unchanged — its flattened list may contain sub refs from the radar, and `rowsFor` renders those as `'ctx'` rows.

- [ ] **Step 4: Verify unit suite + manual smoke**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

Manual (optional if no display available; Task 8's e2e covers it): open the app on `sample-tasks/`, confirm the existing `** Sub-heading stays in body` in `work.org` now renders as an indented row under its parent, is selectable with `j`/`k`, and `d` strikes it through in place.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: render sub-task rows nested under parents and labeled on the radar"
```

---

### Task 7: Create sub-tasks — `A` shortcut and help text

**Files:**
- Modify: `index.html` — keyboard handler (add the `A` branch after the `e` branch, line ~890), help overlay table (after the `a` row, line 105), help "Adding tasks" prose (line 97–99 area)

**Interfaces:**
- Consumes: `inlineEdit`, `Core.parseQuickAdd`, `Core.makeTask`, `Core.addTask`, `keyPath`/`selRef` from Task 5.
- Produces: pressing `A` with a row selected opens the inline editor under it; the committed line is parsed with `parseQuickAdd` (any `topic:` token is ignored — only title/priority/tags/deadline/effort are used) and appended as a `** TODO` to the selected task's children — or to the *parent's* children when a sub-task is selected (sibling).

- [ ] **Step 1: Add the `A` keyboard branch**

Insert after the closing brace of the `if (k === 'e') {…}` branch, inside the same keydown listener:

```js
  if (k === 'A') {
    e.preventDefault();   // don't type the triggering key into the editor input
    const r = selRef();
    if (!r) return;
    const parentKey = r.parent ? taskKey(r.parent) : taskKey(r.task);
    inlineEdit('', 'sub-task: title #A :tag: @date ~2h', async v => {
      const p = Core.parseQuickAdd(v, todayIso());
      if (!p.title) { toast('Title required'); return; }
      const entry = findEntry(r.topic);
      await saveFile(entry, file => {
        const parent = file.tasks.find(t => taskKey(t) === parentKey);
        if (parent) Core.addTask(file, parent, Core.makeTask(p, todayIso()));
      });
    });
    return;
  }
```

- [ ] **Step 2: Help overlay**

In the shortcut table, insert after the `a` row:

```html
<tr><td><kbd>A</kbd></td><td>add sub-task under the selected task</td></tr>
```

In the "Adding tasks" section, add after the token table (before the screenshot paragraph):

```html
<p>Press <kbd>A</kbd> on a selected task to add a sub-task (<code>** TODO</code>,
one level deep) under it — same tokens, no topic. Sub-tasks show indented under
their parent and get their own radar rows when they qualify.</p>
```

- [ ] **Step 3: Verify unit suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: A shortcut creates a sub-task under the selection"
```

---

### Task 8: E2E coverage, sample fixture, docs, full verification

**Files:**
- Modify: `tests/ui-e2e.mjs` (add checks before `ws.close()`)
- Modify: `sample-tasks/work.org` (LOCAL ONLY — never staged; it has unrelated user edits)
- Modify: `README.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: green `node --test 'tests/*.test.mjs'` and `node tests/ui-e2e.mjs`; updated docs.

- [ ] **Step 1: Extend the e2e script**

In `tests/ui-e2e.mjs`, insert before `ws.close();`:

```js
// --- sub-tasks: A creates a ** TODO under the selected parent ---
await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Garage cleanup');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
  return App.sel;
})()`);
await key('A', 'KeyA', 'A', 65);
await sleep(250);
check('A opens the sub-task editor', await evaljs(`!!document.querySelector('.editor input')`));
await cdp('Input.insertText', { text: 'Sort tools #B' });
await key('Enter', 'Enter', '\r', 13);
await sleep(500);
const afterA = await evaljs(`__files.get('home.org')`);
check('sub-task is written nested under its parent',
      afterA.includes('* TODO Garage cleanup\n** TODO [#B] Sort tools'), JSON.stringify(afterA));

// --- toggle sub-task state without touching the parent ---
await evaljs(`(() => {
  const r = App.visible.find(r => r.parent && r.task.title === 'Sort tools');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
  return App.sel;
})()`);
await key('d', 'KeyD', 'd', 68);
await sleep(500);
const afterD = await evaljs(`__files.get('home.org')`);
check('d marks the sub-task DONE with CLOSED', afterD.includes('** DONE [#B] Sort tools'), JSON.stringify(afterD));
check('parent block is untouched by the child edit',
      afterD.includes('* TODO Garage cleanup\n** DONE'), JSON.stringify(afterD));
```

- [ ] **Step 2: Run the e2e**

Run: `node tests/ui-e2e.mjs`
Expected: `all e2e checks passed`, exit 0 (or `SKIP` if Chrome is absent — then note that in the final report instead of claiming a pass).

- [ ] **Step 3: Sample fixture (local only)**

Append to `sample-tasks/work.org` (do NOT `git add` this file):

```org
* TODO Plan team offsite :planning:
** NEXT Book venue
   DEADLINE: <2026-07-24 Fri>
** TODO Draft agenda ~1h
** DONE Poll for dates
   CLOSED: [2026-07-16 Thu 11:00]
```

- [ ] **Step 4: Update README.md**

In the **Data format** section, extend the example and add one sentence, so lines 22–31 become:

```markdown
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
```

In the **Keyboard** highlights sentence, add `· \`A\` add sub-task` after `` `e` edit heading ``.

- [ ] **Step 5: Update CLAUDE.md**

In the **Data flow** section:
- After the first bullet's `file order = task order.` add: `` `** ` headings (one level) are sub-tasks with the same fields; `***`+ stays verbatim body. Radar rows can be sub-tasks too.``
- Replace the identity bullet's `refKey(r)` sentence with: `` `refKey(r)` = `topic + '\t' + taskKey` for top-level tasks, `topic + '\t' + parentKey + '\t' + childKey` for sub-tasks. Two identical headings under one parent (or two identical top-level headings) are indistinguishable (known limitation).``

In **Known accepted limitations**, replace `Same-topic-only drag-and-drop` with `Same-parent-only drag-and-drop and reordering (no re-parenting)` and `duplicate headings collide` with `duplicate sibling headings collide`.

- [ ] **Step 6: Full verification**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS, 0 failures.

Run: `node tests/ui-e2e.mjs`
Expected: `all e2e checks passed` (or SKIP without Chrome).

Run: `git status --porcelain`
Expected: only `sample-tasks/*.org` modified (unstaged, intentionally uncommitted).

- [ ] **Step 7: Commit**

```bash
git add tests/ui-e2e.mjs README.md CLAUDE.md
git commit -m "test: e2e for sub-task create/toggle; document nested tasks"
```
