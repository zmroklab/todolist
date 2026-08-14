# Notes Editing + Fold/Unfold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `N` shortcut that edits a task's notes (body text) in a multiline inline editor, and make Enter/`o` a single disclosure toggle that shows/hides notes *and* sub-task rows (collapsed by default).

**Architecture:** Everything lives in `index.html`. One new CORE mutation (`setBody`) with unit tests; APP changes generalize the existing `inlineEdit` to a textarea mode, gate child-row rendering on the existing `App.expanded` set, and add discoverability chips. Spec: `docs/superpowers/specs/2026-07-18-notes-and-folding-design.md`.

**Tech Stack:** Vanilla JS in a single HTML file, `node --test` for CORE units, CDP-driven headless Chrome for e2e. No dependencies, no build step.

## Global Constraints

- CORE (between `// ===== CORE START =====` and `// ===== CORE END =====`) must never touch `document`/`window`; new CORE functions must be exported via the IIFE's `return {...}` and covered by unit tests. Do not alter the marker comments.
- Round-trip invariant: `Core.serializeFile(Core.parseOrg(text)) === text` for untouched blocks. `setBody` marks the task dirty, so re-indenting the edited block is allowed — but the serializer's output must re-parse to an identical model.
- Unit tests: `node --test 'tests/*.test.mjs'` (glob required; a bare directory arg does not work). E2e: `node tests/ui-e2e.mjs` (skips cleanly if Chrome missing; do not treat SKIP as failure).
- Top-level APP `function` declarations are monkey-patched by the e2e test (`showDirectoryPicker`, `idbSet`, `openFolder`) — do not rename any top-level function.
- The inline editor must keep its single idempotent `close()`; never add separate `box.remove()` calls (blur fires synchronously mid-removal).
- Keyboard branches that focus an input must `preventDefault()` so the triggering key isn't typed into it.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: CORE `setBody` mutation

**Files:**
- Modify: `index.html` (CORE mutations block, after `appendBody` at ~line 276; exports list at ~line 393)
- Test: `tests/serializer.test.mjs` (append after the `appendBody` test at ~line 103)

**Interfaces:**
- Consumes: existing `touch(t)` helper, `t.body` (array of raw body lines including indentation).
- Produces: `Core.setBody(task, lines)` — replaces `task.body` with `lines` (caller passes *dedented* strings), indenting each non-blank line by exactly two spaces; blank lines become `''`; marks the task dirty. Returns nothing. Task 2 calls this via `mutateTask`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/serializer.test.mjs`:

```js
test('setBody replaces notes with two-space indent, keeps blank lines', () => {
  const f = Core.parseOrg('* TODO x\n  old note\n');
  Core.setBody(f.tasks[0], ['first', '', 'second']);
  assert.equal(f.tasks[0].dirty, true);
  assert.equal(Core.serializeFile(f), '* TODO x\n  first\n\n  second\n');
});

test('setBody with [] clears notes', () => {
  const f = Core.parseOrg('* TODO x\n  old note\n');
  Core.setBody(f.tasks[0], []);
  assert.equal(Core.serializeFile(f), '* TODO x\n');
});

test('setBody keeps planning and properties untouched', () => {
  const f = Core.parseOrg('* TODO x\n  DEADLINE: <2026-07-20 Mon>\n  :PROPERTIES:\n  :Effort:   1h\n  :END:\n  old\n');
  Core.setBody(f.tasks[0], ['new']);
  assert.equal(Core.serializeFile(f),
    '* TODO x\n  DEADLINE: <2026-07-20 Mon>\n  :PROPERTIES:\n  :Effort:   1h\n  :END:\n  new\n');
});

test('setBody: a note line starting with * cannot become a heading', () => {
  const f = Core.parseOrg('* TODO x\n* TODO y\n');
  Core.setBody(f.tasks[0], ['* not a heading']);
  const f2 = Core.parseOrg(Core.serializeFile(f));
  assert.equal(f2.tasks.length, 2);
  assert.deepStrictEqual(f2.tasks[0].body, ['  * not a heading']);
});

test('setBody output is parse-stable', () => {
  const f = Core.parseOrg('* TODO x\n');
  Core.setBody(f.tasks[0], ['a', 'b']);
  const once = Core.serializeFile(f);
  assert.equal(Core.serializeFile(Core.parseOrg(once)), once);
});

test('setBody works on sub-tasks', () => {
  const f = Core.parseOrg('* TODO p\n** TODO c\n');
  Core.setBody(f.tasks[0].children[0], ['child note']);
  assert.equal(Core.serializeFile(f), '* TODO p\n** TODO c\n  child note\n');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/serializer.test.mjs`
Expected: the six new tests FAIL with `Core.setBody is not a function`; all pre-existing tests PASS.

- [ ] **Step 3: Implement `setBody`**

In `index.html`, directly after the `appendBody` line (`function appendBody(t, line) { t.body.push('  ' + line); touch(t); }`):

```js
  // two-space indent doubles as a guarantee: no note line can sit at column 0,
  // so an edit can never fabricate a '*'/'**' heading and split the block
  function setBody(t, lines) { t.body = lines.map(l => l.trim() ? '  ' + l : ''); touch(t); }
```

In the CORE IIFE's `return {...}` (~line 393), add `setBody` next to `appendBody`:

```js
           setProp, setEffort, appendBody, setBody, makeTask, moveTask, addTask, parseQuickAdd,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test 'tests/*.test.mjs'`
Expected: all tests PASS (including parser/round-trip suites).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/serializer.test.mjs
git commit -m "feat: Core.setBody replaces a task's notes with safe two-space indent

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: multiline inline editor + `N` shortcut

**Files:**
- Modify: `index.html` — CSS (`.editor input` rule ~line 39), help panel (shortcut table ~line 118, screenshots paragraph ~line 102), `inlineEdit` (~lines 850–876), keydown handler (insert `N` branch after the `E` branch, ~line 942)
- Modify: `CLAUDE.md` (keyboard-branches gotcha list)
- Test: `tests/ui-e2e.mjs` (append a notes section before `ws.close()`)

**Interfaces:**
- Consumes: `Core.setBody(task, lines)` from Task 1; existing `inlineEdit`, `selRef()`, `keyPath(r)`, `mutateTask(topic, keyPath, fn)`, `App.expanded`, `App.sel`.
- Produces: `inlineEdit(initial, placeholder, onCommit, opts)` — 4th arg optional `{multiline: true}` renders a `<textarea>`; plain Enter inserts a newline, Cmd/Ctrl+Enter commits (raw untrimmed value), Escape/blur cancels. Single-line callers are untouched (Enter commits trimmed value). `N` keyboard branch. Task 3 does not depend on this task.

- [ ] **Step 1: Generalize `inlineEdit`**

Replace the existing `inlineEdit` body (keep the function name and the idempotent `close()`), preserving the existing comment:

```js
function inlineEdit(initial, placeholder, onCommit, opts = {}) {
  const row = document.querySelector('.task.sel');
  if (!row) return;
  const box = div('editor');
  const inp = document.createElement(opts.multiline ? 'textarea' : 'input');
  inp.value = initial;
  inp.placeholder = placeholder;
  if (opts.multiline) inp.rows = Math.max(3, initial.split('\n').length + 1);
  box.append(inp);
  row.after(box);
  inp.focus();
  // multiline: cursor at end (select-all would make one keystroke wipe the notes)
  if (opts.multiline) inp.setSelectionRange(inp.value.length, inp.value.length);
  else inp.select();
  // Removing a focused element fires blur synchronously mid-removal, so the
  // Enter branch and the blur handler must share one idempotent close() —
  // two bare box.remove() calls re-enter and throw before onCommit runs.
  let closed = false;
  const close = () => { if (closed) return; closed = true; box.remove(); };
  inp.onkeydown = async e => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && (!opts.multiline || e.metaKey || e.ctrlKey)) {
      const v = opts.multiline ? inp.value : inp.value.trim();
      close();
      await onCommit(v);
    }
  };
  inp.onblur = close;
}
```

Add a textarea rule next to the `.editor input` CSS rule:

```css
.editor textarea { width:100%; font:inherit; padding:6px 8px; border:1px solid var(--accent); border-radius:6px; resize:vertical; }
```

- [ ] **Step 2: Add the `N` keyboard branch**

Insert after the `E` branch's closing `}` (the block ending `return;` at ~line 942), before the `e` branch:

```js
  if (k === 'N') {
    e.preventDefault();   // don't type the triggering key into the editor
    const r = selRef();
    if (!r) return;
    // prefill dedents like the body view; setBody re-indents on save
    const cur = r.task.body.map(l => l.replace(/^ {0,2}/, '')).join('\n');
    inlineEdit(cur, 'notes — Cmd/Ctrl+Enter saves, Esc cancels', async v => {
      const lines = v.split('\n');
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (lines.length) App.expanded.add(App.sel);
      await mutateTask(r.topic, keyPath(r), t => Core.setBody(t, lines));
    }, { multiline: true });
    return;
  }
```

- [ ] **Step 3: Help panel + CLAUDE.md**

In the shortcut table, after the `E` row (`<tr><td><kbd>E</kbd></td><td>edit estimate</td></tr>`):

```html
<tr><td><kbd>N</kbd></td><td>edit notes (Cmd/Ctrl+Enter saves)</td></tr>
```

In the screenshots paragraph (~line 102), change the first sentence to:

```html
<p>Press <kbd>N</kbd> to write notes under a task; select a task and paste a
screenshot (<kbd>Cmd+V</kbd>) to attach it —
saved to <code>images/</code> and shown when the task is expanded.
```

In `CLAUDE.md`, extend the gotcha list of input-focusing keys from `(a, /, s, t, E, e)` to `(a, /, s, t, E, e, N, A)`.

- [ ] **Step 4: Extend the e2e test**

In `tests/ui-e2e.mjs`, first extend the `key` helper to accept modifiers (Ctrl = bit 2):

```js
async function key(k, code, text, vk, modifiers = 0) {
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}
```

Append before `ws.close()`:

```js
// --- notes editor (N): multi-line body write, auto-expand ---
await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Garage cleanup');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
  return App.sel;
})()`);
await key('N', 'KeyN', 'N', 78);
await sleep(250);
check('N opens a textarea', await evaljs(`!!document.querySelector('.editor textarea')`));
await cdp('Input.insertText', { text: 'first note line\nsecond note line' });
await key('Enter', 'Enter', '\r', 13, 2);   // Ctrl+Enter commits
await sleep(500);
const afterN = await evaljs(`({
  file: __files.get('home.org'),
  bodyShown: !!document.querySelector('.body'),
})`);
check('notes are written with two-space indent',
      afterN.file.includes('* TODO Garage cleanup\n  first note line\n  second note line'),
      JSON.stringify(afterN.file));
check('row auto-expands to show the new note', afterN.bodyShown);

// --- N with Escape cancels without writing ---
const fileBeforeN = await evaljs(`__files.get('home.org')`);
await key('N', 'KeyN', 'N', 78);
await sleep(250);
await cdp('Input.insertText', { text: 'discarded' });
await key('Escape', 'Escape', undefined, 27);
await sleep(250);
check('Escape cancels the notes editor without writing',
      await evaljs(`__files.get('home.org')`) === fileBeforeN);
```

- [ ] **Step 5: Run both suites**

Run: `node --test 'tests/*.test.mjs'` — expected: all PASS.
Run: `node tests/ui-e2e.mjs` — expected: `all e2e checks passed` including the four new checks.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/ui-e2e.mjs CLAUDE.md
git commit -m "feat: N shortcut edits task notes in a multiline inline editor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: fold/unfold — Enter/o discloses notes + sub-task rows

**Files:**
- Modify: `index.html` — `taskRows`/`rowsFor` (~lines 683–689), `taskRow` meta chips (after the effort chip, ~line 643), `A` branch (~lines 969–984), CSS chips (~line 35), help panel Enter/`o` row (~line 108) and sub-task paragraph (~line 99)
- Modify: `docs/superpowers/specs/2026-07-18-nested-tasks-design.md` (supersession note), `docs/superpowers/specs/2026-07-18-notes-and-folding-design.md` (filtered-child rule), `CLAUDE.md` (data-flow note)
- Test: `tests/ui-e2e.mjs` (append a fold section)

**Interfaces:**
- Consumes: existing `App.expanded` (refKey-keyed Set), `refKey(ref)`, `taskRow(ref, mode)`, `Core.matchesFilter(ref, filter, today)`, `todayIso()`, `App.filter`, `span()`, `render()`.
- Produces: no new exports; `taskRows` renders children only when the parent is expanded or the child itself matches an active filter. Fold chip (`.chip.fold`) toggles on click; notes chip (`.chip.note`) is display-only.

- [ ] **Step 1: Gate child rows on expansion in `taskRows`**

Replace `taskRows` (keep `rowsFor` as is):

```js
function taskRows(ref) {
  const rows = [taskRow(ref)];
  const open = App.expanded.has(refKey(ref));
  const f = App.filter;
  const filterOn = !!(f.text || f.tag || f.priority || f.deadline || f.topic);
  const today = todayIso();
  ref.task.children.forEach((c, ci) => {
    const cref = { topic: ref.topic, index: ref.index, ci, task: c, parent: ref.task };
    // a filtered-in child stays visible under a collapsed parent — hiding
    // search hits behind a fold reads as "no results"
    if (open || (filterOn && Core.matchesFilter(cref, f, today)))
      rows.push(taskRow(cref, 'sub'));
  });
  return rows;
}
```

- [ ] **Step 2: Discoverability chips in `taskRow`**

After the effort-chip block (`if (t.effort) { ... meta.append(e); }`, ~line 643), insert:

```js
  if (t.children.length) {
    const fc = span('chip fold');
    fc.textContent = (App.expanded.has(row.dataset.rk) ? '▾ ' : '▸ ') + t.children.length;
    fc.onclick = ev => {
      ev.stopPropagation();
      const rk = row.dataset.rk;
      App.expanded.has(rk) ? App.expanded.delete(rk) : App.expanded.add(rk);
      render();
    };
    meta.append(fc);
  }
  if (t.body.some(l => l.trim())) {
    const nb = span('chip note');
    nb.textContent = '≡';
    meta.append(nb);
  }
```

Add CSS next to the other chip rules:

```css
.chip.fold { background:#e5e7eb; font-weight:600; }
.chip.note { background:transparent; border:1px solid var(--line); color:var(--muted); cursor:default; }
```

- [ ] **Step 3: `A` auto-expands the parent**

In the `A` branch, add one line immediately before `await saveFile(entry, file => {`:

```js
      App.expanded.add(r.topic + '\t' + parentKey);
```

(Inside the `onCommit` callback — cancelling with Escape must not expand anything.)

- [ ] **Step 4: Help panel + docs**

Help table Enter/`o` row becomes:

```html
<tr><td><kbd>Enter</kbd>/<kbd>o</kbd></td><td>expand / collapse (notes + sub-tasks)</td></tr>
```

Sub-task paragraph (~line 99) last sentence becomes:

```html
one level deep) under it — same tokens, no topic. Sub-tasks show indented under
their parent when it is expanded (<kbd>Enter</kbd>/<kbd>o</kbd>) and get their
own radar rows when they qualify.</p>
```

In `docs/superpowers/specs/2026-07-18-nested-tasks-design.md`, change the Visibility bullet to:

```markdown
- **Visibility**: ~~sub-task rows are always visible under their parent (no
  collapse state).~~ Superseded by
  `2026-07-18-notes-and-folding-design.md`: rows fold; children render only
  when the parent is expanded.
```

In `docs/superpowers/specs/2026-07-18-notes-and-folding-design.md`, add under "Interactions with existing behavior":

```markdown
- **Filters/search:** while any filter is active, a sub-task that itself
  matches renders even under a collapsed parent — a search hit must never be
  hidden behind a fold.
```

In `CLAUDE.md` Data flow section, after the `** ` headings sentence, add:

```markdown
  Sub-task rows render only when their parent is expanded (`App.expanded`,
  also the notes-visibility state; in-memory, collapsed on load).
```

- [ ] **Step 5: Extend the e2e test**

Append to `tests/ui-e2e.mjs` after the Task 2 notes section (before `ws.close()`):

```js
// --- fold/unfold: children hidden until parent expanded ---
const foldStart = await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Garage cleanup');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
  App.expanded.delete(App.sel); render();
  return { subVisible: App.visible.some(x => x.parent),
           foldChip: document.querySelector('.chip.fold')?.textContent ?? null };
})()`);
check('collapsed parent hides sub-task rows', foldStart.subVisible === false, JSON.stringify(foldStart));
check('fold chip shows collapsed marker and count', foldStart.foldChip === '▸ 1', JSON.stringify(foldStart));
await key('o', 'KeyO', 'o', 79);
await sleep(300);
const foldOpen = await evaljs(`({
  subVisible: App.visible.some(x => x.parent),
  foldChip: document.querySelector('.chip.fold')?.textContent ?? null,
})`);
check('o expands sub-task rows', foldOpen.subVisible === true, JSON.stringify(foldOpen));
check('fold chip flips to expanded marker', foldOpen.foldChip === '▾ 1', JSON.stringify(foldOpen));
await key('Enter', 'Enter', '\r', 13);
await sleep(300);
check('Enter collapses sub-task rows again',
      await evaljs(`App.visible.some(x => x.parent)`) === false);
```

Then verify the radar ignores folding. First expose the setup block's mtime map: in the existing `setup` eval block, immediately after `const mtimes = new Map([['home.org', 1]]);`, add:

```js
  window.__mtimes = mtimes;
```

Then append after the fold checks:

```js
// --- radar: qualifying sub-task keeps its radar row while parent is collapsed ---
await evaljs(`(() => {
  const iso = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  __files.set('home.org', __files.get('home.org') +
    '* TODO Radar parent\\n** NEXT Radar child\\n   DEADLINE: <' + iso + '>\\n');
  __mtimes.set('home.org', 9999);   // > any clock value: forces the next poll to re-parse
  return iso;
})()`);
await sleep(2500);   // > one 1.5 s scanTick
const radar = await evaljs(`({
  parentExpanded: App.expanded.has('home\\t* TODO Radar parent'),
  radarCtxRow: !!document.querySelector('#radar-list .parent-ctx'),
})`);
check('qualifying sub-task gets a radar row while its parent stays collapsed',
      radar.parentExpanded === false && radar.radarCtxRow === true, JSON.stringify(radar));
```

Note: the pre-existing "toggle sub-task state" section still passes without edits because the `A` commit now auto-expands the parent, so `App.visible` contains the sub-task row when that section runs. If it fails with `App.sel` undefined, the fix is in the `A` branch (Step 3), not the old test.

- [ ] **Step 6: Run both suites**

Run: `node --test 'tests/*.test.mjs'` — expected: all PASS (no CORE changes in this task).
Run: `node tests/ui-e2e.mjs` — expected: `all e2e checks passed`, including the five new fold checks and all pre-existing checks.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/ui-e2e.mjs CLAUDE.md docs/superpowers/specs/2026-07-18-nested-tasks-design.md docs/superpowers/specs/2026-07-18-notes-and-folding-design.md
git commit -m "feat: Enter/o folds notes and sub-task rows as one disclosure state

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
