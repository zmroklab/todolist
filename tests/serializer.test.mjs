import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';
import { SAMPLE, NESTED } from './fixtures.mjs';

const CORPUS = [
  SAMPLE,
  '* TODO no trailing newline',
  '* Weird   spacing\n\n\n* TODO another\n  :LOGBOOK:\n  - note\n  :END:\n',
  'preamble only, no tasks\n',
  '',
  '* NEXT keep scheduled\n  SCHEDULED: <2026-08-01 Sat> DEADLINE: <2026-08-02 Sun>\n  body\n',
  NESTED,
  '* TODO parent\n** TODO child one\n   child body\n** DONE child two\n*** deep stays\n    deep body\n* TODO after\n',
  '* TODO parent\n** child no trailing newline',
  '** orphan before any task\n* TODO real\n',
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
  const t = Core.addTask(f, f.tasks[0], Core.makeTask({ title: 'sub', effort: '1h' }, '2026-07-18'));
  assert.equal(t.level, 2);
  assert.equal(Core.serializeFile(f),
    '* TODO p\n** TODO sub\n  :PROPERTIES:\n  :ADDED:   [2026-07-18 Sat]\n  :Effort:   1h\n  :END:\n');
});

test('moveTask: top-level move past a block whose last child lacks trailing newline', () => {
  const f = Core.parseOrg('* TODO a\n* TODO parent\n** child no newline');
  assert.equal(Core.moveTask(f, 1, 0), true);
  assert.equal(Core.serializeFile(f), '* TODO parent\n** child no newline\n* TODO a\n');
});

test('addTask: null parent appends top-level', () => {
  const f = Core.parseOrg('');
  Core.addTask(f, null, Core.makeTask({ title: 'x' }, '2026-07-18'));
  assert.equal(Core.serializeFile(f),
    '* TODO x\n  :PROPERTIES:\n  :ADDED:   [2026-07-18 Sat]\n  :END:\n');
});

test('setBody keeps verbatim *** lines at column 0 and round-trips', () => {
  const f = Core.parseOrg('* TODO x\n  note\n*** deep heading\n    deep body\n');
  Core.setBody(f.tasks[0], f.tasks[0].body.map(l => l.replace(/^ {0,2}/, '')));
  const out = Core.serializeFile(f);
  assert.ok(out.includes('\n*** deep heading\n'));
  assert.equal(Core.serializeFile(Core.parseOrg(out)), out);
});

test('setBody collapses whitespace-only lines to empty', () => {
  const f = Core.parseOrg('* TODO x\n');
  Core.setBody(f.tasks[0], ['a', '   ', 'b']);
  assert.equal(Core.serializeFile(f), '* TODO x\n  a\n\n  b\n');
});
