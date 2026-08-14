import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

test('addInterval: day and week arithmetic', () => {
  assert.equal(Core.addInterval('2026-07-25', 1, '+1d'), '2026-07-26');
  assert.equal(Core.addInterval('2026-07-25', -1, '+1d'), '2026-07-24');
  assert.equal(Core.addInterval('2026-07-25', 1, '+2w'), '2026-08-08');
  assert.equal(Core.addInterval('2026-08-08', -1, '+2w'), '2026-07-25');
});

test('addInterval: month arithmetic with end-of-month clamp', () => {
  assert.equal(Core.addInterval('2026-01-31', 1, '+1m'), '2026-02-28'); // Feb has 28
  assert.equal(Core.addInterval('2026-03-31', -1, '+1m'), '2026-02-28');
  assert.equal(Core.addInterval('2026-01-15', 1, '+3m'), '2026-04-15');  // no clamp needed
  assert.equal(Core.addInterval('2026-12-15', 1, '+1m'), '2027-01-15');  // year rollover
});

test('addInterval: year arithmetic with leap-day clamp', () => {
  assert.equal(Core.addInterval('2028-02-29', 1, '+1y'), '2029-02-28');
  assert.equal(Core.addInterval('2026-07-25', 1, '+1y'), '2027-07-25');
});

test('addInterval: unparseable cookie returns null', () => {
  assert.equal(Core.addInterval('2026-07-25', 1, '1w'), null);   // missing +
  assert.equal(Core.addInterval('2026-07-25', 1, '+1x'), null);  // bad unit
  assert.equal(Core.addInterval('2026-07-25', 1, null), null);
});

test('parseOrg captures repeater into t.repeat', () => {
  const f = Core.parseOrg('* TODO Water plants\n  DEADLINE: <2026-08-01 Sat +1w>\n');
  assert.equal(f.tasks[0].deadline, '2026-08-01');
  assert.equal(f.tasks[0].repeat, '+1w');
});

test('parseOrg leaves repeat null when no cookie', () => {
  const f = Core.parseOrg('* TODO Plain\n  DEADLINE: <2026-08-01 Sat>\n');
  assert.equal(f.tasks[0].repeat, null);
});

test('orgActive appends repeater when given', () => {
  assert.equal(Core.orgActive('2026-08-01', '+1w'), '<2026-08-01 Sat +1w>');
  assert.equal(Core.orgActive('2026-08-01'), '<2026-08-01 Sat>');
});

test('round-trip preserves a repeating deadline byte-for-byte', () => {
  const text = '* NEXT Water plants\n  DEADLINE: <2026-08-01 Sat +1w>\n  :PROPERTIES:\n  :ADDED:   [2026-07-25 Sat]\n  :END:\n';
  assert.equal(Core.serializeFile(Core.parseOrg(text)), text);
});

// --- Task 3: setDeadline(iso, repeat) + advanceRepeat ---

function repeating(state = 'NEXT') {
  const f = Core.parseOrg(`* ${state} Water plants\n  DEADLINE: <2026-08-01 Sat +1w>\n`);
  return f.tasks[0];
}

test('advanceRepeat advances one interval and keeps state', () => {
  const t = repeating('NEXT');
  Core.advanceRepeat(t, 1);
  assert.equal(t.deadline, '2026-08-08');
  assert.equal(t.state, 'NEXT');
  assert.equal(t.closed, null);
  assert.equal(t.dirty, true);
});

test('advanceRepeat roll-back is the exact inverse', () => {
  const t = repeating('NEXT');
  Core.advanceRepeat(t, 1);
  Core.advanceRepeat(t, -1);
  assert.equal(t.deadline, '2026-08-01');
});

test('advanceRepeat on a DONE repeat reopens to TODO without CLOSED', () => {
  const t = repeating('DONE');
  Core.advanceRepeat(t, 1);
  assert.equal(t.state, 'TODO');
  assert.equal(t.closed, null);
  assert.equal(t.deadline, '2026-08-08');
});

test('advanceRepeat roll-back on a DONE repeat preserves state and CLOSED stamp', () => {
  const text = '* DONE Water plants\n  CLOSED: [2026-07-20 Mon 10:00] DEADLINE: <2026-08-01 Sat +1w>\n';
  const t = Core.parseOrg(text).tasks[0];
  // Sanity: parser captured both fields from the single planning line.
  assert.equal(t.closed, '2026-07-20 Mon 10:00');
  assert.equal(t.repeat, '+1w');
  Core.advanceRepeat(t, -1);
  assert.equal(t.state, 'DONE');
  assert.equal(t.closed, '2026-07-20 Mon 10:00');
  assert.equal(t.deadline, '2026-07-25');
});

test('advanceRepeat is a no-op without a repeater or deadline', () => {
  const plain = Core.parseOrg('* TODO Plain\n  DEADLINE: <2026-08-01 Sat>\n').tasks[0];
  Core.advanceRepeat(plain, 1);
  assert.equal(plain.deadline, '2026-08-01');
  assert.equal(plain.dirty, false);
});

test('setDeadline carries repeat; clearing the date clears repeat', () => {
  const t = repeating('NEXT');
  Core.setDeadline(t, '2026-09-01', '+2d');
  assert.equal(t.deadline, '2026-09-01');
  assert.equal(t.repeat, '+2d');
  Core.setDeadline(t, null);
  assert.equal(t.deadline, null);
  assert.equal(t.repeat, null);
});

test('bumpDeadline preserves an existing repeater', () => {
  const t = repeating('NEXT');
  Core.bumpDeadline(t, 1, '2026-07-25');
  assert.equal(t.deadline, '2026-08-02');
  assert.equal(t.repeat, '+1w');
});

// Additional round-trip test for dirty re-render path with repeater
test('round-trip after mutation preserves repeating deadline', () => {
  const text = '* NEXT Water plants\n  DEADLINE: <2026-08-01 Sat +1w>\n  :PROPERTIES:\n  :ADDED:   [2026-07-25 Sat]\n  :END:\n';
  const f = Core.parseOrg(text);
  const t = f.tasks[0];
  // Force a dirty re-render by mutating
  Core.setPriority(t, 'A');
  // Serialize and verify the repeater survived
  const output = Core.serializeFile(f);
  assert.match(output, /DEADLINE: <2026-08-01 Sat \+1w>/);
});

// --- Task 4: parseQuickAdd +1w token and makeTask repeat field ---

test('parseQuickAdd reads +1w when a deadline is present', () => {
  const p = Core.parseQuickAdd('Water plants @2026-08-01 +1w', '2026-07-25');
  assert.equal(p.deadline, '2026-08-01');
  assert.equal(p.repeat, '+1w');
  assert.equal(p.title, 'Water plants');
});

test('parseQuickAdd drops +1w when there is no deadline', () => {
  const p = Core.parseQuickAdd('Water plants +1w', '2026-07-25');
  assert.equal(p.deadline, null);
  assert.equal(p.repeat, null);
});

test('parseQuickAdd token order is independent', () => {
  const p = Core.parseQuickAdd('+2d @fri Buy milk', '2026-07-25'); // fri = 2026-07-31
  assert.equal(p.repeat, '+2d');
  assert.equal(p.title, 'Buy milk');
});

test('makeTask stores a repeater', () => {
  const t = Core.makeTask({ title: 'Water', deadline: '2026-08-01', repeat: '+1w' }, '2026-07-25');
  assert.equal(t.repeat, '+1w');
});
