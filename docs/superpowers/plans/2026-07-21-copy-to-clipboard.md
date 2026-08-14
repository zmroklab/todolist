# Copy Tasks to Clipboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `y` copies the selected task's title as plain text; `Y` copies its raw org block (subtree, including sub-tasks) to the system clipboard.

**Architecture:** One new CORE export, `Core.subtreeText(task)`, built on the existing internal `blockText` helper (serializer rules: `dirty ? renderTask : raw` per node), unit-tested. APP adds one `y`/`Y` branch to the main keydown handler that calls `navigator.clipboard.writeText` and reports via `toast()`. Two rows added to the `?` help table.

**Tech Stack:** Vanilla JS in single-file `index.html`; `node --test` unit tests; CDP-driven Chrome e2e.

**Spec:** `docs/superpowers/specs/2026-07-21-copy-to-clipboard-design.md`

## Global Constraints

- Everything lives in `index.html`; CORE section (between `// ===== CORE START =====` and `// ===== CORE END =====`) must never touch `document`/`window`; marker comments must not be altered.
- Round-trip invariant: `Core.serializeFile(Core.parseOrg(text)) === text` — do not change parser/serializer behavior.
- New CORE functions must be exported through the IIFE's `return {...}` and covered by unit tests.
- Unit tests run with `node --test 'tests/*.test.mjs'` (glob, NOT a bare directory arg — that silently runs nothing).
- E2e runs with `node tests/ui-e2e.mjs` (needs Google Chrome; it is sequential — new checks go at the END, before `ws.close()`).
- Chromium-only app: `navigator.clipboard.writeText` needs no fallback.
- Toast copy strings (exact): `Copied title`, `Copied org block`, `Copy failed`.

---

### Task 1: CORE `subtreeText`

**Files:**
- Modify: `index.html` (CORE section — helper near line 335, export list near line 440)
- Create: `tests/copy.test.mjs`

**Interfaces:**
- Consumes: existing internal `blockText(t)` (`index.html:335`) — `nodeText(t) + t.children.map(nodeText).join('')`.
- Produces: `Core.subtreeText(task) -> string` — org text of the task and (for level-1 tasks) all its children; always ends with exactly one trailing `\n`. Task 2 calls this.

- [ ] **Step 1: Write the failing tests**

Create `tests/copy.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

test('subtreeText: clean top-level task returns raw block verbatim', () => {
  const text = '* TODO [#A] Ship report :work:\n  DEADLINE: <2026-07-24 Fri>\n  :PROPERTIES:\n  :Effort:   2h\n  :END:\n  Draft in Drive\n';
  const f = Core.parseOrg(text);
  assert.equal(Core.subtreeText(f.tasks[0]), text);
});

test('subtreeText: parent includes all sub-task blocks', () => {
  const text = '* TODO parent\n  parent body\n** TODO child one\n   child body\n** DONE child two\n';
  const f = Core.parseOrg(text);
  assert.equal(Core.subtreeText(f.tasks[0]), text);
});

test('subtreeText: sub-task alone copies just its own block', () => {
  const f = Core.parseOrg('* TODO parent\n** TODO child one\n   child body\n** DONE child two\n');
  assert.equal(Core.subtreeText(f.tasks[0].children[0]), '** TODO child one\n   child body\n');
});

test('subtreeText: verbatim ***-deep lines stay inside the subtree', () => {
  const text = '* TODO parent\n** TODO child\n*** deep stays\n    deep body\n';
  const f = Core.parseOrg(text);
  assert.equal(Core.subtreeText(f.tasks[0]), text);
});

test('subtreeText: dirty task renders current in-memory state, not stale raw', () => {
  const f = Core.parseOrg('* TODO x\n');
  Core.setPriority(f.tasks[0], 'A');
  assert.equal(Core.subtreeText(f.tasks[0]), '* TODO [#A] x\n');
});

test('subtreeText: block without trailing newline gains one', () => {
  const f = Core.parseOrg('* TODO no trailing newline');
  assert.equal(Core.subtreeText(f.tasks[0]), '* TODO no trailing newline\n');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/copy.test.mjs`
Expected: 6 failures, each `TypeError: Core.subtreeText is not a function`.

- [ ] **Step 3: Implement `subtreeText` in CORE**

In `index.html`, directly below the existing `blockText` line (`index.html:335`):

```js
  const blockText = t => nodeText(t) + t.children.map(nodeText).join('');
  const subtreeText = t => { const b = blockText(t); return b.endsWith('\n') ? b : b + '\n'; };
```

Add `subtreeText` to the CORE export list (`index.html:443`), keeping it beside its relatives:

```js
           taskBlock, removeTaskAt, appendRaw, subtreeText,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/copy.test.mjs`
Expected: 6 pass. Then run the full suite: `node --test 'tests/*.test.mjs'` — all pass (round-trip invariant untouched).

- [ ] **Step 5: Commit**

```bash
git add index.html tests/copy.test.mjs
git commit -m 'feat: Core.subtreeText — org text of a task and its sub-tasks, newline-terminated'
```

---

### Task 2: `y`/`Y` key bindings, help entries, e2e coverage

**Files:**
- Modify: `index.html` (keydown handler — insert after the `Enter`/`o` branch at `index.html:1284`; help table after the `m` row at `index.html:123`)
- Modify: `tests/ui-e2e.mjs` (append new checks at the end, before `ws.close()`)

**Interfaces:**
- Consumes: `Core.subtreeText(task)` from Task 1; existing `selRef()`, `toast(msg)`.
- Produces: user-facing `y`/`Y` shortcuts; no new programmatic interfaces.

- [ ] **Step 1: Add the key branch**

In the main `document.addEventListener('keydown', ...)` handler in `index.html`, immediately after the line
`if (k === 'Enter' || k === 'o') { toggleExpand(); return; }` (`index.html:1284`), insert:

```js
  if (k === 'y' || k === 'Y') {
    const r = selRef();
    if (!r) return;
    const text = k === 'y' ? r.task.title : Core.subtreeText(r.task);
    try { await navigator.clipboard.writeText(text); toast(k === 'y' ? 'Copied title' : 'Copied org block'); }
    catch { toast('Copy failed'); }
    return;
  }
```

No `preventDefault()` needed: neither key focuses an input. Note the handler is `async`, so `await` is legal.

- [ ] **Step 2: Add help table rows**

In the `#help` table in `index.html`, after the `m` row (`index.html:123`), insert:

```html
<tr><td><kbd>y</kbd></td><td>copy title to clipboard</td></tr>
<tr><td><kbd>Y</kbd></td><td>copy org block (with sub-tasks) to clipboard</td></tr>
```

- [ ] **Step 3: Extend the e2e test**

In `tests/ui-e2e.mjs`, after the last check (`j walks past duplicate-named tasks ...`) and BEFORE `ws.close()`, append:

```js
// --- y / Y copy title / org block to the clipboard ---
await evaljs(`(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: t => { window.__copied = t; return Promise.resolve(); } },
    configurable: true,
  });
  __files.set('home.org', __files.get('home.org') +
    '* TODO Copy me :tag:\\n  note line\\n** DONE child\\n');
  __mtimes.set('home.org', 99999999);
  return true;
})()`);
await sleep(2500);
await evaljs(`(() => {
  const i = App.visible.findIndex(r => r.task.title === 'Copy me');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
  return i;
})()`);
await key('y', 'KeyY', 'y', 89);
await sleep(150);
const copiedTitle = await evaljs(`window.__copied`);
check('y copies the plain title', copiedTitle === 'Copy me', JSON.stringify(copiedTitle));
await key('Y', 'KeyY', 'Y', 89);
await sleep(150);
const copiedBlock = await evaljs(`window.__copied`);
check('Y copies the org block including sub-tasks',
      copiedBlock === '* TODO Copy me :tag:\n  note line\n** DONE child\n',
      JSON.stringify(copiedBlock));
```

(Capital keys are dispatched without a modifiers flag in this harness — see `key('A', 'KeyA', 'A', 65)` at `tests/ui-e2e.mjs:219`.)

- [ ] **Step 4: Run the e2e and unit suites**

Run: `node tests/ui-e2e.mjs`
Expected: ends with `all e2e checks passed`, including the two new checks.

Run: `node --test 'tests/*.test.mjs'`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m 'feat: y/Y copy the selected task title / org block to the clipboard'
```
