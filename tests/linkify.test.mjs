import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

test('plain text yields a single text segment', () => {
  assert.deepEqual(Core.linkify('no links here'), [{ text: 'no links here' }]);
});

test('empty string yields no segments', () => {
  assert.deepEqual(Core.linkify(''), []);
});

test('org link with label', () => {
  assert.deepEqual(Core.linkify('Read [[https://docs.foo][the docs]] now'), [
    { text: 'Read ' },
    { url: 'https://docs.foo', label: 'the docs' },
    { text: ' now' },
  ]);
});

test('org link without label uses the url as label', () => {
  assert.deepEqual(Core.linkify('[[https://a.b/c]]'), [
    { url: 'https://a.b/c', label: 'https://a.b/c' },
  ]);
});

test('bare url mid-text keeps query strings', () => {
  assert.deepEqual(Core.linkify('see https://x.y/z?q=1 ok'), [
    { text: 'see ' },
    { url: 'https://x.y/z?q=1', label: 'https://x.y/z?q=1' },
    { text: ' ok' },
  ]);
});

test('trailing punctuation is excluded from bare urls', () => {
  assert.deepEqual(Core.linkify('go to https://x.y/z.'), [
    { text: 'go to ' },
    { url: 'https://x.y/z', label: 'https://x.y/z' },
    { text: '.' },
  ]);
});

test('multiple links in one string', () => {
  assert.deepEqual(Core.linkify('[[https://a.b][A]] and https://c.d'), [
    { url: 'https://a.b', label: 'A' },
    { text: ' and ' },
    { url: 'https://c.d', label: 'https://c.d' },
  ]);
});

test('non-http schemes stay plain text', () => {
  assert.deepEqual(Core.linkify('[[file:images/x.png]] and mailto:a@b'), [
    { text: '[[file:images/x.png]] and mailto:a@b' },
  ]);
});

test('a url inside an org-link label is not double-matched', () => {
  assert.deepEqual(Core.linkify('[[https://a.b/c][see https://a.b/c]]'), [
    { url: 'https://a.b/c', label: 'see https://a.b/c' },
  ]);
});

test('adjacent links with no separating text', () => {
  assert.deepEqual(Core.linkify('[[https://a.b][A]][[https://c.d][C]]'), [
    { url: 'https://a.b', label: 'A' },
    { url: 'https://c.d', label: 'C' },
  ]);
});

test('empty org-link label falls back to the url', () => {
  assert.deepEqual(Core.linkify('[[https://a.b/c][]]'), [
    { url: 'https://a.b/c', label: 'https://a.b/c' },
  ]);
});
