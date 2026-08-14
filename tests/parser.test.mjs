import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';
import { SAMPLE, NESTED } from './fixtures.mjs';

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
  assert.equal(Core.parseDateToken('tom', T), '2026-07-19');       // alias for tomorrow
  assert.equal(Core.parseDateToken('07-30', T), '2026-07-30');
  assert.equal(Core.parseDateToken('7-30', T), '2026-07-30');      // 1-digit month
  assert.equal(Core.parseDateToken('12-1', T), '2026-12-01');      // 1-digit day
  assert.equal(Core.parseDateToken('07-18', T), '2026-07-18');     // equal to today stays this year
  assert.equal(Core.parseDateToken('01-05', T), '2027-01-05');     // past this year -> next year
  assert.equal(Core.parseDateToken('13-05', T), null);             // no such month
  assert.equal(Core.parseDateToken('02-30', T), null);             // no such day
  assert.equal(Core.parseDateToken('0-5', T), null);               // months are 1-based
  assert.equal(Core.parseDateToken('2-29', T), null);              // resolves to 2027: not a leap year
  assert.equal(Core.parseDateToken('2-29', '2028-01-01'), '2028-02-29'); // leap year: valid
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

test('parseOrg: empty and preamble-only files', () => {
  assert.deepEqual(Core.parseOrg(''), { preamble: '', tasks: [] });
  assert.equal(Core.parseOrg('just notes\n').preamble, 'just notes\n');
});

test('bumpDeadline shifts an existing deadline and seeds today when absent', () => {
  const f = Core.parseOrg('* TODO Pay bill\n  DEADLINE: <2026-07-31 Fri>\n');
  const t = f.tasks[0];
  Core.bumpDeadline(t, 1, '2026-07-18');
  assert.equal(t.deadline, '2026-08-01');            // crosses month boundary
  assert.equal(t.dirty, true);                        // parseOrg starts clean; bump dirties
  Core.bumpDeadline(t, -1, '2026-07-18');
  assert.equal(t.deadline, '2026-07-31');

  const plus = Core.parseOrg('* TODO Bare\n').tasks[0];
  Core.bumpDeadline(plus, 1, '2026-07-18');
  assert.equal(plus.deadline, '2026-07-18');          // no deadline: > starts at today
  const minus = Core.parseOrg('* TODO Bare\n').tasks[0];
  Core.bumpDeadline(minus, -1, '2026-07-18');
  assert.equal(minus.deadline, '2026-07-18');         // no deadline: < also starts at today
});
