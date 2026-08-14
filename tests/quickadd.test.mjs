import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

const T = '2026-07-18';

test('full quick-add line', () => {
  const p = Core.parseQuickAdd('work: Ship report #A :urgent: @jul22 ~3h', T);
  assert.deepEqual(p, { topic: 'work', title: 'Ship report', priority: 'A',
                        tags: ['urgent'], deadline: '2026-07-22', repeat: null, effort: '3h' });
});

test('title only — everything else defaults', () => {
  const p = Core.parseQuickAdd('Just a task', T);
  assert.deepEqual(p, { topic: null, title: 'Just a task', priority: null,
                        tags: [], deadline: null, repeat: null, effort: null });
});

test('date forms pass through parseDateToken', () => {
  assert.equal(Core.parseQuickAdd('x @2026-07-22', T).deadline, '2026-07-22');
  assert.equal(Core.parseQuickAdd('x @tomorrow', T).deadline, '2026-07-19');
  assert.equal(Core.parseQuickAdd('x @fri', T).deadline, '2026-07-24');
});

test('unrecognized @token stays in the title', () => {
  const p = Core.parseQuickAdd('email @john about report', T);
  assert.equal(p.deadline, null);
  assert.equal(p.title, 'email @john about report');
});

test('multiple tag groups and effort forms', () => {
  const p = Core.parseQuickAdd('x :a: :b:c: ~30m', T);
  assert.deepEqual(p.tags, ['a', 'b', 'c']);
  assert.equal(p.effort, '30m');
  assert.equal(Core.parseQuickAdd('x ~1.5h', T).effort, '1.5h');
  assert.equal(Core.parseQuickAdd('x ~1d', T).effort, '1d');
});

test('lower-case priority accepted', () => {
  assert.equal(Core.parseQuickAdd('x #b', T).priority, 'B');
});
