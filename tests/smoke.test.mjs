import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

test('Core is extracted from index.html', () => {
  assert.equal(typeof Core, 'object');
  assert.equal(Core.version, 1);
});
