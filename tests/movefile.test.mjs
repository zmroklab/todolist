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
