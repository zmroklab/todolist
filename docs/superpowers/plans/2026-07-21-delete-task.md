# Delete Task (X) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pressing `X` on the selected task deletes it from its `.org` file after a native `confirm()` — whole subtree for a top-level task, just the one block for a sub-task.

**Architecture:** CORE gains `removeSubtaskAt(file, parentIndex, childIndex)` next to the existing `removeTaskAt`; APP gains `deleteSel()` wired to `X` in the main keydown handler, going through `saveFile`'s fresh-read-then-mutate path. Spec: `docs/superpowers/specs/2026-07-21-delete-task-design.md`.

**Tech Stack:** Vanilla JS in single-file `index.html`; `node:test` unit tests; CDP-driven Chrome e2e.

## Global Constraints

- Everything lives in `index.html`; the marker comments `// ===== CORE START =====`, `// ===== CORE END =====`, `// ===== APP =====` must not be altered — tooling greps for them.
- CORE must never touch `document`/`window`; anything added to CORE must be exported through the IIFE's `return {...}` and covered by unit tests.
- Round-trip invariant: `Core.serializeFile(Core.parseOrg(text)) === text` when nothing was edited; untouched blocks keep `raw` verbatim. If a round-trip test fails, fix the code, never the test.
- Do not rename the globals the e2e test monkey-patches (`showDirectoryPicker`, `idbSet`, `connectNames`, `confirm`).
- Unit tests: `node --test 'tests/*.test.mjs'` (the glob is required; a bare directory arg does not work). E2e: `node tests/ui-e2e.mjs`.
- Plain `git commit` works (repo-local `commit.gpgsign=false`).

---

### Task 1: `Core.removeSubtaskAt`

**Files:**
- Modify: `index.html` (CORE section — new function after `removeTaskAt` at ~line 345-351, plus the IIFE return list at ~line 446)
- Create: `tests/delete.test.mjs`

**Interfaces:**
- Consumes: existing CORE internals `nodeText(t)` (raw-or-rendered text of one node) and `normalizeNewlines(file)`.
- Produces: `Core.removeSubtaskAt(file, parentIndex, childIndex) -> string | null` — removes `file.tasks[parentIndex].children[childIndex]`, returns its `\n`-terminated block text, or `null` if either index is out of range (file unchanged). Task 2 calls it by exactly this name and signature.

- [ ] **Step 1: Write the failing tests**

Create `tests/delete.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

const RICH =
  '#+TITLE: Home\n\n' +
  '* TODO first\n' +
  '* NEXT [#A] parent :tag:\n' +
  '  DEADLINE: <2026-07-25 Sat>\n' +
  '  parent note\n' +
  '** TODO child one\n   child body\n' +
  '** DONE child two\n*** deep stays\n    deep body\n' +
  '** TODO child three\n' +
  '* TODO last\n';

test('removeSubtaskAt: middle child removed, rest byte-identical', () => {
  const f = Core.parseOrg(RICH);
  const block = Core.removeSubtaskAt(f, 1, 1);
  assert.equal(block, '** DONE child two\n*** deep stays\n    deep body\n');
  assert.equal(Core.serializeFile(f), RICH.replace('** DONE child two\n*** deep stays\n    deep body\n', ''));
});

test('removeSubtaskAt: first child', () => {
  const f = Core.parseOrg(RICH);
  const block = Core.removeSubtaskAt(f, 1, 0);
  assert.equal(block, '** TODO child one\n   child body\n');
  assert.equal(Core.serializeFile(f), RICH.replace('** TODO child one\n   child body\n', ''));
});

test('removeSubtaskAt: last child', () => {
  const f = Core.parseOrg(RICH);
  const block = Core.removeSubtaskAt(f, 1, 2);
  assert.equal(block, '** TODO child three\n');
  assert.equal(Core.serializeFile(f), RICH.replace('** TODO child three\n', ''));
});

test('removeSubtaskAt: only child leaves a childless parent', () => {
  const f = Core.parseOrg('* TODO p\n  note\n** TODO only\n');
  assert.equal(Core.removeSubtaskAt(f, 0, 0), '** TODO only\n');
  assert.equal(Core.serializeFile(f), '* TODO p\n  note\n');
  assert.equal(f.tasks[0].children.length, 0);
});

test('removeSubtaskAt: out-of-range indices return null and mutate nothing', () => {
  const f = Core.parseOrg(RICH);
  assert.equal(Core.removeSubtaskAt(f, 9, 0), null);
  assert.equal(Core.removeSubtaskAt(f, 1, 9), null);
  assert.equal(Core.removeSubtaskAt(f, -1, 0), null);
  assert.equal(Core.removeSubtaskAt(f, 1, -1), null);
  assert.equal(Core.removeSubtaskAt(f, 0, 0), null);   // 'first' has no children
  assert.equal(Core.serializeFile(f), RICH);
});

test('removeSubtaskAt: sibling missing trailing newline gets normalized', () => {
  const f = Core.parseOrg('* TODO p\n** TODO a\n** TODO b');
  assert.equal(Core.removeSubtaskAt(f, 0, 0), '** TODO a\n');
  assert.equal(Core.serializeFile(f), '* TODO p\n** TODO b\n');
});

test('removeSubtaskAt: parent stays clean (not dirty) and round-trips', () => {
  const f = Core.parseOrg(RICH);
  Core.removeSubtaskAt(f, 1, 1);
  assert.equal(f.tasks[1].dirty, false);
  const out = Core.serializeFile(f);
  assert.equal(Core.serializeFile(Core.parseOrg(out)), out);
});

test('removeTaskAt on a parent removes the whole subtree (top-level delete path)', () => {
  const f = Core.parseOrg(RICH);
  Core.removeTaskAt(f, 1);
  assert.equal(Core.serializeFile(f), '#+TITLE: Home\n\n* TODO first\n* TODO last\n');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/delete.test.mjs`
Expected: FAIL — `Core.removeSubtaskAt is not a function` (7 failures; the `removeTaskAt` test passes).

- [ ] **Step 3: Implement `removeSubtaskAt` in CORE**

In `index.html`, directly after the `removeTaskAt` function (ends `~line 351`), add:

```js
  function removeSubtaskAt(file, parentIndex, childIndex) {
    const parent = file.tasks[parentIndex];
    const child = parent && parent.children[childIndex];
    if (parentIndex < 0 || childIndex < 0 || !child) return null;
    const b = nodeText(child);
    parent.children.splice(childIndex, 1);
    normalizeNewlines(file);
    return b.endsWith('\n') ? b : b + '\n';
  }
```

(The explicit `< 0` guards matter: `children[-1]` is `undefined` so negatives already fall out via `!child`, but keep the guard for clarity and parity with `removeTaskAt`'s contract.)

Then export it — change the return-list line (~446):

```js
           taskBlock, removeTaskAt, removeSubtaskAt, appendRaw, subtreeText,
```

- [ ] **Step 4: Run the full unit suite to verify it passes**

Run: `node --test 'tests/*.test.mjs'`
Expected: all tests PASS, including all pre-existing round-trip tests.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/delete.test.mjs
git commit -m 'feat: Core.removeSubtaskAt — remove one sub-task block, siblings verbatim'
```

---

### Task 2: `deleteSel()`, the `X` keybinding, help row, e2e coverage

**Files:**
- Modify: `index.html` (APP section — new `deleteSel()` after `moveSelTo` at ~line 1012; new key branch after the `y`/`Y` branch at ~line 1295; help table row after the `Y` row at ~line 125)
- Modify: `tests/ui-e2e.mjs` (new checks before the final `ws.close()` at ~line 619)

**Interfaces:**
- Consumes: `Core.removeTaskAt(file, index)`, `Core.removeSubtaskAt(file, parentIndex, childIndex)` (Task 1), and existing APP helpers `selRef()`, `findEntry(topic)`, `saveFile(entry, mutateFn)`, `taskKey(t)`.
- Produces: global `async function deleteSel()` (top-level APP function — the e2e monkey-patching convention means don't rename it later without checking `ui-e2e.mjs`).

- [ ] **Step 1: Add `deleteSel()` to APP**

In `index.html`, after `moveSelTo`'s closing brace (~line 1012), add:

```js
// --- delete (X) ---
async function deleteSel() {
  const r = selRef();
  if (!r) return;
  const n = r.parent ? 0 : r.task.children.length;
  const msg = n
    ? 'Delete "' + r.task.title + '" and its ' + n + ' sub-task' + (n === 1 ? '' : 's') + '?'
    : 'Delete "' + r.task.title + '"?';
  if (!confirm(msg)) return;
  const entry = findEntry(r.topic);
  if (!entry || entry.parseError || entry.broken) return;
  await saveFile(entry, file => {
    if (r.parent) {
      const pi = file.tasks.findIndex(t => taskKey(t) === taskKey(r.parent));
      if (pi === -1) return;
      const ci = file.tasks[pi].children.findIndex(c => taskKey(c) === taskKey(r.task));
      if (ci > -1) Core.removeSubtaskAt(file, pi, ci);
    } else {
      const i = file.tasks.findIndex(t => taskKey(t) === taskKey(r.task));
      if (i > -1) Core.removeTaskAt(file, i);
    }
  });
}
```

Notes for the implementer: `saveFile` re-reads the file from disk before calling the mutation and calls `render()` itself, so `deleteSel` needs no render call; a task missing from the fresh parse (deleted externally) makes the mutation a no-op re-serialize, which is the spec'd behavior. Selection after delete lands on the next row via the existing `App.selPos` positional fallback — add no selection code.

- [ ] **Step 2: Wire `X` in the keydown handler**

After the `y`/`Y` branch's closing brace (~line 1295), add:

```js
  if (k === 'X') return deleteSel();
```

(No `preventDefault()` needed — `X` focuses no input.)

- [ ] **Step 3: Add the help table row**

In the `#help` shortcuts table, after the `Y` row (`~line 125`), add:

```html
<tr><td><kbd>X</kbd></td><td>delete task (asks to confirm)</td></tr>
```

- [ ] **Step 4: Run existing tests to confirm nothing broke**

Run: `node --test 'tests/*.test.mjs'` — expected: all PASS.
Run: `node tests/ui-e2e.mjs` — expected: `all e2e checks passed` (no new checks yet; this catches syntax errors in `index.html`).

- [ ] **Step 5: Add e2e checks**

In `tests/ui-e2e.mjs`, immediately before the final `ws.close();` (~line 619), add:

```js
// --- X deletes tasks after confirm; cancel leaves the file untouched ---
await evaljs(`(() => {
  __files.set('home.org', __files.get('home.org') +
    '* TODO Delete parent\\n  parent note\\n** TODO del child A\\n** DONE del child B\\n* TODO Sub parent\\n** TODO sub victim\\n** TODO sub survivor\\n');
  __mtimes.set('home.org', 999999999);
  return true;
})()`);
await sleep(2500);
await evaljs(`(() => {
  window.__confirmMsg = null;
  window.confirm = m => { window.__confirmMsg = m; return false; };
  const i = App.visible.findIndex(r => !r.parent && r.task.title === 'Delete parent');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
  return i;
})()`);
const beforeCancel = await evaljs(`__files.get('home.org')`);
await key('X', 'KeyX', 'X', 88);
await sleep(300);
const afterCancel = await evaljs(`({ text: __files.get('home.org'), msg: window.__confirmMsg })`);
check('X cancelled: file byte-identical, message names title and sub-task count',
      afterCancel.text === beforeCancel && afterCancel.msg === 'Delete "Delete parent" and its 2 sub-tasks?',
      JSON.stringify(afterCancel.msg));

await evaljs(`window.confirm = () => true`);
await key('X', 'KeyX', 'X', 88);
await sleep(300);
const afterParent = await evaljs(`__files.get('home.org')`);
check('X deletes a parent with its whole subtree',
      !afterParent.includes('Delete parent') && !afterParent.includes('del child A') &&
      !afterParent.includes('del child B') && afterParent.includes('Sub parent'),
      JSON.stringify(afterParent));

await evaljs(`(() => {
  const i = App.visible.findIndex(r => !r.parent && r.task.title === 'Sub parent');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
  return i;
})()`);
await key('o', 'KeyO', 'o', 79);
await sleep(300);
await evaljs(`(() => {
  const i = App.visible.findIndex(r => r.parent && r.task.title === 'sub victim');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
  return i;
})()`);
await key('X', 'KeyX', 'X', 88);
await sleep(300);
const afterSub = await evaljs(`__files.get('home.org')`);
check('X on a sub-task deletes only that sub-task',
      !afterSub.includes('sub victim') && afterSub.includes('* TODO Sub parent') && afterSub.includes('sub survivor'),
      JSON.stringify(afterSub));
```

- [ ] **Step 6: Run the e2e suite to verify the new checks pass**

Run: `node tests/ui-e2e.mjs`
Expected: `all e2e checks passed` including the three new checks. If Chrome is missing it prints `SKIP` — that does not count as verification; install/point `CHROME_BIN` and re-run.

- [ ] **Step 7: Run the full unit suite once more**

Run: `node --test 'tests/*.test.mjs'`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m 'feat: X deletes the selected task (or sub-task) after a confirm dialog'
```
