import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

// Regression: the app used to look its org-todo folder up by name, which
// drive.file can't see, so it created a second empty one while the files the
// user had just granted stayed in the first. The picked files' parent is the
// anchor instead.
const doc = (name, parentId) => ({ id: 'id-' + name, name, parentId, mimeType: 'text/plain' });

test('pickedOrgParent: the folder the picked .org files live in', () => {
  assert.equal(Core.pickedOrgParent([doc('flo.org', 'F1'), doc('me.org', 'F1')]), 'F1');
});

test('pickedOrgParent: nothing picked', () => {
  assert.equal(Core.pickedOrgParent([]), null);
  assert.equal(Core.pickedOrgParent(undefined), null);
});

test('pickedOrgParent: non-.org picks never vote', () => {
  assert.equal(Core.pickedOrgParent([doc('shot.png', 'IMAGES'), doc('notes.txt', 'F1')]), null);
  // an image grabbed out of images/ must not drag the folder into the subfolder
  assert.equal(Core.pickedOrgParent([doc('work.org', 'F1'), doc('shot.png', 'IMAGES')]), 'F1');
});

test('pickedOrgParent: mixed folders — the one holding most .org files wins', () => {
  assert.equal(Core.pickedOrgParent(
    [doc('a.org', 'F1'), doc('b.org', 'F2'), doc('c.org', 'F2')]), 'F2');
});

test('pickedOrgParent: ties keep picker order', () => {
  assert.equal(Core.pickedOrgParent([doc('a.org', 'F1'), doc('b.org', 'F2')]), 'F1');
});

test('pickedOrgParent: docs without a parent are skipped', () => {
  assert.equal(Core.pickedOrgParent([{ name: 'a.org' }, doc('b.org', 'F2')]), 'F2');
});
