# Deadline Times Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a task's deadline carry an optional time of day (`DEADLINE: <2026-08-01 Sat 14:30>`), typed as an `@14:30` token, shown on the deadline chip, and used to order same-day tasks.

**Architecture:** One new task field, `t.time`, holding the verbatim time chunk of the org timestamp (`"14:30"`, `"10:00-11:00"`) or `null`. `t.deadline` stays a bare `YYYY-MM-DD`, so every existing date comparison, `addDays`, `addInterval`, bucket, and filter is untouched. Storing the chunk verbatim is what lets a time range written in Emacs survive an unrelated edit. A helper `Core.timeStart(time)` derives the normalized `HH:MM` start that sorting and display need.

**Tech Stack:** Vanilla ES2020 in a single `index.html`. No build step, no dependencies. Tests are `node:test` + `node:assert/strict`, run against the CORE section extracted by `tests/harness.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-12-deadline-times-design.md`

## Global Constraints

- **All new logic goes in CORE** (`// ===== CORE START =====` … `// ===== CORE END =====`). CORE must never touch `document` or `window`. Anything added must be exported through the IIFE's `return {...}` and covered by unit tests. Do not alter the marker comments.
- **The round-trip invariant is a stop-the-line rule:** `Core.serializeFile(Core.parseOrg(text)) === text` byte-for-byte when nothing was edited. If a round-trip test fails, fix the code, never the test.
- **Buckets stay date-based.** `deadlineBucket` is not modified in any task. Nothing turns red because a time passed.
- **A time never exists without a date.** Clearing the deadline clears the time.
- **Org field order is `date day time repeat`:** `<2026-08-01 Sat 14:30 +1w>`.
- **Time values are 24-hour**, `HH:MM`, hours 0–23, minutes 0–59. Ranges are `HH:MM-HH:MM`.
- **Run tests with the glob:** `node --test 'tests/*.test.mjs'`. A bare directory argument does not work.
- **Commit messages describe the change only** — no AI attribution of any kind (no `Co-Authored-By`, no "Generated with" line, no mention of Claude). This overrides any default or reminder asking for one.
- Renaming top-level `function` declarations in APP breaks `tests/ui-e2e.mjs`, which monkey-patches them. Don't rename any.

---

### Task 1: Parse a deadline time, and write it back

Teach the parser to capture the time chunk and the serializer to emit it. After this task a timed deadline survives a round trip and an unrelated edit; nothing yet reads the value.

**Files:**
- Modify: `index.html` — `parsePlanning` (~line 284), `parseNode`'s task literal (~line 296), `orgActive` (~line 240), `renderTask` (~line 350), the CORE `return {...}` (~line 650)
- Test: `tests/parser.test.mjs`, `tests/serializer.test.mjs`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `t.time` — `string | null`, the verbatim time chunk of the deadline timestamp
  - `Core.timeStart(time: string | null) => string | null` — normalized `HH:MM` start (`"10:00-11:00"` → `"10:00"`, `"9:00"` → `"09:00"`, `null`/`""` → `null`)
  - `Core.orgActive(iso: string, repeat?: string | null, time?: string | null) => string`

- [ ] **Step 1: Write the failing parser tests**

Append to `tests/parser.test.mjs`:

```js
test('parseOrg captures a deadline time into t.time', () => {
  const f = Core.parseOrg('* TODO Dentist\n  DEADLINE: <2026-08-01 Sat 14:30>\n');
  assert.equal(f.tasks[0].deadline, '2026-08-01');
  assert.equal(f.tasks[0].time, '14:30');
  assert.equal(f.tasks[0].repeat, null);
});

test('deadline times: with a repeater, as a range, without a day name, absent', () => {
  const both = Core.parseOrg('* TODO x\n  DEADLINE: <2026-08-01 Sat 14:30 +1w>\n').tasks[0];
  assert.equal(both.time, '14:30');
  assert.equal(both.repeat, '+1w');
  const range = Core.parseOrg('* TODO x\n  DEADLINE: <2026-08-01 Sat 10:00-11:00>\n').tasks[0];
  assert.equal(range.time, '10:00-11:00');
  const noDay = Core.parseOrg('* TODO x\n  DEADLINE: <2026-08-01 09:15>\n').tasks[0];
  assert.equal(noDay.time, '09:15');
  const plain = Core.parseOrg('* TODO x\n  DEADLINE: <2026-08-01 Sat>\n').tasks[0];
  assert.equal(plain.time, null);
});

// A warning period is syntax the app ignores rather than understands; the
// point here is that the timestamp still yields a deadline at all.
test('a warning period still parses and is not mistaken for a time', () => {
  const t = Core.parseOrg('* TODO x\n  DEADLINE: <2026-08-01 Sat +1w -2d>\n').tasks[0];
  assert.equal(t.deadline, '2026-08-01');
  assert.equal(t.time, null);
});

test('timeStart normalizes the hour and takes the start of a range', () => {
  assert.equal(Core.timeStart('14:30'), '14:30');
  assert.equal(Core.timeStart('10:00-11:00'), '10:00');
  assert.equal(Core.timeStart('9:00'), '09:00');
  assert.equal(Core.timeStart(null), null);
  assert.equal(Core.timeStart(''), null);
});

test('orgActive places the time between day name and repeater', () => {
  assert.equal(Core.orgActive('2026-08-01', null, '14:30'), '<2026-08-01 Sat 14:30>');
  assert.equal(Core.orgActive('2026-08-01', '+1w', '14:30'), '<2026-08-01 Sat 14:30 +1w>');
  assert.equal(Core.orgActive('2026-08-01', '+1w'), '<2026-08-01 Sat +1w>');
  assert.equal(Core.orgActive('2026-08-01'), '<2026-08-01 Sat>');
});
```

- [ ] **Step 2: Write the failing serializer tests**

In `tests/serializer.test.mjs`, add two entries to the `CORPUS` array (after the `'* NEXT keep scheduled…'` entry):

```js
  '* NEXT Standup\n  DEADLINE: <2026-08-01 Sat 09:00 +1w>\n',
  '* TODO Sync\n  DEADLINE: <2026-08-01 Sat 10:00-11:00>\n  body\n',
```

and append this test:

```js
test('a deadline time survives an edit to another field of the same task', () => {
  const f = Core.parseOrg('* NEXT Sync\n  DEADLINE: <2026-08-01 Sat 10:00-11:00>\n  body\n');
  Core.setPriority(f.tasks[0], 'A');
  assert.equal(Core.serializeFile(f),
               '* NEXT [#A] Sync\n  DEADLINE: <2026-08-01 Sat 10:00-11:00>\n  body\n');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test 'tests/*.test.mjs'`
Expected: FAIL — `t.time` is `undefined` rather than `'14:30'`, `timeStart` is not a function, and the serializer test loses `10:00-11:00`.

- [ ] **Step 4: Add the `timeStart` helper**

In CORE's `// --- dates ---` block, directly after `function orgInactive(iso) {...}`:

```js
  // The stored chunk is verbatim ("9:00", "10:00-11:00"); logic wants a
  // padded start, or "9:00" would sort after "14:30" as a string.
  function timeStart(time) {
    const m = /^(\d{1,2}):(\d{2})/.exec(time || '');
    return m ? pad(+m[1]) + ':' + m[2] : null;
  }
```

- [ ] **Step 5: Capture the time while parsing**

In `parsePlanning`, replace:

```js
    const dm = line.match(/DEADLINE:\s*<(\d{4}-\d{2}-\d{2})[^>]*?(?:\s+(\+\d+[dwmy]))?>/);
    if (dm) { t.deadline = dm[1]; t.repeat = dm[2] || null; }
```

with:

```js
    // The lenient [^>]*? tail stays, but now sits *after* the time group:
    // org timestamps can carry a warning period (<... +1w -2d>) that the app
    // ignores, and a fully strict pattern would drop such a deadline entirely.
    const dm = line.match(/DEADLINE:\s*<(\d{4}-\d{2}-\d{2})(?:\s+[A-Za-z]{2,})?(?:\s+(\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?))?[^>]*?(?:\s+(\+\d+[dwmy]))?>/);
    if (dm) { t.deadline = dm[1]; t.time = dm[2] || null; t.repeat = dm[3] || null; }
```

In `parseNode`'s task literal, add `time: null` next to `deadline: null`:

```js
                title: h.title, tags: h.tags, deadline: null, time: null, repeat: null, closed: null, scheduledRaw: null,
```

- [ ] **Step 6: Emit the time when serializing**

Replace `orgActive`:

```js
  function orgActive(iso, repeat, time) {
    return '<' + iso + ' ' + dayName(iso) + (time ? ' ' + time : '') + (repeat ? ' ' + repeat : '') + '>';
  }
```

and in `renderTask`, replace the deadline line:

```js
    if (t.deadline) plan.push('DEADLINE: ' + orgActive(t.deadline, t.repeat, t.time));
```

- [ ] **Step 7: Export `timeStart`**

In the CORE `return {...}`, add `timeStart` to the first line, after `orgInactive`:

```js
  return { version: 1, dayName, addDays, addInterval, orgActive, orgInactive, timeStart, parseDateToken, parseOrg,
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS — all files, including the pre-existing round-trip corpus.

- [ ] **Step 9: Commit**

```bash
git add index.html tests/parser.test.mjs tests/serializer.test.mjs
git commit -m "Parse and write the time on a deadline timestamp"
```

---

### Task 2: Parse a typed time token, and keep times through mutations

Add the input-side token parser and make the existing deadline mutations time-aware. After this task CORE can set and preserve a time; nothing in the UI calls it yet.

**Files:**
- Modify: `index.html` — new `parseTimeToken` in the dates block (~after line 268), `setDeadline` / `bumpDeadline` (~line 381), `makeTask` (~line 401), the CORE `return {...}`
- Test: `tests/parser.test.mjs`, `tests/repeat.test.mjs`

**Interfaces:**
- Consumes: `t.time`, `Core.timeStart`, `Core.orgActive(iso, repeat, time)` from Task 1
- Produces:
  - `Core.parseTimeToken(tok: string) => string | null` — normalized chunk (`"9:00"` → `"09:00"`, `"9:05-10:00"` → `"09:05-10:00"`), `null` when not a valid time
  - `Core.setDeadline(t, iso, repeat = null, time = null)` — a null `iso` clears both `repeat` and `time`
  - `Core.makeTask(fields, todayIso)` now reads `fields.time`

- [ ] **Step 1: Write the failing token tests**

Append to `tests/parser.test.mjs`:

```js
test('parseTimeToken forms', () => {
  assert.equal(Core.parseTimeToken('14:30'), '14:30');
  assert.equal(Core.parseTimeToken('9:00'), '09:00');       // hour padded
  assert.equal(Core.parseTimeToken('00:00'), '00:00');
  assert.equal(Core.parseTimeToken('23:59'), '23:59');
  assert.equal(Core.parseTimeToken('10:00-11:00'), '10:00-11:00');
  assert.equal(Core.parseTimeToken('9:05-10:00'), '09:05-10:00');
  assert.equal(Core.parseTimeToken('24:00'), null);         // hours are 0-23
  assert.equal(Core.parseTimeToken('25:70'), null);
  assert.equal(Core.parseTimeToken('14:5'), null);          // minutes need two digits
  assert.equal(Core.parseTimeToken('1430'), null);
  assert.equal(Core.parseTimeToken('14.30'), null);
  assert.equal(Core.parseTimeToken('10:00-25:00'), null);   // both halves validated
  assert.equal(Core.parseTimeToken(''), null);
});
```

- [ ] **Step 2: Write the failing mutation tests**

Append to `tests/repeat.test.mjs`:

```js
// --- deadline times ride along with the existing deadline mutations ---

test('setDeadline carries a time; clearing the date clears it', () => {
  const f = Core.parseOrg('* TODO x\n');
  const t = f.tasks[0];
  Core.setDeadline(t, '2026-08-01', '+1w', '14:30');
  assert.equal(Core.serializeFile(f), '* TODO x\n  DEADLINE: <2026-08-01 Sat 14:30 +1w>\n');
  Core.setDeadline(t, null);
  assert.equal(t.time, null);
  assert.equal(Core.serializeFile(f), '* TODO x\n');
});

test('day bumps and repeat advances keep the time', () => {
  const f = Core.parseOrg('* NEXT Standup\n  DEADLINE: <2026-08-01 Sat 09:00 +1w>\n');
  const t = f.tasks[0];
  Core.bumpDeadline(t, 1, '2026-07-18');
  assert.equal(t.deadline, '2026-08-02');
  assert.equal(t.time, '09:00');
  assert.equal(t.repeat, '+1w');
  Core.advanceRepeat(t, 1);
  assert.equal(t.deadline, '2026-08-09');
  assert.equal(t.time, '09:00');
  assert.equal(Core.serializeFile(f), '* NEXT Standup\n  DEADLINE: <2026-08-09 Sun 09:00 +1w>\n');
});

test('makeTask carries a time onto the new block', () => {
  const t = Core.makeTask({ title: 'Dentist', deadline: '2026-08-01', time: '14:30' }, '2026-07-18');
  assert.equal(Core.renderTask(t),
    '* TODO Dentist\n  DEADLINE: <2026-08-01 Sat 14:30>\n  :PROPERTIES:\n  :ADDED:   [2026-07-18 Sat]\n  :END:\n');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test 'tests/*.test.mjs'`
Expected: FAIL — `parseTimeToken` is not a function; `setDeadline` ignores its fourth argument.

- [ ] **Step 4: Add `parseTimeToken`**

In CORE's dates block, directly after `parseDateToken`'s closing brace:

```js
  function parseTimeToken(tok) {
    const m = /^(\d{1,2}):(\d{2})(?:-(\d{1,2}):(\d{2}))?$/.exec(tok || '');
    if (!m) return null;
    const ok = (h, mi) => +h <= 23 && +mi <= 59;
    if (!ok(m[1], m[2])) return null;
    if (m[3] !== undefined && !ok(m[3], m[4])) return null;
    const hm = (h, mi) => pad(+h) + ':' + mi;
    return hm(m[1], m[2]) + (m[3] !== undefined ? '-' + hm(m[3], m[4]) : '');
  }
```

- [ ] **Step 5: Thread the time through the mutations**

Replace `setDeadline` and `bumpDeadline`:

```js
  function setDeadline(t, iso, repeat = null, time = null) {
    t.deadline = iso;
    t.repeat = iso ? repeat : null;
    t.time = iso ? time : null;
    touch(t);
  }
  function bumpDeadline(t, delta, today) {
    // forward t.time, or a '>' day bump would silently drop it
    setDeadline(t, t.deadline ? addDays(t.deadline, delta) : today, t.repeat, t.time);
  }
```

In `makeTask`'s task literal, add `time` next to `deadline`:

```js
                title: fields.title, tags: fields.tags || [], deadline: fields.deadline || null,
                time: fields.time || null,
                repeat: fields.repeat || null, closed: null, scheduledRaw: null, propLines: [], body: [],
```

- [ ] **Step 6: Export `parseTimeToken`**

In the CORE `return {...}`, add it after `parseDateToken`:

```js
  return { version: 1, dayName, addDays, addInterval, orgActive, orgInactive, timeStart, parseDateToken, parseTimeToken, parseOrg,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/parser.test.mjs tests/repeat.test.mjs
git commit -m "Set and preserve deadline times through task mutations"
```

---

### Task 3: The `@14:30` quick-add token

**Files:**
- Modify: `index.html` — `parseQuickAdd` (~line 467)
- Test: `tests/quickadd.test.mjs`

**Interfaces:**
- Consumes: `Core.parseTimeToken` from Task 2
- Produces: `parseQuickAdd(...)` result gains a `time` key (`string | null`). Both `makeTask` call sites already pass this object through whole, so quick-add and `A` (add sub-task) pick it up automatically.

- [ ] **Step 1: Update the two exhaustive-shape tests**

`tests/quickadd.test.mjs` has two `deepEqual` assertions over the whole result object; both fail the moment a key is added. Replace them with:

```js
test('full quick-add line', () => {
  const p = Core.parseQuickAdd('work: Ship report #A :urgent: @jul22 @14:30 ~3h', T);
  assert.deepEqual(p, { topic: 'work', title: 'Ship report', priority: 'A',
                        tags: ['urgent'], deadline: '2026-07-22', time: '14:30',
                        repeat: null, effort: '3h' });
});

test('title only — everything else defaults', () => {
  const p = Core.parseQuickAdd('Just a task', T);
  assert.deepEqual(p, { topic: null, title: 'Just a task', priority: null,
                        tags: [], deadline: null, time: null, repeat: null, effort: null });
});
```

- [ ] **Step 2: Write the failing token tests**

Append to `tests/quickadd.test.mjs`:

```js
test('@time sets the deadline time alongside an @date', () => {
  const p = Core.parseQuickAdd('dentist @fri @14:30', T);
  assert.equal(p.deadline, '2026-07-24');
  assert.equal(p.time, '14:30');
  assert.equal(p.title, 'dentist');
});

test('a bare @time means today, and the hour is padded', () => {
  const p = Core.parseQuickAdd('standup @9:00', T);
  assert.equal(p.deadline, T);
  assert.equal(p.time, '09:00');
});

test('a time range is kept whole', () => {
  assert.equal(Core.parseQuickAdd('sync @fri @10:00-11:00', T).time, '10:00-11:00');
});

test('an impossible time stays in the title', () => {
  const p = Core.parseQuickAdd('call bob @25:70', T);
  assert.equal(p.time, null);
  assert.equal(p.deadline, null);
  assert.equal(p.title, 'call bob @25:70');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/quickadd.test.mjs`
Expected: FAIL — `time` is missing from the result object.

- [ ] **Step 4: Add the `@time` branch**

In `parseQuickAdd`, add `time: null` to the `out` literal:

```js
    const out = { topic: null, title: '', priority: null, tags: [], deadline: null, time: null, repeat: null, effort: null };
```

Add the time branch immediately **before** the `@date` branch, so an `@`-token is offered to the time parser first:

```js
      else if ((m = w.match(/^@(\S+)$/)) && parseTimeToken(m[1])) out.time = parseTimeToken(m[1]);
      else if ((m = w.match(/^@(\S+)$/)) && parseDateToken(m[1], today)) out.deadline = parseDateToken(m[1], today);
```

And replace the trailing `if (!out.deadline) out.repeat = null;` with:

```js
    if (out.time && !out.deadline) out.deadline = today;   // a time alone means today
    if (!out.deadline) { out.repeat = null; out.time = null; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/quickadd.test.mjs
git commit -m "Accept an @14:30 time token in quick-add"
```

---

### Task 4: Order same-day tasks by time

**Files:**
- Modify: `index.html` — `buildModel`'s radar sort (~line 555), `sortBacklog` (~line 592)
- Test: `tests/model.test.mjs`

**Interfaces:**
- Consumes: `t.time`, `Core.timeStart` from Task 1
- Produces: no new exports — `buildModel` and `sortBacklog` keep their signatures and only change their ordering

- [ ] **Step 1: Write the failing ordering tests**

Append to `tests/model.test.mjs`:

```js
test('radar orders one day by time, untimed rows last', () => {
  const files = [{ topic: 'w', file: mk(
    '* NEXT [#A] untimed\n  DEADLINE: <2026-07-20 Mon>\n' +
    '* NEXT [#C] afternoon\n  DEADLINE: <2026-07-20 Mon 14:30>\n' +
    '* NEXT [#C] morning\n  DEADLINE: <2026-07-20 Mon 9:00>\n' +   // unpadded on purpose
    '* NEXT [#A] next-day\n  DEADLINE: <2026-07-21 Tue 08:00>\n' +
    '* NEXT [#A] no-deadline\n') }];
  const m = Core.buildModel(files, T);
  assert.deepEqual(m.radar.map(r => r.task.title),
                   ['morning', 'afternoon', 'untimed', 'next-day', 'no-deadline']);
});

test('sortBacklog: deadline mode breaks ties by time, no deadline still last', () => {
  const f = mk('* TODO none\n' +
               '* TODO pm\n  DEADLINE: <2026-09-01 Tue 14:30>\n' +
               '* TODO am\n  DEADLINE: <2026-09-01 Tue 09:00>\n' +
               '* TODO untimed\n  DEADLINE: <2026-09-01 Tue>\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  assert.deepEqual(Core.sortBacklog(refs, 'deadline').map(r => r.task.title),
                   ['am', 'pm', 'untimed', 'none']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/model.test.mjs`
Expected: FAIL — ordering falls back to priority within the day, so `afternoon` and `morning` come out in file order behind `untimed`.

- [ ] **Step 3: Add the shared sort key and use it in both sorts**

In CORE's `// --- view model ---` block, directly after `const priRank = ...`:

```js
  // deadline + time as one comparable string; untimed sorts after timed
  // within the same day. Null (no deadline at all) is the callers' business.
  const dlKey = t => t.deadline ? t.deadline + '\t' + (timeStart(t.time) || '99:99') : null;
```

In `buildModel`, replace the radar sort:

```js
    radar.sort((a, b) => {
      const ad = dlKey(a.task) || '9999', bd = dlKey(b.task) || '9999';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return priRank(a.task.priority) - priRank(b.task.priority);
    });
```

In `sortBacklog`, replace the `deadline` arm of `val` (leaving the rest of the function alone — it relies on `null` to push missing values last, even in desc):

```js
    const val = r => mode === 'priority' ? priRank(r.task.priority)
      : mode === 'deadline' ? dlKey(r.task)
      : r.task.added;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS — including the pre-existing `radar = NEXT + near deadlines` and `sortBacklog: deadline` tests, whose ordering is unchanged for untimed tasks.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/model.test.mjs
git commit -m "Order same-day tasks by their deadline time"
```

---

### Task 5: Show and edit times in the UI

APP code — not unit-testable, so verify by running the e2e suite for regressions and by driving the page by hand.

**Files:**
- Modify: `index.html` — the deadline chip in `taskRow` (~line 1440), `hintText` (~line 1937), the `s` key handler (~line 2435), the `e` key handler (~line 2495)
- Test: `tests/ui-e2e.mjs` (run, not modified)

**Interfaces:**
- Consumes: `Core.timeStart`, `Core.parseTimeToken`, `Core.setDeadline(t, iso, repeat, time)`, `p.time` from `Core.parseQuickAdd`
- Produces: nothing other tasks consume

- [ ] **Step 1: Show the time on the deadline chip**

Replace the deadline chip block:

```js
  if (t.deadline) {
    const b = span('chip dl-' + (Core.deadlineBucket(t.deadline, todayIso()) || 'later'));
    const hm = Core.timeStart(t.time);   // a range shows its start
    b.textContent = '⏰ ' + t.deadline.slice(5) + (hm ? ' ' + hm : '');
    meta.append(b);
  }
```

- [ ] **Step 2: Show the time in the quick-add hint**

In `hintText`, replace the deadline line:

```js
  if (p.deadline) parts.push('⏰ ' + p.deadline + (p.time ? ' ' + p.time : ''));
```

- [ ] **Step 3: Accept a time in the `s` deadline editor**

Replace the whole body of the `if (k === 's')` branch. The token loop replaces the old "strip the repeater off the end, parse the rest as a date" approach, so date, time, and repeater can appear in any order:

```js
  if (k === 's') {
    e.preventDefault();   // don't type the triggering key into the editor input
    const r = selRef();
    if (r) inlineEdit([r.task.deadline, r.task.time, r.task.repeat].filter(Boolean).join(' '),
        'deadline: 2026-08-01 / fri / tom [14:30] [+1w] — empty clears', async v => {
      let iso = null, time = null, repeat = null, hit;
      for (const tok of v.trim().split(/\s+/).filter(Boolean)) {
        if (/^\+\d+[dwmy]$/.test(tok)) repeat = tok;
        else if ((hit = Core.parseTimeToken(tok))) time = hit;
        else if ((hit = Core.parseDateToken(tok, todayIso()))) iso = hit;
        else { toast('Unrecognized: ' + tok); return; }
      }
      if (time && !iso) iso = todayIso();   // a time alone means today
      if (repeat && !iso) { toast('A repeater needs a date'); return; }
      await mutateTask(r.topic, keyPath(r), t => Core.setDeadline(t, iso, repeat, time));
    });
    return;
  }
```

- [ ] **Step 4: Add the `@time` token to the `e` heading editor**

Find the `e` branch — it is the one that builds a `const cur = [t.title, …]` array ending in `t.effort && '~' + t.effort`. Add a time entry to `cur`, update the placeholder, and pass `p.time` on:

```js
      const cur = [t.title,
                   t.priority && '#' + t.priority,
                   ...t.tags.map(x => ':' + x + ':'),
                   t.deadline && '@' + t.deadline,
                   t.time && '@' + t.time,
                   t.repeat,
                   t.effort && '~' + t.effort].filter(Boolean).join(' ');
      // the edit line is the whole truth for heading-level fields:
      // deleting "#A" from it removes the priority (WYSIWYG heading edit)
      inlineEdit(cur, 'title #A :tag: @date @14:30 ~2h — omitted parts are removed', async v => {
```

and in the same handler's `mutateTask` callback:

```js
          Core.setDeadline(x, p.deadline, p.repeat, p.time);
```

- [ ] **Step 5: Run the full test suite and the e2e suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

Run: `node tests/ui-e2e.mjs`
Expected: PASS — needs Google Chrome (`CHROME_BIN` to override). It exercises the `s` editor with `2026-08-01`, an empty value, and `2026-08-01 +1w`; all three go through the new token loop unchanged.

- [ ] **Step 6: Verify by hand in the browser**

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/index.html`, connect `sample-tasks/`, then check:
1. Quick-add `test @tom @14:30` — the hint shows `⏰ <date> 14:30`, and the created row's chip reads `⏰ MM-DD 14:30`.
2. Press `s` on it — the editor prefills `<date> 14:30`; type `<date> 9:00 +1w`, confirm the chip shows `09:00` and a repeat chip appears.
3. Press `>` then `<` — the date moves and the time stays.
4. Press `e` — the line contains `@14:30`; delete that token and confirm the time disappears while the date stays.
5. Open the file on disk: the line reads `DEADLINE: <YYYY-MM-DD Day 09:00 +1w>`.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Show deadline times on the chip and edit them with s and e"
```

---

### Task 6: Document the token and ship a fixture

**Files:**
- Modify: `index.html` — help overlay token table (~line 147) and shortcut table (~line 187)
- Modify: `README.md:44-45`
- Modify: `CLAUDE.md` — the data-flow bullet describing task fields
- Modify: `sample-tasks/work.org`

**Interfaces:**
- Consumes: the finished feature from Tasks 1–5
- Produces: nothing

- [ ] **Step 1: Add the token to the help overlay**

In the quick-add token table, insert a row directly after the deadline row:

```html
<tr><td><code>@14:30 @9:00 @10:00-11:00</code></td><td>time of day (needs a deadline — on its own it means today)</td></tr>
```

And update the `s` shortcut row:

```html
<tr><td><kbd>s</kbd></td><td>set deadline (add <code>14:30</code> for a time, <code>+1w</code> etc. to repeat)</td></tr>
```

- [ ] **Step 2: Update the README token line**

Replace `README.md:44-45`:

```markdown
`topic:` file · `#A/#B/#C` priority · `:tag:` tags ·
`@2026-07-22 | @jul22 | @tomorrow | @fri` deadline · `@14:30` time ·
`~3h` estimate.
```

- [ ] **Step 3: Note the field in CLAUDE.md**

In the "Data flow" section, after the sentence ending `States `TODO`/`NEXT`/`DONE`; radar = NEXT + deadline within 7 days.`, add:

```markdown
  A deadline may carry an optional time (`t.time`), stored as the verbatim
  time chunk of the timestamp so an Emacs-written range (`10:00-11:00`)
  survives an unrelated edit; `Core.timeStart` derives the padded `HH:MM`
  that sorting and the chip use. `t.deadline` stays date-only on purpose —
  every bucket, filter, and date calculation depends on that — so times
  break ties in the radar and backlog sorts but never affect
  `deadlineBucket`.
```

- [ ] **Step 4: Add a timed task to the sample fixture**

Append to `sample-tasks/work.org`:

```org
* NEXT [#B] Standup with the team :work:
  DEADLINE: <2026-07-20 Mon 09:30 +1w>
  :PROPERTIES:
  :ADDED:    [2026-07-18 Sat]
  :END:
  Daily-ish; the time is what makes this sort above untimed Monday tasks.
```

- [ ] **Step 5: Verify the whole suite once more**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

Run: `node tests/ui-e2e.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add index.html README.md CLAUDE.md sample-tasks/work.org
git commit -m "Document the @14:30 deadline time token"
```
