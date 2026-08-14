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
