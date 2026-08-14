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
  assert.equal(m.backlogByTopic.length, 1);
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

test('sortBacklog: priority — A first, none last, stable ties', () => {
  const f = mk('* TODO none1\n* TODO [#C] c\n* TODO [#A] a\n* TODO none2\n* TODO [#B] b\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  assert.deepEqual(Core.sortBacklog(refs, 'priority').map(r => r.task.title),
                   ['a', 'b', 'c', 'none1', 'none2']);
});

test('sortBacklog: deadline — soonest first, missing last', () => {
  const f = mk('* TODO late\n  DEADLINE: <2026-09-01 Tue>\n* TODO none\n* TODO soon\n  DEADLINE: <2026-07-20 Mon>\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  assert.deepEqual(Core.sortBacklog(refs, 'deadline').map(r => r.task.title),
                   ['soon', 'late', 'none']);
});

test('sortBacklog: created-desc — newest first, missing ADDED last', () => {
  const f = mk('* TODO old\n  :PROPERTIES:\n  :ADDED:   [2026-07-01 Wed]\n  :END:\n' +
               '* TODO new\n  :PROPERTIES:\n  :ADDED:   [2026-07-18 Sat]\n  :END:\n' +
               '* TODO none\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  assert.deepEqual(Core.sortBacklog(refs, 'created-desc').map(r => r.task.title),
                   ['new', 'old', 'none']);
});

test('sortBacklog: created-asc — oldest first, missing ADDED still last', () => {
  const f = mk('* TODO new\n  :PROPERTIES:\n  :ADDED:   [2026-07-18 Sat]\n  :END:\n' +
               '* TODO none\n' +
               '* TODO old\n  :PROPERTIES:\n  :ADDED:   [2026-07-01 Wed]\n  :END:\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  assert.deepEqual(Core.sortBacklog(refs, 'created-asc').map(r => r.task.title),
                   ['old', 'new', 'none']);
});

test('sortBacklog: returns a new array, input untouched', () => {
  const f = mk('* TODO [#B] b\n* TODO [#A] a\n');
  const refs = f.tasks.map((task, index) => ({ topic: 'w', index, task }));
  const out = Core.sortBacklog(refs, 'priority');
  assert.notEqual(out, refs);
  assert.deepEqual(refs.map(r => r.task.title), ['b', 'a']);
  assert.deepEqual(out.map(r => r.task.title), ['a', 'b']);
});

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
