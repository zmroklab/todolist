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
