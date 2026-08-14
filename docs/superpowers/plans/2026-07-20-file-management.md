# File Management + Cross-File Moves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-folder model with individually connected `.org` files (see/connect/disconnect via an `F` panel) and let `m` move a top-level task — including its pasted images — to another file.

**Architecture:** Connections become `{dir: FileSystemDirectoryHandle, name: string}` pairs persisted in IndexedDB (`files` key); the dir handle is kept because the File System Access API cannot reach a file's parent, and the image feature needs the sibling `images/` folder. CORE gains three pure functions (`taskBlock`, `removeTaskAt`, `appendRaw`) so a move is append-to-target-then-remove-from-source with byte-for-byte block transfer. All picker/permission/panel/image code stays in APP.

**Tech Stack:** Vanilla JS in `index.html` (no build, no deps), `node --test` units via `tests/harness.mjs`, CDP e2e via `tests/ui-e2e.mjs`.

**Spec:** `docs/superpowers/specs/2026-07-20-file-management-design.md`

## Global Constraints

- The round-trip invariant is stop-the-line: `Core.serializeFile(Core.parseOrg(text)) === text` byte-for-byte when nothing was edited. If a round-trip test fails, fix the code, never the test.
- CORE (between `// ===== CORE START =====` and `// ===== CORE END =====`) must never touch `document`/`window`; everything added to CORE is exported through the IIFE's `return {...}` and unit-tested. Do not alter the marker comments.
- APP functions the e2e test monkey-patches must stay top-level `function` declarations (they become global properties). After this plan they are: `showDirectoryPicker` (window), `idbSet`, `connectNames`, `confirm` (window).
- Unit tests: `node --test 'tests/*.test.mjs'` (the glob is required; a bare directory arg does not work). e2e: `node tests/ui-e2e.mjs`.
- Topic = filename minus `.org`, unique across the app; clashes are refused with a toast.
- Chromium-only, no CRLF support, same-parent-only drag — unchanged accepted limitations.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (repo has `commit.gpgsign=false` set locally; plain `git commit` works).

---

### Task 1: CORE block-move primitives (`taskBlock`, `removeTaskAt`, `appendRaw`)

**Files:**
- Modify: `index.html` — CORE section, right after `addTask` (currently ends at line 318) and the IIFE `return {...}` (currently lines 402–405)
- Create: `tests/movefile.test.mjs`

**Interfaces:**
- Consumes: existing CORE internals `nodeText`, `normalizeNewlines`, `parseTaskBlock` (all already defined in the IIFE).
- Produces (used by Tasks 4–5 from APP):
  - `Core.taskBlock(file, index) -> string | null` — full raw text of the top-level task at `index` (heading + planning + drawer + body + all children), always ending in `\n`; `null` if out of range; does not mutate.
  - `Core.removeTaskAt(file, index) -> string | null` — same string, but also removes the task from `file.tasks` and normalizes newlines; `null` (no mutation) if out of range.
  - `Core.appendRaw(file, block) -> task` — parses `block` with `parseTaskBlock` and pushes it onto `file.tasks` with `dirty: false`, so it serializes verbatim; ensures a non-empty `file.preamble` on a task-less file ends with `\n` first; returns the new task node.

- [ ] **Step 1: Write the failing tests**

Create `tests/movefile.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

const RICH =
  '#+TITLE: Source\n\n' +
  '* TODO keep me\n' +
  '* NEXT [#A] Move me :tag:\n' +
  '  DEADLINE: <2026-07-25 Sat>\n' +
  '  :PROPERTIES:\n  :Effort:   2h\n  :END:\n' +
  '  some note\n\n  [[file:images/shot-1.png]]\n' +
  '** TODO child one\n   child body\n' +
  '** DONE child two\n*** deep stays\n    deep body\n' +
  '* TODO also keep\n';

test('taskBlock returns the full block without mutating', () => {
  const f = Core.parseOrg(RICH);
  const block = Core.taskBlock(f, 1);
  assert.ok(block.startsWith('* NEXT [#A] Move me :tag:\n'));
  assert.ok(block.includes('** TODO child one\n'));
  assert.ok(block.includes('*** deep stays\n'));
  assert.ok(block.endsWith('\n'));
  assert.equal(Core.serializeFile(f), RICH);          // untouched
  assert.equal(Core.taskBlock(f, 9), null);
});

test('removeTaskAt removes the block and leaves the rest byte-identical', () => {
  const f = Core.parseOrg(RICH);
  const block = Core.removeTaskAt(f, 1);
  assert.equal(Core.serializeFile(f), '#+TITLE: Source\n\n* TODO keep me\n* TODO also keep\n');
  assert.equal(block, Core.taskBlock(Core.parseOrg(RICH), 1));
});

test('remove + append moves a block byte-for-byte', () => {
  const src = Core.parseOrg(RICH);
  const dst = Core.parseOrg('* TODO existing\n');
  const block = Core.removeTaskAt(src, 1);
  Core.appendRaw(dst, block);
  assert.equal(Core.serializeFile(dst), '* TODO existing\n' + block);
  const out = Core.serializeFile(dst);
  assert.equal(Core.serializeFile(Core.parseOrg(out)), out);   // parse-stable in its new home
});

test('appendRaw onto an empty file', () => {
  const dst = Core.parseOrg('');
  Core.appendRaw(dst, '* TODO x\n');
  assert.equal(Core.serializeFile(dst), '* TODO x\n');
});

test('appendRaw onto preamble-only file without trailing newline', () => {
  const dst = Core.parseOrg('just some notes');
  Core.appendRaw(dst, '* TODO x\n');
  assert.equal(Core.serializeFile(dst), 'just some notes\n* TODO x\n');
});

test('appendRaw after a last block missing its trailing newline', () => {
  const dst = Core.parseOrg('* TODO a\n** child no newline');
  Core.appendRaw(dst, '* TODO x\n');
  assert.equal(Core.serializeFile(dst), '* TODO a\n** child no newline\n* TODO x\n');
});

test('appendRaw normalizes a block missing its trailing newline', () => {
  const dst = Core.parseOrg('* TODO a\n');
  Core.appendRaw(dst, '* TODO x');
  assert.equal(Core.serializeFile(dst), '* TODO a\n* TODO x\n');
});

test('taskBlock on a last task missing its trailing newline adds one', () => {
  const f = Core.parseOrg('* TODO a\n* TODO b\n** child no newline');
  assert.equal(Core.taskBlock(f, 1), '* TODO b\n** child no newline\n');
});

test('removeTaskAt out of range returns null and mutates nothing', () => {
  const f = Core.parseOrg('* TODO a\n');
  assert.equal(Core.removeTaskAt(f, 1), null);
  assert.equal(Core.removeTaskAt(f, -1), null);
  assert.equal(Core.serializeFile(f), '* TODO a\n');
});

test('appended block keeps dirty=false and survives an unrelated edit', () => {
  const dst = Core.parseOrg('* TODO existing\n');
  const t = Core.appendRaw(dst, '* NEXT moved :x:\n  DEADLINE: <2026-07-25 Sat>\n  odd   spacing kept\n');
  assert.equal(t.dirty, false);
  Core.setPriority(dst.tasks[0], 'B');
  const out = Core.serializeFile(dst);
  assert.ok(out.endsWith('* NEXT moved :x:\n  DEADLINE: <2026-07-25 Sat>\n  odd   spacing kept\n'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/movefile.test.mjs`
Expected: FAIL — `Core.taskBlock is not a function` (and the same for the others).

- [ ] **Step 3: Implement in CORE**

In `index.html`, directly after the `addTask` function (after its closing `}` at line 318), add:

```js
  const blockText = t => nodeText(t) + t.children.map(nodeText).join('');
  function taskBlock(file, index) {
    const t = file.tasks[index];
    if (!t) return null;
    const b = blockText(t);
    return b.endsWith('\n') ? b : b + '\n';
  }
  function removeTaskAt(file, index) {
    const block = taskBlock(file, index);
    if (block == null) return null;
    file.tasks.splice(index, 1);
    normalizeNewlines(file);
    return block;
  }
  function appendRaw(file, block) {
    if (!block.endsWith('\n')) block += '\n';
    if (!file.tasks.length && file.preamble && !file.preamble.endsWith('\n')) file.preamble += '\n';
    const t = parseTaskBlock(block);
    file.tasks.push(t);
    normalizeNewlines(file);
    return t;
  }
```

Then add the three names to the IIFE's return (currently lines 402–405), keeping the existing list intact:

```js
  return { version: 1, dayName, addDays, orgActive, orgInactive, parseDateToken, parseOrg,
           renderTask, serializeFile, setState, setPriority, setTitle, setTags, setDeadline,
           setProp, setEffort, appendBody, setBody, makeTask, moveTask, addTask, parseQuickAdd,
           taskBlock, removeTaskAt, appendRaw,
           deadlineBucket, buildModel, matchesFilter, matchesFamily, sortRecent };
```

- [ ] **Step 4: Run the full unit suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: all tests PASS, including every pre-existing round-trip test.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/movefile.test.mjs
git commit -m "feat: Core.taskBlock/removeTaskAt/appendRaw move blocks between files byte-for-byte"
```

---

### Task 2: Replace the folder model with per-file connections

**Files:**
- Modify: `index.html` — APP section: `App` object (line 413), IndexedDB helpers (after line 463), boot/openFolder/start/scanTick (lines 486–534), `scanOnce` (537–563), `render()` file filter (line 568), `loadImg`/`bodyView` (729–756), `createTopic` (800–806), quick-add handler (830–834), paste handler (1049–1077), help copy (lines 84–87)
- Modify: `tests/ui-e2e.mjs` — setup block (lines 85–114)

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces (used by Tasks 3–5):
  - `App.files` entries: `{ topic, dir, name, handle, lastModified, text, file, parseError, broken }`.
  - `function makeEntry(dir, name) -> entry` (fresh entry, `handle: null`, `broken: false`).
  - `async function persistFiles()` — writes `App.files.map(e => ({dir: e.dir, name: e.name}))` to IndexedDB key `files`.
  - `async function connectNames(dir, names) -> number` — connects the given `.org` filenames from `dir` (topic clashes toasted + skipped), persists, starts scanning; returns count added. **Top-level function; the e2e test calls it directly.**
  - `async function listOrgNames(dir) -> string[]` — sorted `.org` filenames in a directory handle.
  - `async function connectFolder()` — directory picker → `connectNames(dir, all names)` (interim connect-all; Task 3 replaces its caller with the checklist flow).
  - `async function createTopicInDir(dir, topic) -> entry` — creates/opens `topic + '.org'` in `dir` **loading existing content instead of clobbering**, connects + persists it, ensures the poll timer runs.
  - `async function createTopic(topic) -> entry | null` — quick-add path: `createTopicInDir` next to the last-used topic's file (fallback: first connected file); `null` + toast when nothing is connected.
  - IndexedDB: key `files` replaces key `dir` (deleted at boot via new `idbDel`).

- [ ] **Step 1: Rewrite the e2e setup to drive the new connect path (failing first)**

In `tests/ui-e2e.mjs`, replace the whole `const setup = await evaljs(...)` block (lines 85–114, up to and including the `check('page boots with fake folder...')` line) with:

```js
const setup = await evaljs(`(async () => {
  let clock = 100;
  const fileHandle = (files, mtimes, name) => ({
    kind: 'file', name,
    async getFile() { return new File([files.get(name)], name, { lastModified: mtimes.get(name) || 1 }); },
    async createWritable() {
      let buf = '';
      return { async write(x) { buf += (typeof x === 'string') ? x : new TextDecoder().decode(x); },
               async close() { files.set(name, buf); mtimes.set(name, ++clock); } };
    },
  });
  const imagesHandle = imgs => ({
    kind: 'directory',
    async getFileHandle(name, opts) {
      if (!imgs.has(name)) {
        if (!(opts && opts.create)) throw new DOMException('nf', 'NotFoundError');
        imgs.set(name, '');
      }
      return { kind: 'file', name,
        async getFile() { return new File([imgs.get(name)], name); },
        async createWritable() {
          let buf = '';
          return { async write(x) { buf += (typeof x === 'string') ? x : new TextDecoder().decode(x); },
                   async close() { imgs.set(name, buf); } };
        } };
    },
    async removeEntry(name) { if (!imgs.delete(name)) throw new DOMException('nf', 'NotFoundError'); },
  });
  const makeFakeDir = (files, mtimes, imgs) => {
    const dir = {
      kind: 'directory',
      async *entries() { for (const name of files.keys()) yield [name, fileHandle(files, mtimes, name)]; },
      async getFileHandle(name, opts) {
        if (!files.has(name)) {
          if (!(opts && opts.create)) throw new DOMException('nf', 'NotFoundError');
          files.set(name, ''); mtimes.set(name, ++clock);
        }
        return fileHandle(files, mtimes, name);
      },
      async getDirectoryHandle(name, opts) {
        if (name !== 'images') throw new DOMException('nf', 'NotFoundError');
        return imagesHandle(imgs);
      },
      async isSameEntry(o) { return o === dir; },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
    return dir;
  };
  window.__files = new Map([
    ['home.org', '* TODO [#B] Renew car insurance :paperwork:\\n  DEADLINE: <2026-07-20 Mon>\\n* TODO Garage cleanup\\n'],
  ]);
  window.__mtimes = new Map([['home.org', 1]]);
  window.__imagesA = new Map();
  window.__dirA = makeFakeDir(__files, __mtimes, __imagesA);
  window.__filesB = new Map([['work.org', '* TODO Work task\\n']]);
  window.__mtimesB = new Map([['work.org', 1]]);
  window.__imagesB = new Map();
  window.__dirB = makeFakeDir(__filesB, __mtimesB, __imagesB);
  window.idbSet = async () => {};
  window.confirm = () => true;
  await connectNames(__dirA, ['home.org']);
  for (let i = 0; i < 30 && !App.visible.length; i++) await new Promise(r => setTimeout(r, 100));
  return { visible: App.visible.length, sel: App.sel };
})()`);
check('page boots with a connected fake file, tasks visible', setup.visible === 2, JSON.stringify(setup));
```

(`__dirB`/`__filesB`/`__imagesA`/`__imagesB`/`window.confirm` are unused until Tasks 3–5 but defined here so later tasks only append checks.)

- [ ] **Step 2: Run e2e to verify it fails**

Run: `node tests/ui-e2e.mjs`
Expected: FAIL — `connectNames is not defined`.

- [ ] **Step 3: Rewrite the APP connection layer**

All edits in `index.html`, APP section.

**3a.** In the `App` object (line 413), delete the `dir: null,` line.

**3b.** After `idbSet` (line 463), add:

```js
async function idbDel(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite').objectStore('kv').delete(k);
    t.onsuccess = () => res(); t.onerror = () => rej(t.error);
  });
}
```

**3c.** Replace `boot`, `openFolder`, `start`, and `scanTick` (lines 485–534, the whole `// --- boot / folder access ---` block) with:

```js
// --- boot / file connections ---
function makeEntry(dir, name) {
  return { topic: name.slice(0, -4), dir, name, handle: null,
           lastModified: 0, text: '', file: null, parseError: false, broken: false };
}
async function persistFiles() {
  await idbSet('files', App.files.map(e => ({ dir: e.dir, name: e.name })));
}
async function boot() {
  if (!window.showDirectoryPicker) {
    banner('This app needs Chrome or Edge — it reads your org files with the File System Access API.');
    return;
  }
  await idbDel('dir').catch(() => {});   // pre-connections folder key, no migration
  const saved = await idbGet('files').catch(() => null);
  if (!saved || !saved.length) {
    banner('No files connected yet.', 'Connect files', connectFolder);
    return;
  }
  App.files = saved.map(s => makeEntry(s.dir, s.name));
  App.files.sort((a, b) => a.topic.localeCompare(b.topic));
  let granted = true;
  for (const e of App.files) {
    if (await e.dir.queryPermission({ mode: 'readwrite' }) !== 'granted') { granted = false; break; }
  }
  if (granted) return start();
  banner('File access needs to be re-granted.', 'Reconnect files', regrantAll);
}
async function regrantAll() {
  for (const e of App.files) {
    if (await e.dir.queryPermission({ mode: 'readwrite' }) !== 'granted')
      await e.dir.requestPermission({ mode: 'readwrite' });
  }
  hideBanner();
  start();
}
async function listOrgNames(dir) {
  const names = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file' && name.endsWith('.org')) names.push(name);
  }
  return names.sort();
}
async function connectNames(dir, names) {
  let added = 0;
  for (const name of names) {
    const topic = name.slice(0, -4);
    if (findEntry(topic)) { toast('Topic "' + topic + '" already connected — skipped'); continue; }
    App.files.push(makeEntry(dir, name));
    added++;
  }
  if (added) {
    App.files.sort((a, b) => a.topic.localeCompare(b.topic));
    await persistFiles();
    await start();
  }
  return added;
}
async function connectFolder() {
  try {
    const dir = await showDirectoryPicker({ mode: 'readwrite' });
    hideBanner();
    await connectNames(dir, await listOrgNames(dir));
  } catch (e) { /* user cancelled the picker */ }
}
let scanning = false;
let pollTimer = null;
async function start() {
  await scanTick();
  if (!pollTimer) pollTimer = setInterval(scanTick, 1500);
}
async function scanTick() {
  if (scanning || !App.files.length) return;
  scanning = true;
  try {
    if (await scanOnce()) render();
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
      clearInterval(pollTimer); pollTimer = null;
      banner('File access was lost.', 'Reconnect files', regrantAll);
    }
  } finally {
    scanning = false;
  }
}
```

**3d.** Replace `scanOnce` (the whole `// --- scanning ---` block, lines 536–563) with:

```js
// --- scanning: poll each connected handle, no directory enumeration ---
async function scanOnce() {
  let changed = false;
  for (const entry of App.files) {
    try {
      if (!entry.handle) entry.handle = await entry.dir.getFileHandle(entry.name);
      const f = await entry.handle.getFile();
      if (entry.broken) { entry.broken = false; changed = true; }
      if (f.lastModified !== entry.lastModified) {
        entry.lastModified = f.lastModified;
        entry.text = await f.text();
        try { entry.file = Core.parseOrg(entry.text); entry.parseError = false; }
        catch (e) { entry.parseError = true; }
        changed = true;
      }
    } catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e;
      entry.handle = null;                      // deleted/renamed on disk: broken, recoverable
      if (!entry.broken) { entry.broken = true; changed = true; }
    }
  }
  return changed;
}
```

**3e.** In `render()` (line 568), extend the filter:

```js
  const files = App.files.filter(e => e.file && !e.parseError && !e.broken).map(e => ({ topic: e.topic, file: e.file }));
```

**3f.** Replace `loadImg` (lines 729–740) and the `loadImg(img, m[1])` call inside `bodyView` (line 747):

```js
async function loadImg(img, path, entry) {
  const key = entry.topic + '|' + path;
  if (imgUrls.has(key)) { img.src = imgUrls.get(key); return; }
  try {
    const dir = await entry.dir.getDirectoryHandle('images');
    const fh = await dir.getFileHandle(path.slice('images/'.length));
    const url = URL.createObjectURL(await fh.getFile());
    imgUrls.set(key, url);
    img.src = url;
  } catch {
    img.alt = 'missing: ' + path;
  }
}
```

and in `bodyView`:

```js
    if (m) {
      const img = document.createElement('img');
      const entry = findEntry(ref.topic);
      if (entry) loadImg(img, m[1], entry); else img.alt = 'missing: ' + m[1];
      box.append(img);
    }
```

**3g.** Replace `createTopic` (lines 800–806) with:

```js
async function createTopicInDir(dir, topic) {
  const name = topic + '.org';
  const handle = await dir.getFileHandle(name, { create: true });
  const entry = makeEntry(dir, name);
  entry.handle = handle;
  const f = await handle.getFile();            // existing file: load it, never clobber
  entry.lastModified = f.lastModified;
  entry.text = await f.text();
  try { entry.file = Core.parseOrg(entry.text); } catch { entry.parseError = true; }
  App.files.push(entry);
  App.files.sort((a, b) => a.topic.localeCompare(b.topic));
  await persistFiles();
  if (!pollTimer) pollTimer = setInterval(scanTick, 1500);
  return entry;
}
async function createTopic(topic) {
  const base = findEntry(App.lastTopic) || App.files[0];
  if (!base) { toast('Connect a folder first (F)'); return null; }
  return createTopicInDir(base.dir, topic);
}
```

**3h.** In the quick-add Enter handler (lines 830–834), guard the null return:

```js
  let entry = findEntry(topic);
  if (!entry) {
    if (!confirm('Create new topic file "' + topic + '.org"?')) return;
    entry = await createTopic(topic);
    if (!entry) return;
  }
```

**3i.** In the paste handler (line 1053), replace `if (!r || !App.dir) return;` and the `App.dir` use (line 1060):

```js
  const r = selRef();
  if (!r) return;
  const entry = findEntry(r.topic);
  if (!entry) return;
```

and

```js
    const dir = await entry.dir.getDirectoryHandle('images', { create: true });
```

**3j.** Update the help copy (lines 84–87) to:

```html
<p>Your tasks are plain org-mode files you connect individually — one file per
topic (<code>work.org</code> → topic “work”). Edit them here or in any text
editor; the page picks up outside changes within ~2 seconds and writes your
UI edits back as clean org, never touching lines it doesn't understand.</p>
```

- [ ] **Step 4: Run unit tests, then e2e**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS (CORE untouched by this task).

Run: `node tests/ui-e2e.mjs`
Expected: all existing checks PASS (boot via `connectNames`, heading edit, deadline, sub-tasks, notes, fold, radar, filter).

- [ ] **Step 5: Manual smoke check**

Serve with `python3 -m http.server` from the repo root, open `http://localhost:8000/index.html` in Chrome: banner offers "Connect files"; picking `sample-tasks/` connects `home` and `work`; tasks render; editing writes back; images in expanded tasks still load (they live in `sample-tasks/images/`). Reload: entries persist (or a "Reconnect files" banner re-grants in one click).

- [ ] **Step 6: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: per-file connections replace the folder model (dir+name pairs in IndexedDB)"
```

---

### Task 3: Files panel (`F`) — list, disconnect, connect checklist, new file

**Files:**
- Modify: `index.html` — CSS block (after the `#help` rules, line 54), HTML before `<div id="toast">` (line 130), help shortcuts table (line 111–128), `App` object, APP code after the quick-add block, global keydown handler (line 921), boot banner button
- Modify: `tests/ui-e2e.mjs` — append checks before `ws.close()` (line 287)

**Interfaces:**
- Consumes (Task 2): `App.files` entries, `makeEntry`, `persistFiles`, `connectNames`, `listOrgNames`, `createTopicInDir`, `findEntry`, `render`, `toast`, `start`.
- Produces (used by Task 4's e2e flow only, no code deps): `App.panel = { open, idx, mode: 'list'|'pick'|'new', dir, names, checked }`, `function openPanel()`, `function closePanel()`, `function renderPanel()`, `async function disconnectAt(i)`, `async function startPick()`, `async function confirmPick()`.

- [ ] **Step 1: Extend the e2e test (failing first)**

In `tests/ui-e2e.mjs`, insert before the final `ws.close();` (line 287):

```js
// --- files panel: F opens, lists connected files ---
await key('F', 'KeyF', 'F', 70);
await sleep(250);
const panelOpen = await evaljs(`({
  open: !document.querySelector('#files-panel').hidden,
  rows: document.querySelectorAll('#files-list .frow').length,
  text: document.querySelector('#files-list').textContent,
})`);
check('F opens the files panel listing the connected file',
      panelOpen.open && panelOpen.rows === 1 && panelOpen.text.includes('home.org'),
      JSON.stringify(panelOpen));

// --- connect another folder through the checklist ---
await evaljs(`(window.showDirectoryPicker = async () => __dirB, true)`);
await key('c', 'KeyC', 'c', 67);
await sleep(300);
check('c opens the folder checklist', await evaljs(`App.panel.mode`) === 'pick');
await key('Enter', 'Enter', '\r', 13);
await sleep(600);
const afterConnect = await evaljs(`({
  mode: App.panel.mode,
  topics: App.files.map(e => e.topic).join(','),
  backlog: document.querySelector('#backlog-list').textContent,
})`);
check('checklist Enter connects work.org', afterConnect.topics === 'home,work', JSON.stringify(afterConnect));
check('connected file renders in the backlog', afterConnect.backlog.includes('Work task'), JSON.stringify(afterConnect.backlog));

// --- disconnect with x: entry gone, file untouched on disk ---
await key('j', 'KeyJ', 'j', 74);
await key('x', 'KeyX', 'x', 88);
await sleep(300);
const afterX = await evaljs(`({
  topics: App.files.map(e => e.topic).join(','),
  backlog: document.querySelector('#backlog-list').textContent,
  fileKept: __filesB.get('work.org'),
})`);
check('x disconnects the selected file', afterX.topics === 'home', JSON.stringify(afterX.topics));
check('disconnected topic leaves the backlog', !afterX.backlog.includes('Work task'));
check('disconnect leaves the file on disk', afterX.fileKept === '* TODO Work task\n', JSON.stringify(afterX.fileKept));
await key('Escape', 'Escape', undefined, 27);
await sleep(200);
check('Esc closes the panel', await evaljs(`document.querySelector('#files-panel').hidden`));
// reconnect work.org for the move tests
await evaljs(`connectNames(__dirB, ['work.org'])`);
await sleep(400);
```

- [ ] **Step 2: Run e2e to verify the new checks fail**

Run: `node tests/ui-e2e.mjs`
Expected: previous checks PASS; new checks FAIL (no `#files-panel` element).

- [ ] **Step 3: Add panel HTML + CSS**

In the `<style>` block after the `#help code` rule (line 54), add:

```css
#files-panel { position:fixed; inset:15% 25%; overflow:auto; background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:0 8px 30px rgba(0,0,0,.15); padding:20px 24px; z-index:8; }
.frow { display:flex; gap:10px; align-items:center; padding:5px 8px; border-radius:8px; }
.frow.sel { background:var(--sel); outline:1px solid var(--accent); }
.frow .fname { flex:1 1 auto; }
.frow .fstatus { color:var(--muted); font-size:12px; }
.frow.muted { color:var(--muted); }
#files-panel input { width:100%; font:inherit; padding:6px 8px; border:1px solid var(--accent); border-radius:6px; }
#files-hint { color:var(--muted); font-size:12px; margin-top:10px; }
```

In the HTML, before `<div id="toast" hidden></div>` (line 130), add:

```html
<div id="files-panel" hidden>
<h2>Connected files</h2>
<div id="files-list"></div>
<p id="files-hint"></p>
</div>
```

In the help shortcuts table add a row after the `A` row (line 116):

```html
<tr><td><kbd>F</kbd></td><td>manage connected files</td></tr>
```

- [ ] **Step 4: Implement the panel**

In the `App` object add:

```js
  panel: { open: false, idx: 0, mode: 'list', dir: null, names: [], checked: new Set() },
```

After the quick-add block (after line 840), add:

```js
// --- files panel ---
function openPanel() {
  App.panel.open = true; App.panel.mode = 'list'; App.panel.idx = 0;
  renderPanel();
}
function closePanel() {
  App.panel.open = false;
  $('#files-panel').hidden = true;
}
function panelItemCount() {
  return App.panel.mode === 'pick' ? App.panel.names.length : App.files.length;
}
function renderPanel() {
  const p = App.panel;
  $('#files-panel').hidden = !p.open;
  if (!p.open) return;
  const box = $('#files-list');
  if (p.mode === 'pick') {
    box.replaceChildren(...p.names.map((name, i) => {
      const row = div('frow' + (i === p.idx ? ' sel' : ''));
      const taken = !!findEntry(name.slice(0, -4));
      if (taken) row.classList.add('muted');
      row.textContent = taken ? '·   ' + name + ' — already connected'
                              : (p.checked.has(name) ? '[x] ' : '[ ] ') + name;
      return row;
    }));
    $('#files-hint').textContent = 'space toggle · Enter connect checked · Esc back';
    return;
  }
  if (p.mode === 'new') {
    const inp = document.createElement('input');
    inp.placeholder = 'new topic name — Enter, then choose its folder';
    box.replaceChildren(inp);
    $('#files-hint').textContent = 'Enter continue · Esc back';
    inp.focus();
    inp.onkeydown = async ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { p.mode = 'list'; renderPanel(); return; }
      if (ev.key !== 'Enter') return;
      const topic = inp.value.trim().toLowerCase();
      if (!/^[\w-]+$/.test(topic)) { toast('Topic names are letters, digits, - and _'); return; }
      if (findEntry(topic)) { toast('Topic "' + topic + '" already connected'); return; }
      try {
        const dir = await showDirectoryPicker({ mode: 'readwrite' });
        await createTopicInDir(dir, topic);
        p.mode = 'list'; p.idx = 0;
        render(); renderPanel();
        toast(topic + '.org created and connected');
      } catch { /* user cancelled the picker */ }
    };
    return;
  }
  // list mode
  if (!App.files.length) {
    const row = div('frow muted');
    row.textContent = 'No files connected — press c to connect a folder';
    box.replaceChildren(row);
  } else {
    box.replaceChildren(...App.files.map((e, i) => {
      const row = div('frow' + (i === p.idx ? ' sel' : ''));
      const name = span('fname'); name.textContent = e.name;
      const st = span('fstatus');
      st.textContent = e.broken ? 'unreadable' : e.parseError ? 'parse error'
                     : e.file ? e.file.tasks.length + ' tasks' : '…';
      const btn = document.createElement('button');
      btn.className = 'chip'; btn.textContent = 'disconnect';
      btn.onclick = () => disconnectAt(i);
      row.append(name, st, btn);
      return row;
    }));
  }
  $('#files-hint').textContent = 'j/k move · x disconnect · c connect folder · n new file · Esc close';
}
async function disconnectAt(i) {
  const e = App.files[i];
  if (!e) return;
  App.files.splice(i, 1);
  App.panel.idx = Math.max(0, Math.min(App.panel.idx, App.files.length - 1));
  await persistFiles();
  toast('Disconnected ' + e.name + ' — file kept on disk');
  render(); renderPanel();
}
async function startPick() {
  try {
    const dir = await showDirectoryPicker({ mode: 'readwrite' });
    const names = await listOrgNames(dir);
    if (!names.length) { toast('No .org files in that folder'); return; }
    App.panel.dir = dir;
    App.panel.names = names;
    App.panel.checked = new Set(names.filter(n => !findEntry(n.slice(0, -4))));
    App.panel.mode = 'pick'; App.panel.idx = 0;
    renderPanel();
  } catch { /* user cancelled the picker */ }
}
async function confirmPick() {
  const added = await connectNames(App.panel.dir, [...App.panel.checked]);
  App.panel.mode = 'list'; App.panel.idx = 0;
  renderPanel();
  toast(added + ' file(s) connected');
}
```

- [ ] **Step 5: Wire the keyboard**

In the global keydown handler, immediately after `const k = e.key;` (line 924), add:

```js
  if (App.panel.open) {
    const p = App.panel;
    if (k === 'Escape') {
      e.preventDefault();
      if (p.mode === 'list') closePanel(); else { p.mode = 'list'; p.idx = 0; renderPanel(); }
      return;
    }
    if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); p.idx = Math.min(p.idx + 1, Math.max(0, panelItemCount() - 1)); renderPanel(); return; }
    if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); p.idx = Math.max(p.idx - 1, 0); renderPanel(); return; }
    if (p.mode === 'list') {
      if (k === 'x') { disconnectAt(p.idx); return; }
      if (k === 'c') { startPick(); return; }
      if (k === 'n') { p.mode = 'new'; renderPanel(); return; }
    } else if (p.mode === 'pick') {
      if (k === ' ') {
        e.preventDefault();
        const name = p.names[p.idx];
        if (name && !findEntry(name.slice(0, -4)))
          p.checked.has(name) ? p.checked.delete(name) : p.checked.add(name);
        renderPanel(); return;
      }
      if (k === 'Enter') { confirmPick(); return; }
    }
    return;   // panel swallows all other keys while open
  }
  if (k === 'F') { e.preventDefault(); openPanel(); return; }
```

Also change the empty-state boot banner (in `boot()`, from Task 2) to route through the checklist:

```js
    banner('No files connected yet.', 'Connect files', () => { openPanel(); startPick(); });
```

(`connectFolder` becomes unused — delete it.)

- [ ] **Step 6: Run e2e and units**

Run: `node tests/ui-e2e.mjs` — Expected: all checks PASS including the new panel ones.
Run: `node --test 'tests/*.test.mjs'` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: F files panel — list/disconnect/connect checklist/new file"
```

---

### Task 4: `m` moves a task to another file (same-folder + create-on-unknown)

**Files:**
- Modify: `index.html` — APP: new `moveSelTo` after `createTopic` (Task 2's 3g block), `m` branch in the global keydown handler, help table row
- Modify: `tests/ui-e2e.mjs` — append checks before `ws.close()`

**Interfaces:**
- Consumes: `Core.taskBlock`, `Core.removeTaskAt`, `Core.appendRaw` (Task 1); `createTopicInDir`, `findEntry`, `saveFile`, `selRef`, `taskKey`, `inlineEdit`, `toast` (existing/Task 2).
- Produces (extended by Task 5): `async function moveSelTo(targetTopic)` — moves the selected top-level task to the end of `targetTopic`'s file; Task 5 inserts the image step inside it.

- [ ] **Step 1: Extend the e2e test (failing first)**

Insert before `ws.close();`:

```js
// --- m moves a whole block to another topic, byte-for-byte ---
await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Garage cleanup');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
  return App.sel;
})()`);
const homeBefore = await evaljs(`__files.get('home.org')`);
await key('m', 'KeyM', 'm', 77);
await sleep(250);
check('m opens the move prompt', await evaljs(`!!document.querySelector('.editor input')`));
await cdp('Input.insertText', { text: 'work' });
await key('Enter', 'Enter', '\r', 13);
await sleep(800);
const afterMove = await evaljs(`({
  home: __files.get('home.org'),
  work: __filesB.get('work.org'),
  sel: App.sel,
})`);
const gi = homeBefore.indexOf('* TODO Garage cleanup');
const ri = homeBefore.indexOf('* TODO Radar parent');
const movedBlock = homeBefore.slice(gi, ri);
check('moved block leaves the source file', !afterMove.home.includes('Garage cleanup'), JSON.stringify(afterMove.home));
check('moved block lands byte-for-byte at the end of the target',
      afterMove.work === '* TODO Work task\n' + movedBlock,
      JSON.stringify({ work: afterMove.work, movedBlock }));
check('selection follows the moved task', !!afterMove.sel && afterMove.sel.startsWith('work\t'), JSON.stringify(afterMove.sel));

// --- m on a sub-task refuses ---
await evaljs(`(() => { App.filter.text = 'sort tools'; render(); return true; })()`);
await evaljs(`(() => {
  const r = App.visible.find(r => r.parent && r.task.title === 'Sort tools');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
  return App.sel;
})()`);
await key('m', 'KeyM', 'm', 77);
await sleep(250);
check('m on a sub-task shows no editor', await evaljs(`!document.querySelector('.editor input')`));
await evaljs(`(() => { App.filter.text = ''; document.querySelector('#search').value = ''; render(); return true; })()`);

// --- m to an unknown topic creates the file in the source folder ---
await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Radar parent');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
  return App.sel;
})()`);
await key('m', 'KeyM', 'm', 77);
await sleep(250);
await cdp('Input.insertText', { text: 'archive' });
await key('Enter', 'Enter', '\r', 13);
await sleep(800);
const afterCreate = await evaljs(`({
  archive: __files.get('archive.org') ?? null,
  topics: App.files.map(e => e.topic).join(','),
  home: __files.get('home.org'),
})`);
check('unknown topic creates the file in the source folder (confirm accepted)',
      afterCreate.archive !== null && afterCreate.archive.includes('* TODO Radar parent\n** NEXT Radar child'),
      JSON.stringify(afterCreate.archive));
check('new topic is connected', afterCreate.topics.includes('archive'), afterCreate.topics);
check('source no longer holds the moved block', !afterCreate.home.includes('Radar parent'), JSON.stringify(afterCreate.home));
```

- [ ] **Step 2: Run e2e to verify the new checks fail**

Run: `node tests/ui-e2e.mjs`
Expected: earlier checks PASS; `m opens the move prompt` FAILS (no `m` binding yet).

- [ ] **Step 3: Implement `moveSelTo` and the `m` binding**

In `index.html`, after `createTopic` (Task 2's 3g block), add:

```js
// --- move a task to another file ---
async function moveSelTo(targetTopic) {
  const r = selRef();
  if (!r || r.parent) return;
  if (targetTopic === r.topic) return;
  const source = findEntry(r.topic);
  if (!source || source.parseError || source.broken) return;
  let target = findEntry(targetTopic);
  if (!target) {
    if (!confirm('Create new topic file "' + targetTopic + '.org" next to ' + r.topic + '.org?')) return;
    target = await createTopicInDir(source.dir, targetTopic);
  }
  if (target.parseError || target.broken) { toast('Cannot move into ' + targetTopic + '.org'); return; }
  const key = taskKey(r.task);
  const idx = source.file.tasks.findIndex(t => taskKey(t) === key);
  if (idx === -1) return;
  const block = Core.taskBlock(source.file, idx);
  // append to the target first: a failure mid-move duplicates, never loses
  await saveFile(target, file => { Core.appendRaw(file, block); });
  await saveFile(source, file => {
    const i = file.tasks.findIndex(t => taskKey(t) === key);
    if (i > -1) Core.removeTaskAt(file, i);
  });
  App.sel = targetTopic + '\t' + block.split('\n', 1)[0];
  render();
}
```

In the global keydown handler, next to the other single-letter branches (after the `E` branch is a good spot), add:

```js
  if (k === 'm') {
    e.preventDefault();
    const r = selRef();
    if (!r) return;
    if (r.parent) { toast('Sub-tasks move with their parent'); return; }
    inlineEdit('', 'move to topic — existing name, or a new one (created next to this file)', async v => {
      const topic = v.trim().toLowerCase();
      if (!topic) return;
      if (!/^[\w-]+$/.test(topic)) { toast('Topic names are letters, digits, - and _'); return; }
      await moveSelTo(topic);
    });
    return;
  }
```

Add a help-table row after the `Alt+↑/Alt+↓` row:

```html
<tr><td><kbd>m</kbd></td><td>move task to another file</td></tr>
```

- [ ] **Step 4: Run e2e and units**

Run: `node tests/ui-e2e.mjs` — Expected: all checks PASS.
Run: `node --test 'tests/*.test.mjs'` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/ui-e2e.mjs
git commit -m "feat: m moves the selected task to another file, creating unknown topics beside the source"
```

---

### Task 5: Images move with the task across folders

**Files:**
- Modify: `index.html` — APP: image-move helpers next to `moveSelTo`, two-line integration inside `moveSelTo`
- Modify: `tests/ui-e2e.mjs` — append checks before `ws.close()`
- Modify: `CLAUDE.md` — data-flow + e2e-gotcha bullets

**Interfaces:**
- Consumes: `moveSelTo` (Task 4), `IMG_RE` (existing, line 727), `App.files`, fake dirs' `getDirectoryHandle`/`isSameEntry`/`removeEntry` (Task 2 e2e).
- Produces: `async function moveBlockImages(block, source, target) -> {block, moved}` and `async function cleanupSourceImages(source, moved)` — internal to `moveSelTo`; no later task depends on them.

- [ ] **Step 1: Extend the e2e test (failing first)**

Insert before `ws.close();`:

```js
// --- cross-folder move copies images, renames on collision, rewrites the ref ---
await evaljs(`(() => {
  __files.set('home.org', __files.get('home.org') +
    '* TODO Shelf photo\\n  [[file:images/shelf-1.png]]\\n' +
    '* TODO Shelf photo copy\\n  [[file:images/shelf-1.png]]\\n');
  __imagesA.set('shelf-1.png', 'PNGDATA');
  __imagesB.set('shelf-1.png', 'OTHERDATA');   // same name in target: forces a rename
  __mtimes.set('home.org', 999999);
  return true;
})()`);
await sleep(2500);
await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Shelf photo');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass(); return App.sel;
})()`);
await key('m', 'KeyM', 'm', 77);
await sleep(250);
await cdp('Input.insertText', { text: 'work' });
await key('Enter', 'Enter', '\r', 13);
await sleep(900);
const img1 = await evaljs(`({
  work: __filesB.get('work.org'),
  a: [...__imagesA.keys()].join(','), b: [...__imagesB.keys()].join(','),
  copied: __imagesB.get('shelf-1-2.png') ?? null,
  target: __imagesB.get('shelf-1.png'),
})`);
check('collision copy gets a suffixed name with the source bytes',
      img1.copied === 'PNGDATA' && img1.target === 'OTHERDATA', JSON.stringify(img1));
check('moved block reference is rewritten to the new name',
      img1.work.includes('* TODO Shelf photo\n  [[file:images/shelf-1-2.png]]\n'), JSON.stringify(img1.work));
check('source image survives while another connected task still references it',
      img1.a.includes('shelf-1.png'), img1.a);

// --- moving the last referencing task deletes the source image ---
await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Shelf photo copy');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass(); return App.sel;
})()`);
await key('m', 'KeyM', 'm', 77);
await sleep(250);
await cdp('Input.insertText', { text: 'work' });
await key('Enter', 'Enter', '\r', 13);
await sleep(900);
const img2 = await evaljs(`({
  a: [...__imagesA.keys()].join(','), b: [...__imagesB.keys()].join(','),
  work: __filesB.get('work.org'),
})`);
check('source image is deleted once nothing connected references it',
      !img2.a.includes('shelf-1.png'), img2.a);
check('second copy takes the next free suffix',
      img2.b.includes('shelf-1-3.png') && img2.work.includes('[[file:images/shelf-1-3.png]]'),
      JSON.stringify(img2));
```

- [ ] **Step 2: Run e2e to verify the new checks fail**

Run: `node tests/ui-e2e.mjs`
Expected: earlier checks PASS; the collision/rewrite checks FAIL (block moved with the old reference, nothing copied).

- [ ] **Step 3: Implement the image-move helpers**

In `index.html`, directly above `moveSelTo`, add:

```js
function blockImagePaths(block) {
  const out = new Set();
  for (const line of block.split('\n')) {
    const m = line.match(IMG_RE);
    if (m) out.add(m[1]);
  }
  return [...out];
}
async function freeImageName(imagesDir, name) {
  const exists = async n => { try { await imagesDir.getFileHandle(n); return true; } catch { return false; } };
  if (!await exists(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = name.slice(0, dot), ext = name.slice(dot);
  for (let n = 2; ; n++) {
    const cand = base + '-' + n + ext;
    if (!await exists(cand)) return cand;
  }
}
// copies each referenced image into the target folder's images/; returns the
// (possibly reference-rewritten) block plus the source names that were copied
async function moveBlockImages(block, source, target) {
  const paths = blockImagePaths(block);
  if (!paths.length) return { block, moved: [] };
  let srcImages;
  try { srcImages = await source.dir.getDirectoryHandle('images'); }
  catch { toast('No images/ next to ' + source.name + ' — references moved as-is'); return { block, moved: [] }; }
  const tgtImages = await target.dir.getDirectoryHandle('images', { create: true });
  const moved = [];
  for (const p of paths) {
    const name = p.slice('images/'.length);
    let data;
    try { data = await (await (await srcImages.getFileHandle(name)).getFile()).arrayBuffer(); }
    catch { toast('Missing image ' + p + ' — reference moved as-is'); continue; }
    const newName = await freeImageName(tgtImages, name);
    const fh = await tgtImages.getFileHandle(newName, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
    if (newName !== name)
      block = block.split('[[file:images/' + name + ']]').join('[[file:images/' + newName + ']]');
    moved.push(name);
  }
  return { block, moved };
}
// delete a moved source image only when no connected file sharing that folder
// still references it (unconnected files can't be checked — accepted trade-off)
async function cleanupSourceImages(source, moved) {
  if (!moved.length) return;
  let srcImages;
  try { srcImages = await source.dir.getDirectoryHandle('images'); } catch { return; }
  for (const name of moved) {
    const ref = '[[file:images/' + name + ']]';
    let still = false;
    for (const e of App.files) {
      if (await e.dir.isSameEntry(source.dir) && (e.text || '').includes(ref)) { still = true; break; }
    }
    if (!still) { try { await srcImages.removeEntry(name); } catch { /* already gone */ } }
  }
}
```

- [ ] **Step 4: Integrate into `moveSelTo`**

In `moveSelTo`, replace:

```js
  const block = Core.taskBlock(source.file, idx);
  // append to the target first: a failure mid-move duplicates, never loses
  await saveFile(target, file => { Core.appendRaw(file, block); });
```

with:

```js
  let block = Core.taskBlock(source.file, idx);
  let moved = [];
  if (!(await source.dir.isSameEntry(target.dir))) {
    const res = await moveBlockImages(block, source, target);
    block = res.block; moved = res.moved;
  }
  // append to the target first: a failure mid-move duplicates, never loses
  await saveFile(target, file => { Core.appendRaw(file, block); });
```

and after the second `saveFile(source, ...)` call, before setting `App.sel`, add:

```js
  await cleanupSourceImages(source, moved);
```

- [ ] **Step 5: Run e2e and units**

Run: `node tests/ui-e2e.mjs` — Expected: all checks PASS.
Run: `node --test 'tests/*.test.mjs'` — Expected: PASS.

- [ ] **Step 6: Update CLAUDE.md**

In `CLAUDE.md`:

- In **Architecture › Data flow**, replace the first bullet's opening with:

```markdown
- One `.org` file per topic (`work.org` → topic "work"); files are connected
  individually (stored as directory-handle + filename pairs in IndexedDB;
  manage with `F`, move tasks between files with `m`); file order = task order.
```

- In **Architecture**, the APP paragraph listing monkey-patched globals: change
  `(showDirectoryPicker, idbSet, openFolder)` to
  `(showDirectoryPicker, idbSet, connectNames, confirm)`.

- In **Commands**, update the run-the-app note: "open `index.html` in Chrome/Edge and connect a folder's `.org` files via the picker (`sample-tasks/` is a fixture for this)".

- [ ] **Step 7: Manual smoke check**

Serve locally, connect `sample-tasks/`, paste an image onto a task, then `m` it into a topic connected from a *different* folder (create a temp folder with one `.org` file to test): the image file appears in the new folder's `images/`, renders after the move, and disappears from the old `images/` if nothing else referenced it.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/ui-e2e.mjs CLAUDE.md
git commit -m "feat: cross-folder moves carry images — copy, collision-rename, refcounted cleanup"
```
