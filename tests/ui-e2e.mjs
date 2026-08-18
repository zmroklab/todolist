// End-to-end UI test: drives index.html in headless Chrome with TRUSTED key
// events via CDP (real default actions, like a human typing). A fake in-memory
// directory handle replaces the folder picker so no real filesystem is needed.
//
// Run explicitly (not part of `node --test`): node tests/ui-e2e.mjs
// Requires Google Chrome; skips (exit 0) if the binary is missing.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function defaultChromePath() {
  if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    ];
    return candidates.find(existsSync) || candidates[0];
  }
  const candidates = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
  return candidates.find(existsSync) || candidates[0];
}

const CHROME = process.env.CHROME_BIN || defaultChromePath();
if (!existsSync(CHROME)) {
  console.log('SKIP: Chrome not found at', CHROME, '(set CHROME_BIN)');
  process.exit(0);
}

const root = fileURLToPath(new URL('..', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    const body = await readFile(join(root, req.url === '/' ? 'index.html' : req.url));
    res.setHeader('Content-Type', 'text/html');
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0',
  `--user-data-dir=${join(tmpdir(), 'chrome-orgtodo-e2e-' + PORT)}`, '--no-first-run',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let cdpUrl = '';
chrome.stderr.on('data', d => {
  const m = String(d).match(/DevTools listening on (ws:\/\/\S+)/);
  if (m) cdpUrl = m[1];
});
process.on('exit', () => chrome.kill());

const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 50 && !cdpUrl; i++) await sleep(200);
if (!cdpUrl) { console.error('FAIL: no CDP endpoint'); process.exit(1); }

// The browser-level ws exposes targets; get the page target list via /json
const httpPort = cdpUrl.match(/:(\d+)\//)[1];
let wsUrl = '';
for (let i = 0; i < 50 && !wsUrl; i++) {
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${httpPort}/json/list`)).json();
    wsUrl = tabs.find(t => t.type === 'page')?.webSocketDebuggerUrl || '';
  } catch {}
  if (!wsUrl) await sleep(200);
}

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.onopen = r);
let id = 0;
const pending = new Map();
ws.onmessage = ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const cdp = (method, params = {}) =>
  new Promise(res => { pending.set(++id, res); ws.send(JSON.stringify({ id, method, params })); });
async function evaljs(expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
async function key(k, code, text, vk, modifiers = 0) {
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, text, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
}

let failures = 0;
function check(name, cond, detail = '') {
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '   ' + detail));
  if (!cond) failures++;
}

await cdp('Page.enable');
await cdp('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await sleep(1200);

const setup = await evaljs(`(async () => {
  let clock = 100;
  const fileHandle = (files, mtimes, name) => ({
    kind: 'file', name,
    async getFile() {
      if (!files.has(name)) throw new DOMException('nf', 'NotFoundError');
      return new File([files.get(name)], name, { lastModified: mtimes.get(name) || 1 });
    },
    async createWritable() {
      if (!files.has(name)) throw new DOMException('nf', 'NotFoundError');
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

// --- heading edit: press e, editor opens with intact prefill ---
await key('e', 'KeyE', 'e', 69);
await sleep(250);
const afterE = await evaljs(`({
  exists: !!document.querySelector('.editor input'),
  value: document.querySelector('.editor input')?.value ?? null,
})`);
check('e opens the inline editor', afterE.exists);
check('prefill is intact (triggering key not typed into input)',
      afterE.value === 'Renew car insurance #B :paperwork: @2026-07-20', JSON.stringify(afterE));

// --- type a new heading and press Enter: rename must be written to the file ---
await evaljs(`(() => { const i = document.querySelector('.editor input'); i.value = ''; return true; })()`);
await cdp('Input.insertText', { text: 'Renew CAR insurance renamed #A :paperwork:' });
await key('Enter', 'Enter', '\r', 13);
await sleep(500);
const afterEnter = await evaljs(`({
  editorClosed: !document.querySelector('.editor input'),
  file: __files.get('home.org'),
  titles: App.visible.map(r => r.task.title),
})`);
check('Enter closes the editor', afterEnter.editorClosed);
check('rename is written to the org file',
      afterEnter.file.includes('* TODO [#A] Renew CAR insurance renamed :paperwork:'),
      JSON.stringify(afterEnter.file));
check('deadline was dropped (omitted from edit line = removed)',
      !afterEnter.file.includes('DEADLINE:'), JSON.stringify(afterEnter.file));
check('untouched task block is preserved byte-for-byte',
      afterEnter.file.endsWith('* TODO Garage cleanup\n'), JSON.stringify(afterEnter.file));
check('UI shows the new title', afterEnter.titles.includes('Renew CAR insurance renamed'),
      JSON.stringify(afterEnter.titles));

// --- Escape cancels without writing ---
const fileBefore = await evaljs(`__files.get('home.org')`);
await key('e', 'KeyE', 'e', 69);
await sleep(250);
await key('Escape', 'Escape', undefined, 27);
await sleep(250);
const afterEsc = await evaljs(`({
  editorClosed: !document.querySelector('.editor input'),
  same: __files.get('home.org') === ${JSON.stringify('PLACEHOLDER')} || true,
  file: __files.get('home.org'),
})`);
check('Escape closes the editor without committing',
      afterEsc.editorClosed && afterEsc.file === fileBefore);

// --- deadline editor (s) round-trip ---
await key('s', 'KeyS', 's', 83);
await sleep(250);
const sEditor = await evaljs(`document.querySelector('.editor input')?.value ?? null`);
check('s opens deadline editor with empty prefill (task has no deadline)', sEditor === '');
await cdp('Input.insertText', { text: '2026-08-01' });
await key('Enter', 'Enter', '\r', 13);
await sleep(500);
const afterS = await evaljs(`__files.get('home.org')`);
check('deadline editor writes DEADLINE line', afterS.includes('DEADLINE: <2026-08-01 Sat>'), afterS);

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
check('> on a task without a deadline sets today', bare.file.split('* TODO Garage cleanup')[1].includes('DEADLINE: <' + bare.today), bare.file);
// clear it again so Garage cleanup doesn't leak onto the radar for later checks
await key('s', 'KeyS', 's', 83);
await sleep(250);
await evaljs(`(() => { document.querySelector('.editor input').value = ''; })()`);
await key('Enter', 'Enter', '\r', 13);
await sleep(500);
const cleared = await evaljs(`__files.get('home.org')`);
check('empty deadline editor clears it back off Garage cleanup',
      !cleared.split('* TODO Garage cleanup')[1].includes('DEADLINE'), cleared);

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

await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Garage cleanup');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
})()`);
await key('d', 'KeyD', 'd', 68);
await sleep(500);
const repAdv = await evaljs(`__files.get('home.org')`);
check('d advances a repeat one interval (no DONE)',
      repAdv.includes('DEADLINE: <2026-08-08 Sat +1w>') &&
      repAdv.split('* TODO Garage cleanup')[1] !== undefined, repAdv);

await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Garage cleanup');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
})()`);
await key('D', 'KeyD', 'D', 68, 8); // 8 = Shift modifier
await sleep(500);
const repBack = await evaljs(`__files.get('home.org')`);
check('D rolls the repeat back one interval', repBack.includes('DEADLINE: <2026-08-01 Sat +1w>'), repBack);

// --- repeating task survives the WYSIWYG heading editor (e): keeping vs dropping +1w ---
await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Garage cleanup');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
})()`);
await key('e', 'KeyE', 'e', 69);
await sleep(250);
const eVal = await evaljs(`document.querySelector('.editor input')?.value ?? null`);
check('e editor prefill keeps the +1w repeater token', eVal !== null && eVal.includes('+1w'), eVal);
await evaljs(`(() => { document.querySelector('.editor input').value = 'Garage cleanup @2026-08-01'; })()`);
await key('Enter', 'Enter', '\r', 13);
await sleep(500);
const afterHeadingEdit = await evaljs(`__files.get('home.org')`);
const gcBlock = afterHeadingEdit.split('* TODO Garage cleanup')[1] || '';
check('dropping +1w from the heading edit removes the repeater but keeps the deadline',
      !gcBlock.includes('+1w') && gcBlock.includes('DEADLINE: <2026-08-01'), afterHeadingEdit);

// clear it so it doesn't leak into later checks
await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.task.title === 'Garage cleanup');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
})()`);
await key('s', 'KeyS', 's', 83);
await sleep(250);
await evaljs(`(() => { document.querySelector('.editor input').value = ''; })()`);
await key('Enter', 'Enter', '\r', 13);
await sleep(500);

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
check('d marks the sub-task DONE with CLOSED', afterD.includes('** DONE [#B] Sort tools') && afterD.includes('CLOSED: ['), JSON.stringify(afterD));
check('parent block is untouched by the child edit',
      afterD.includes('* TODO Garage cleanup\n** DONE'), JSON.stringify(afterD));

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

// --- filter override: a matching sub-task renders under a collapsed parent ---
const filterHit = await evaljs(`(() => {
  App.expanded.clear();
  App.filter.text = 'sort tools';
  render();
  return {
    subVisible: App.visible.some(r => r.parent && r.task.title === 'Sort tools'),
    parentExpanded: App.expanded.has('home\\t* TODO Garage cleanup'),
  };
})()`);
check('search hit renders under a collapsed parent',
      filterHit.subVisible === true && filterHit.parentExpanded === false,
      JSON.stringify(filterHit));
await evaljs(`(() => { App.filter.text = ''; document.querySelector('#search').value = ''; render(); return true; })()`);

// --- broken file: deleted on disk -> hidden; restored -> recovers ---
const homeSnapshot = await evaljs(`__files.get('home.org')`);
await evaljs(`(__files.delete('home.org'), true)`);
await sleep(2500);   // > one 1.5 s scanTick
const broken = await evaljs(`({
  broken: App.files.find(e => e.topic === 'home')?.broken ?? null,
  stillListed: App.files.some(e => e.topic === 'home'),
  visible: App.visible.length,
})`);
check('deleted file is marked broken but stays listed',
      broken.broken === true && broken.stillListed, JSON.stringify(broken));
check('broken file rows leave the task list', broken.visible === 0, JSON.stringify(broken));
await evaljs(`(__files.set('home.org', ${JSON.stringify(homeSnapshot)}), __mtimes.set('home.org', 424242), true)`);
await sleep(2500);
const recovered = await evaljs(`({
  broken: App.files.find(e => e.topic === 'home')?.broken ?? null,
  visible: App.visible.length,
})`);
check('restored file recovers automatically',
      recovered.broken === false && recovered.visible > 0, JSON.stringify(recovered));

// --- topic clash: connecting a same-named file from another folder is refused ---
const clash = await evaljs(`(async () => {
  __filesB.set('home.org', '* TODO impostor\\n');
  const before = App.files.length;
  const added = await connectNames(__dirB, ['home.org']);
  __filesB.delete('home.org');
  return { added, before, after: App.files.length,
           topics: App.files.map(e => e.topic).join(',') };
})()`);
check('same-topic connect is refused', clash.added === 0 && clash.after === clash.before, JSON.stringify(clash));

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

// --- a successful connect clears the empty-state banner ---
const bannerClear = await evaljs(`(async () => {
  banner('No files connected yet.');
  __filesB.set('extra.org', '* TODO Extra task\\n');
  const added = await connectNames(__dirB, ['extra.org']);
  const hiddenAfter = document.querySelector('#banner').hidden;
  const i = App.files.findIndex(e => e.topic === 'extra');
  if (i > -1) { App.files.splice(i, 1); await persistFiles(); render(); }
  __filesB.delete('extra.org');
  return { added, hiddenAfter };
})()`);
check('successful connect clears the empty-state banner',
      bannerClear.added === 1 && bannerClear.hiddenAfter === true, JSON.stringify(bannerClear));

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

// --- m aborts without loss when the target write fails ---
const failSetup = await evaljs(`(() => {
  const r = App.visible.find(r => !r.parent && r.topic === 'home');
  App.sel = refKey(r); App.selPos = App.visible.indexOf(r); updateSelClass();
  const target = App.files.find(e => e.topic === 'work');
  window.__origCreateWritable = target.handle.createWritable;
  target.handle.createWritable = async () => { throw new DOMException('boom', 'InvalidStateError'); };
  return { sel: App.sel, home: __files.get('home.org'), work: __filesB.get('work.org') };
})()`);
await key('m', 'KeyM', 'm', 77);
await sleep(250);
await cdp('Input.insertText', { text: 'work' });
await key('Enter', 'Enter', '\r', 13);
await sleep(800);
const afterFail = await evaljs(`({
  home: __files.get('home.org'),
  work: __filesB.get('work.org'),
  toast: document.querySelector('#toast').textContent,
  toastHidden: document.querySelector('#toast').hidden,
})`);
check('failed target write leaves the source file untouched (no loss)',
      afterFail.home === failSetup.home, JSON.stringify({ before: failSetup.home, after: afterFail.home }));
check('failed target write does not touch the target file on disk either',
      afterFail.work === failSetup.work, JSON.stringify({ before: failSetup.work, after: afterFail.work }));
check('a toast reports the failed move',
      !afterFail.toastHidden && afterFail.toast.includes('Move failed'), JSON.stringify(afterFail));
await evaljs(`(() => {
  const target = App.files.find(e => e.topic === 'work');
  target.handle.createWritable = window.__origCreateWritable;
  delete window.__origCreateWritable;
  return true;
})()`);

// --- j walks through duplicate-named tasks instead of getting stuck ---
await evaljs(`(() => {
  __files.set('home.org', __files.get('home.org') +
    '* TODO Dup task\\n* TODO Dup task\\n* TODO After dup\\n');
  __mtimes.set('home.org', 9999999);
  return true;
})()`);
await sleep(2500);
const dupStart = await evaljs(`(() => {
  const i = App.visible.findIndex(r => r.task.title === 'Dup task');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
  return { i, titles: App.visible.map(r => r.task.title) };
})()`);
await key('j', 'KeyJ', 'j', 74);
await sleep(150);
await key('j', 'KeyJ', 'j', 74);
await sleep(150);
const dupNav = await evaljs(`({
  selPos: App.selPos,
  title: App.visible[App.selPos]?.task.title ?? null,
})`);
check('j walks past duplicate-named tasks (two presses = two rows down)',
      dupNav.selPos === dupStart.i + 2 && dupNav.title === 'After dup',
      JSON.stringify({ dupStart, dupNav }));

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
  window.__confirmMsg = null;
  window.confirm = m => { window.__confirmMsg = m; return true; };
  const i = App.visible.findIndex(r => r.parent && r.task.title === 'sub victim');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
  return i;
})()`);
await key('X', 'KeyX', 'X', 88);
await sleep(300);
const afterSub = await evaljs(`({ text: __files.get('home.org'), msg: window.__confirmMsg })`);
check('X on a sub-task deletes only that sub-task and confirm names only the sub-task',
      !afterSub.text.includes('sub victim') && afterSub.text.includes('* TODO Sub parent') &&
      afterSub.text.includes('sub survivor') && afterSub.msg === 'Delete "sub victim"?',
      JSON.stringify(afterSub));

// --- k onto the first row scrolls the page to the very top ---
await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 220, deviceScaleFactor: 1, mobile: false });
const scrollSetup = await evaljs(`(() => {
  App.sel = refKey(App.visible[1]); App.selPos = 1; updateSelClass();
  window.scrollTo(0, document.body.scrollHeight);
  return { rows: App.visible.length, scrolled: window.scrollY };
})()`);
check('small viewport makes the page scrollable', scrollSetup.rows >= 2 && scrollSetup.scrolled > 0,
      JSON.stringify(scrollSetup));
await key('k', 'KeyK', 'k', 75);
await sleep(300);
const scrollTop = await evaljs(`window.scrollY`);
check('k onto the first row scrolls the page to the very top', scrollTop === 0, 'scrollY=' + scrollTop);
await cdp('Emulation.clearDeviceMetricsOverride');

// --- clickable links in title and body ---
await evaljs(`(() => {
  __files.set('home.org',
    '* TODO Read [[https://docs.example][the docs]] and https://foo.bar/x.\\n' +
    '  see https://body.example/path\\n');
  __mtimes.set('home.org', 424242);
})()`);
await sleep(2000); // let the 1.5s poll pick up the external edit
const linkRow = await evaljs(`(() => {
  const row = [...document.querySelectorAll('.task')].find(r => r.textContent.includes('the docs'));
  if (!row) return { found: false };
  const as = [...row.querySelectorAll('.title a')]
    .map(a => ({ href: a.getAttribute('href'), text: a.textContent, target: a.target, rel: a.rel, draggable: a.draggable }));
  return { found: true, as };
})()`);
check('title org link renders as its label, opening in a new tab',
      linkRow.found && linkRow.as[0] && linkRow.as[0].href === 'https://docs.example' &&
      linkRow.as[0].text === 'the docs' && linkRow.as[0].target === '_blank' &&
      linkRow.as[0].rel === 'noopener noreferrer' && linkRow.as[0].draggable === false,
      JSON.stringify(linkRow));
check('bare title url is linked with trailing punctuation excluded',
      linkRow.found && linkRow.as[1] && linkRow.as[1].href === 'https://foo.bar/x',
      JSON.stringify(linkRow));

await evaljs(`(() => {
  const i = App.visible.findIndex(r => r.task.title.startsWith('Read [[https://docs.example'));
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
  return i;
})()`);
await key('o', 'KeyO', 'o', 79);
await sleep(300);
const bodyLink = await evaljs(`(() => {
  const a = document.querySelector('.body a');
  return a ? { href: a.getAttribute('href'), text: a.textContent } : null;
})()`);
check('body line url renders as a link when the row is expanded',
      !!bodyLink && bodyLink.href === 'https://body.example/path', JSON.stringify(bodyLink));

const clickSel = await evaljs(`(() => {
  const row = [...document.querySelectorAll('.task')].find(r => r.querySelector('.title a'));
  const a = row.querySelector('.title a');
  App.sel = null; App.selPos = -1; updateSelClass();
  a.addEventListener('click', e => e.preventDefault()); // block navigation, keep handler order
  a.click();
  const afterLink = App.sel;
  row.click();
  return { afterLink, afterRow: App.sel };
})()`);
check('link click does not select the row; row click still does',
      clickSel.afterLink === null && !!clickSel.afterRow, JSON.stringify(clickSel));

// --- backlog sort dropdown ---
await evaljs(`(() => {
  __files.set('home.org',
    '* TODO bb\\n  :PROPERTIES:\\n  :ADDED:   [2026-07-10 Fri]\\n  :END:\\n' +
    '* TODO [#A] cc\\n  :PROPERTIES:\\n  :ADDED:   [2026-07-12 Sun]\\n  :END:\\n' +
    '* TODO aa\\n');
  __mtimes.set('home.org', 99999);
})()`);
await key('Escape', 'Escape', undefined, 27);   // clear any leftover filters
await sleep(2500);                              // let scanTick re-parse the outside edit

const backlogTitles = () => evaljs(
  `[...document.querySelectorAll('#backlog-list .task .title')].map(e => e.textContent)`);
const setSort = v => evaljs(
  `(() => { const s = document.querySelector('#sort'); s.value = '${v}'; s.dispatchEvent(new Event('change')); return App.sort; })()`);

const dflt = await backlogTitles();
check('default order keeps file order within the topic group',
      dflt.indexOf('bb') < dflt.indexOf('cc') && dflt.indexOf('cc') < dflt.indexOf('aa'),
      JSON.stringify(dflt));

await setSort('priority');
const byPri = await backlogTitles();
const hdr = await evaljs(`[...document.querySelectorAll('#backlog-list h3')].map(h => h.textContent)`);
check('priority sort puts #A first, flattens to a single labeled group',
      byPri.indexOf('cc') === 0 && hdr.length === 1 && hdr[0] === 'by priority',
      JSON.stringify({ byPri, hdr }));
check('priority ties keep file order', byPri.indexOf('bb') < byPri.indexOf('aa'), JSON.stringify(byPri));

await setSort('created-desc');
const byNew = await backlogTitles();
check('created-desc: newest first, missing ADDED last',
      byNew.indexOf('cc') < byNew.indexOf('bb') && byNew.indexOf('bb') < byNew.indexOf('aa'),
      JSON.stringify(byNew));

await setSort('created-asc');
const byOld = await backlogTitles();
check('created-asc: oldest first, missing ADDED still last',
      byOld.indexOf('bb') < byOld.indexOf('cc') && byOld.indexOf('cc') < byOld.indexOf('aa'),
      JSON.stringify(byOld));

await setSort('topic');
const backAgain = await backlogTitles();
check('back to topic order restores file order and topic headers',
      backAgain.indexOf('bb') < backAgain.indexOf('cc') &&
      (await evaljs(`[...document.querySelectorAll('#backlog-list h3')].map(h => h.textContent)`)).includes('home'),
      JSON.stringify(backAgain));

// --- r cycles sort modes ---
await key('r', 'KeyR', 'r', 82);
const afterR1 = await evaljs(`({ sort: App.sort, sel: document.querySelector('#sort').value })`);
check('r cycles topic -> priority and syncs the select',
      afterR1.sort === 'priority' && afterR1.sel === 'priority', JSON.stringify(afterR1));
await key('r', 'KeyR', 'r', 82);
await key('r', 'KeyR', 'r', 82);
await key('r', 'KeyR', 'r', 82);
await key('r', 'KeyR', 'r', 82);
check('r wraps back to topic after all five modes', (await evaljs(`App.sort`)) === 'topic');

// --- reordering disabled while sorted ---
await evaljs(`(() => { const s = document.querySelector('#sort'); s.value = 'priority'; s.dispatchEvent(new Event('change')); })()`);
const fileBeforeSorted = await evaljs(`__files.get('home.org')`);
await evaljs(`(() => {   // select the first backlog row
  const i = App.visible.findIndex(r => r.task.title === 'cc');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
})()`);
await key('ArrowDown', 'ArrowDown', undefined, 40, 1);   // Alt+Down (modifiers: 1 = Alt)
await sleep(300);
const reorder = await evaljs(`({ file: __files.get('home.org'), toast: document.querySelector('#toast').textContent })`);
check('Alt+Down while sorted: toast shown, file bytes unchanged',
      reorder.file === fileBeforeSorted && reorder.toast === 'Reordering needs topic order',
      JSON.stringify({ changed: reorder.file !== fileBeforeSorted, toast: reorder.toast }));
await evaljs(`(() => { const s = document.querySelector('#sort'); s.value = 'topic'; s.dispatchEvent(new Event('change')); })()`);

// --- share filters: base layer, indicator, S cycle, Esc keeps preset ---
await evaljs(`(() => {
  App.share.presets = [{ name: 'team', expr: 'home and !secret' }, { name: 'peers', expr: 'home' }];
  persistSharePresets();
  setShareActive('team');
})()`);
await evaljs(`(() => {   // add an excluded-tag task through the app itself
  const qa = document.querySelector('#quickadd');
  qa.value = 'home: Sensitive one-on-one :secret:';
  qa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(400);
const sh1 = await evaljs(`({
  topics: [...new Set(App.visible.map(r => r.topic))],
  groups: [...document.querySelectorAll('#backlog-list h3')].map(h => h.textContent),
  hasSecret: App.visible.some(r => r.task.title.includes('Sensitive')),
  inFile: __files.get('home.org').includes('Sensitive one-on-one'),
  ind: !document.querySelector('#share-ind').hidden,
  indText: document.querySelector('#share-ind').textContent,
  select: document.querySelector('#share').value,
})`);
check('share preset shows only included topic, hides excluded tag, saves to file',
      sh1.topics.length > 0 && sh1.topics.every(t => t === 'home') && sh1.groups.every(g => g === 'home')
      && !sh1.hasSecret && sh1.inFile && sh1.ind && sh1.indText.includes('team')
      && sh1.select === 'team',
      JSON.stringify(sh1));

await key('Escape', 'Escape', undefined, 27);
check('Esc clears quick filters but keeps the share preset',
      (await evaljs(`App.share.active`)) === 'team');

await key('S', 'KeyS', 'S', 83);
const cyc1 = await evaljs(`App.share.active`);
await key('S', 'KeyS', 'S', 83);
const cyc2 = await evaljs(`({ active: App.share.active, indHidden: document.querySelector('#share-ind').hidden })`);
await key('S', 'KeyS', 'S', 83);
const cyc3 = await evaljs(`App.share.active`);
check('S cycles team -> peers -> off -> team',
      cyc1 === 'peers' && cyc2.active === null && cyc2.indHidden === true && cyc3 === 'team',
      JSON.stringify({ cyc1, cyc2, cyc3 }));

const persisted = await evaljs(`({ active: localStorage.getItem('shareActive'), presets: localStorage.getItem('sharePresets') })`);
check('share state persisted to localStorage',
      persisted.active === 'team' && persisted.presets.includes('!secret'), JSON.stringify(persisted));

await evaljs(`(() => {
  App.share.presets.push({ name: 'broken', expr: 'flo and' });
  persistSharePresets(); setShareActive('broken');
})()`);
const failClosed = await evaljs(`({
  vis: App.visible.length,
  doneCount: document.querySelector('#done-count').textContent,
  err: document.querySelector('#share-ind').classList.contains('err'),
  txt: document.querySelector('#share-ind').textContent,
})`);
check('malformed active preset fails closed (nothing shown, error indicator)',
      failClosed.vis === 0 && failClosed.doneCount === '0' && failClosed.err
      && failClosed.txt.includes('broken'),
      JSON.stringify(failClosed));
await evaljs(`(() => { App.share.presets = []; persistSharePresets(); setShareActive(null); })()`);

// --- share strictness: matching child must not reveal hidden parent ---
await evaljs(`(() => {
  const qa = document.querySelector('#quickadd');
  qa.value = 'home: Quarterly planning';
  qa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(300);
await evaljs(`(() => {
  const i = App.visible.findIndex(r => !r.parent && r.task.title === 'Quarterly planning');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
})()`);
await key('A', 'KeyA', 'A', 65);
await evaljs(`(() => { document.querySelector('.editor input').value = 'Ping legal :urgent:'; })()`);
await key('Enter', 'Enter', '\r', 13);
await sleep(300);
await evaljs(`(() => {
  App.share.presets = [{ name: 'tagonly', expr: 'urgent' }];
  persistSharePresets(); setShareActive('tagonly');
})()`);
const strict = await evaljs(`({
  parentShown: App.visible.some(r => !r.parent && r.task.title === 'Quarterly planning'),
  bodyHasParent: document.body.textContent.includes('Quarterly planning'),
  childSaved: __files.get('home.org').includes('Ping legal'),
})`);
check('include-tag on sub-task does not reveal non-matching parent',
      !strict.parentShown && !strict.bodyHasParent && strict.childSaved, JSON.stringify(strict));

await evaljs(`setShareActive(null)`);
await evaljs(`(() => {
  const i = App.visible.findIndex(r => !r.parent && r.task.title === 'Quarterly planning');
  App.sel = refKey(App.visible[i]); App.selPos = i; updateSelClass();
})()`);
await key('A', 'KeyA', 'A', 65);
await evaljs(`(() => { document.querySelector('.editor input').value = 'Ping compliance :urgent: @tom'; })()`);
await key('Enter', 'Enter', '\r', 13);
await sleep(300);
await evaljs(`setShareActive('tagonly')`);
const strictRadar = await evaljs(`({
  childShown: App.visible.some(r => r.parent && r.task.title === 'Ping compliance'),
  bodyHasParent: document.body.textContent.includes('Quarterly planning'),
})`);
check('radar ctx row of matching child does not leak hidden parent title',
      strictRadar.childShown && !strictRadar.bodyHasParent, JSON.stringify(strictRadar));

await evaljs(`(() => { App.share.presets = []; persistSharePresets(); setShareActive(null); })()`);

// --- share preset edit panel ---
await evaljs(`(() => {
  App.share.presets = [{ name: 'team', expr: 'home and !secret' }, { name: 'peers', expr: 'home' }];
  persistSharePresets(); setShareActive('team');
})()`);
await evaljs(`(() => { const s = document.querySelector('#share'); s.value = '\\u0000edit'; s.dispatchEvent(new Event('change')); })()`);
const panel1 = await evaljs(`({
  open: !document.querySelector('#share-panel').hidden,
  rows: document.querySelectorAll('#share-panel .srow').length,
  select: document.querySelector('#share').value,
})`);
check('"edit presets…" opens panel; select snaps back to active preset',
      panel1.open && panel1.rows === 2 && panel1.select === 'team', JSON.stringify(panel1));

await evaljs(`(() => {
  const row = [...document.querySelectorAll('#share-panel .srow')].find(r => r.querySelector('.sname').value === 'peers');
  const expr = row.querySelector('.sexpr');
  expr.value = 'home and'; expr.dispatchEvent(new Event('input'));
})()`);
check('live parse error shown while typing',
      await evaljs(`[...document.querySelectorAll('#share-panel .serr')].some(e => e.textContent.length > 0)`));

await evaljs(`(() => {
  const row = [...document.querySelectorAll('#share-panel .srow')].find(r => r.querySelector('.sname').value === 'team');
  row.querySelector('button').click();
})()`);
const afterDel = await evaljs(`({ active: App.share.active, count: App.share.presets.length, stored: localStorage.getItem('shareActive') })`);
check('deleting the active preset deactivates it first',
      afterDel.active === null && afterDel.count === 1 && afterDel.stored === null, JSON.stringify(afterDel));

await evaljs(`(() => { [...document.querySelectorAll('#share-list button')].find(b => b.textContent === '+ add preset').click(); })()`);
check('+ add preset appends a row',
      (await evaljs(`App.share.presets.length`)) === 2
      && (await evaljs(`document.querySelectorAll('#share-panel .srow').length`)) === 2);

await key('Escape', 'Escape', undefined, 27);
check('Esc closes the share panel',
      (await evaljs(`document.querySelector('#share-panel').hidden`)) === true);
await evaljs(`(() => { App.share.presets = []; persistSharePresets(); setShareActive(null); })()`);

// --- share panel: mutual exclusion with files panel; rename-active ---
await key('F', 'KeyF', 'F', 70);
await evaljs(`(() => { const s = document.querySelector('#share'); s.value = '\\u0000edit'; s.dispatchEvent(new Event('change')); })()`);
const excl = await evaljs(`({ files: !document.querySelector('#files-panel').hidden, share: !document.querySelector('#share-panel').hidden, pOpen: App.panel.open, sOpen: App.sharePanel.open })`);
check('opening share panel closes files panel', !excl.files && excl.share && !excl.pOpen && excl.sOpen, JSON.stringify(excl));
await key('Escape', 'Escape', undefined, 27);
check('single Esc then closes share panel', (await evaljs(`document.querySelector('#share-panel').hidden`)) === true);

await evaljs(`(() => { App.share.presets = [{ name: 'team', expr: 'home' }]; persistSharePresets(); setShareActive('team'); })()`);
await evaljs(`(() => { const s = document.querySelector('#share'); s.value = '\\u0000edit'; s.dispatchEvent(new Event('change')); })()`);
await evaljs(`(() => {
  const name = document.querySelector('#share-panel .srow .sname');
  name.value = 'squad';
  name.dispatchEvent(new Event('change'));
})()`);
const ren = await evaljs(`({ active: App.share.active, stored: localStorage.getItem('shareActive'), ind: document.querySelector('#share-ind').textContent })`);
check('renaming the active preset keeps it active under the new name',
      ren.active === 'squad' && ren.stored === 'squad' && ren.ind.includes('squad'), JSON.stringify(ren));
await key('Escape', 'Escape', undefined, 27);
await evaljs(`(() => { App.share.presets = []; persistSharePresets(); setShareActive(null); })()`);

// --- share chrome hiding + quick-add hint + help ---
await evaljs(`(() => {
  App.share.presets = [{ name: 'demo', expr: '!home' }];
  persistSharePresets(); setShareActive('demo');
})()`);
await key('F', 'KeyF', 'F', 70);
const chrome1 = await evaljs(`({
  rows: [...document.querySelectorAll('#files-list .fname')].map(n => n.textContent),
  total: App.files.length,
})`);
check('files panel hides excluded topic while preset active',
      !chrome1.rows.includes('home.org') && chrome1.rows.length === chrome1.total - 1,
      JSON.stringify(chrome1));
await key('Escape', 'Escape', undefined, 27);   // close files panel

await evaljs(`(() => {
  const qa = document.querySelector('#quickadd');
  qa.value = 'home: hidden errand';
  qa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(400);
const qh = await evaljs(`({ hint: document.querySelector('#hint').textContent, inFile: __files.get('home.org').includes('hidden errand') })`);
check('quick-add into a hidden topic saves and explains itself',
      qh.hint.includes('hidden by share filter "demo"') && qh.inFile, JSON.stringify(qh));

check('help documents share filters',
      await evaljs(`document.querySelector('#help').textContent.includes('Share filters')`));
await evaljs(`(() => { App.share.presets = []; persistSharePresets(); setShareActive(null); })()`);

// --- files panel re-renders + clamps selection when share filter changes while open ---
await evaljs(`(() => { App.share.presets = [{ name: 'demo2', expr: '!home' }]; persistSharePresets(); })()`);
await key('F', 'KeyF', 'F', 70);
await evaljs(`(() => { App.panel.idx = panelFiles().length - 1; renderPanel(); })()`);
await evaljs(`setShareActive('demo2')`);
const sync = await evaljs(`({
  rows: [...document.querySelectorAll('#files-list .fname')].map(n => n.textContent),
  idx: App.panel.idx,
  count: panelFiles().length,
  selRows: document.querySelectorAll('#files-list .frow.sel').length,
})`);
check('share change while files panel open re-renders and clamps selection',
      !sync.rows.includes('home.org') && sync.idx < sync.count && sync.selRows === 1, JSON.stringify(sync));
await key('Escape', 'Escape', undefined, 27);
await evaljs(`(() => { App.share.presets = []; persistSharePresets(); setShareActive(null); })()`);

// --- share persistence: re-init from localStorage comes back filtered ---
await evaljs(`(() => {
  App.share.presets = [{ name: 'team', expr: 'home' }];
  persistSharePresets(); setShareActive('team');
})()`);
await evaljs(`(() => {
  App.share = { presets: loadSharePresets(), active: localStorage.getItem('shareActive') };   // simulate boot
  render();
})()`);
const reinit = await evaljs(`({
  active: App.share.active,
  count: App.visible.length,
  topics: [...new Set(App.visible.map(r => r.topic))],
  ind: !document.querySelector('#share-ind').hidden,
})`);
check('share state survives re-init from localStorage (reload path)',
      reinit.active === 'team' && reinit.count > 0 && reinit.topics.every(t => t === 'home') && reinit.ind,
      JSON.stringify(reinit));
await evaljs(`(() => { App.share.presets = []; persistSharePresets(); setShareActive(null); })()`);

// --- quick-add hint must not leak an implicit hidden topic ---
await evaljs(`(() => {
  App.share.presets = [{ name: 'demo3', expr: '!home' }]; persistSharePresets(); setShareActive('demo3');
  App.lastTopic = 'home';
  const qa = document.querySelector('#quickadd');
  qa.value = 'buy milk';
  qa.dispatchEvent(new Event('input'));
})()`);
const hintLeak = await evaljs(`document.querySelector('#hint').textContent`);
check('quick-add hint hides implicit hidden topic', hintLeak.includes('….org') && !hintLeak.includes('home.org'), hintLeak);
await evaljs(`(() => {
  const qa = document.querySelector('#quickadd');
  qa.value = ''; qa.dispatchEvent(new Event('input'));
  App.share.presets = []; persistSharePresets(); setShareActive(null);
})()`);

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

// --- stale selPos (e.g. left over from a pre-filter render) falls back to the first copy ---
const dupStalePos = await evaljs(`(() => {
  const idxs = App.visible.flatMap((r, i) => r.task.title === 'Dup radar child' ? [i] : []);
  App.sel = refKey(App.visible[idxs[0]]); App.selPos = 9999; updateSelClass();
  const rows = [...document.querySelectorAll('.task')];
  const result = { idxs,
           selIdx: rows.findIndex(el => el.classList.contains('sel')),
           dupIdx: rows.findIndex(el => el.classList.contains('sel-dup')),
           selCount: rows.filter(el => el.classList.contains('sel')).length,
           dupCount: rows.filter(el => el.classList.contains('sel-dup')).length };
  App.sel = refKey(App.visible[idxs[0]]); App.selPos = idxs[0]; updateSelClass();
  return result;
})()`);
check('stale selPos falls back to the first copy',
      dupStalePos.selCount === 1 && dupStalePos.dupCount === 1 &&
      dupStalePos.selIdx === dupStalePos.idxs[0] && dupStalePos.dupIdx === dupStalePos.idxs[1],
      JSON.stringify(dupStalePos));

// --- remove the dup fixture so no later checks silently inherit it ---
await evaljs(`(() => {
  __files.set('home.org', __files.get('home.org')
    .replace('* TODO Dup parent\\n** NEXT Dup radar child\\n   DEADLINE: <' + todayIso() + '>\\n', ''));
  __mtimes.set('home.org', 99999999999);
  return true;
})()`);
await sleep(2500);

// --- creating an item via quick-add selects the newly created item ---
await evaljs(`(() => {
  App.filter = { deadline: null, priority: null, tag: null, topic: null, text: '' };
  App.share.presets = []; persistSharePresets(); setShareActive(null);
  const qa = document.querySelector('#quickadd');
  qa.value = 'home: Freshly added task';
  qa.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
})()`);
await sleep(400);
const afterAdd = await evaljs(`(() => {
  const r = App.visible.find(x => refKey(x) === App.sel);
  return { selTitle: r?.task.title ?? null,
           selCount: document.querySelectorAll('.task.sel').length,
           activeTag: document.activeElement.tagName };
})()`);
check('quick-add selects the newly created item',
      afterAdd.selTitle === 'Freshly added task' && afterAdd.selCount === 1,
      JSON.stringify(afterAdd));
check('quick-add blurs so shortcuts target the new item',
      afterAdd.activeTag !== 'INPUT' && afterAdd.activeTag !== 'TEXTAREA',
      JSON.stringify(afterAdd));
// pressing e now edits the new task directly (no click needed)
await key('e', 'KeyE', 'e', 69);
await sleep(250);
const editNew = await evaljs(`document.querySelector('.editor input')?.value ?? null`);
check('e opens the editor on the freshly created item',
      editNew === 'Freshly added task', JSON.stringify(editNew));
await key('Escape', 'Escape', '', 27);
await sleep(150);

// ---- Google Drive backend, driven against an in-memory Drive over fake fetch ----
// Exercises the real gdriveBackend / connectEntries / scanOnce / saveFile wiring
// (URL shaping, version tokens, org round-trip) without real Google credentials.
const drive = await evaljs(`(async () => {
  const store = new Map();  let seq = 0;
  const put = o => { const id = 'id' + (++seq); store.set(id, { id, version: 1, content: '', trashed: false, ...o }); return id; };
  const folderId = put({ name: 'org-todo', mimeType: 'application/vnd.google-apps.folder' });
  const parseQ = q => ({
    name: (q.match(/name='([^']*)'/) || [])[1] ?? null,
    parent: (q.match(/'([^']+)' in parents/) || [])[1] ?? null,
    contains: /name contains '\\.org'/.test(q),
  });
  const json = o => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, opts = {}) => {
    const u = new URL(url); const path = u.pathname; const method = (opts.method || 'GET').toUpperCase();
    const idM = path.match(/\\/files\\/([^/?]+)$/);
    const upload = u.searchParams.get('uploadType');
    if (/\\/files$/.test(path) && method === 'GET') {
      const { name, parent, contains } = parseQ(decodeURIComponent(u.searchParams.get('q') || ''));
      const files = [...store.values()].filter(f => !f.trashed
        && (!parent || (f.parents || []).includes(parent))
        && (name == null || f.name === name)
        && (!contains || f.name.endsWith('.org')));
      return json({ files: files.map(f => ({ id: f.id, name: f.name })) });
    }
    if (/\\/files$/.test(path) && method === 'POST' && upload === 'multipart') {
      const body = typeof opts.body === 'string' ? opts.body : await opts.body.text();
      const meta = JSON.parse((body.match(/\\{[^{}]*"name"[^{}]*\\}/) || ['{}'])[0]);
      return json({ id: put({ name: meta.name, parents: meta.parents || [], content: 'BYTES' }) });
    }
    if (/\\/files$/.test(path) && method === 'POST') {
      const meta = JSON.parse(opts.body);
      return json({ id: put({ name: meta.name, parents: meta.parents || [], mimeType: meta.mimeType || 'text/plain' }) });
    }
    if (idM) {
      const f = store.get(idM[1]); if (!f) return new Response('nf', { status: 404 });
      if (method === 'DELETE') { store.delete(f.id); return new Response('', { status: 204 }); }
      if (u.searchParams.get('alt') === 'media') return new Response(f.content, { status: 200 });
      if (method === 'PATCH' && upload === 'media') {
        f.content = typeof opts.body === 'string' ? opts.body : await opts.body.text();
        f.version = (f.version || 1) + 1;
        return json({ version: String(f.version) });
      }
      return json({ version: String(f.version), trashed: !!f.trashed });
    }
    return new Response('nf', { status: 404 });
  };
  gdriveAuth.getToken = async () => 'faketoken';   // bypass real Google OAuth

  const fid = put({ name: 'drive.org', parents: [folderId], content: '* TODO From Drive\\n' });
  const backend = gdriveBackend({ folderId });
  const listed = (await backend.list()).map(x => x.name);
  await connectEntries(backend, listed);
  for (let i = 0; i < 30 && !App.files.some(e => e.topic === 'drive' && e.file); i++) await new Promise(r => setTimeout(r, 50));
  const e = App.files.find(x => x.topic === 'drive');
  const v0 = e.version, title = e.file && e.file.tasks[0] && e.file.tasks[0].title;
  await mutateTask('drive', [taskKey(e.file.tasks[0])], t => Core.setState(t, 'NEXT'));
  const written = store.get(fid).content;
  await backend.writeImage('pic.png', new TextEncoder().encode('BYTES').buffer);
  const imgOk = await backend.imageExists('pic.png');
  return { listed, title, v0, v1: e.version, written, versionBumped: store.get(fid).version, imgOk,
           label: e.backend.label, kind: e.backend.kind };
})()`);
check('Drive backend: list() finds the .org file in the app folder', drive.listed.join() === 'drive.org', JSON.stringify(drive.listed));
check('Drive backend: file read + parsed through connectEntries/scanOnce', drive.title === 'From Drive', JSON.stringify(drive));
check('Drive backend: saveFile round-trips org text back to Drive', /^\* NEXT From Drive/.test(drive.written), JSON.stringify(drive.written));
check('Drive backend: version token advances after write', drive.v1 !== drive.v0 && drive.versionBumped === 2, JSON.stringify(drive));
check('Drive backend: image write + exists via images subfolder', drive.imgOk === true, JSON.stringify(drive));
check('Drive backend: entry is tagged as a Drive connection', drive.kind === 'gdrive' && drive.label === 'Drive', JSON.stringify(drive));

ws.close();
chrome.kill();
server.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);
