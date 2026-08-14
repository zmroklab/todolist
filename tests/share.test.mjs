import test from 'node:test';
import assert from 'node:assert/strict';
import { Core } from './harness.mjs';

test('parseShareExpr: includes and excludes', () => {
  assert.deepEqual(Core.parseShareExpr('flo and !elena and !volha'),
                   { include: ['flo'], exclude: ['elena', 'volha'] });
});

test('parseShareExpr: "and" is optional sugar', () => {
  assert.deepEqual(Core.parseShareExpr('flo !elena'),
                   Core.parseShareExpr('flo and !elena'));
});

test('parseShareExpr: case-insensitive, lowercases words', () => {
  assert.deepEqual(Core.parseShareExpr('FLO AND !Elena'),
                   { include: ['flo'], exclude: ['elena'] });
});

test('parseShareExpr: whitespace tolerated', () => {
  assert.deepEqual(Core.parseShareExpr('  flo   and   work  '),
                   { include: ['flo', 'work'], exclude: [] });
});

test('parseShareExpr: empty input matches everything', () => {
  assert.deepEqual(Core.parseShareExpr(''), { include: [], exclude: [] });
  assert.deepEqual(Core.parseShareExpr('   '), { include: [], exclude: [] });
});

test('parseShareExpr: only negatives', () => {
  assert.deepEqual(Core.parseShareExpr('!home'), { include: [], exclude: ['home'] });
});

test('parseShareExpr: tag charset allowed in words', () => {
  assert.deepEqual(Core.parseShareExpr('q3_plan and !one-on-one and !x@y'),
                   { include: ['q3_plan'], exclude: ['one-on-one', 'x@y'] });
});

test('parseShareExpr: malformed inputs error', () => {
  for (const bad of ['!', 'flo and', 'and flo', 'flo and and work', '!and', 'a?b', 'flo AND'])
    assert.ok(Core.parseShareExpr(bad).error, JSON.stringify(bad) + ' should be an error');
});

const mk = text => Core.parseOrg(text);
const X = s => Core.parseShareExpr(s);

test('matchesShare: word matches topic', () => {
  const t = mk('* TODO Ship report\n').tasks[0];
  assert.ok(Core.matchesShare('flo', t, null, X('flo')));
  assert.ok(!Core.matchesShare('home', t, null, X('flo')));
});

test('matchesShare: word matches tag, case-insensitively', () => {
  const t = mk('* TODO 1:1 prep :Elena:\n').tasks[0];
  assert.ok(!Core.matchesShare('flo', t, null, X('flo and !elena')));
  assert.ok(Core.matchesShare('flo', t, null, X('flo and !volha')));
});

test('matchesShare: positives are a union', () => {
  const t = mk('* TODO x\n').tasks[0];
  assert.ok(Core.matchesShare('work', t, null, X('flo and work')));
  assert.ok(Core.matchesShare('flo', t, null, X('flo and work')));
  assert.ok(!Core.matchesShare('home', t, null, X('flo and work')));
});

test('matchesShare: exclude wins over include', () => {
  const t = mk('* TODO 1:1 :elena:\n').tasks[0];
  assert.ok(!Core.matchesShare('flo', t, null, X('flo and elena and !elena')));
});

test('matchesShare: sub-tasks inherit parent tags', () => {
  const f = mk('* TODO Reports :elena:\n** TODO Review comp\n');
  const parent = f.tasks[0], child = parent.children[0];
  assert.ok(!Core.matchesShare('flo', child, parent, X('flo and !elena')));
  assert.ok(Core.matchesShare('flo', child, parent, X('flo')));
});

test('matchesShare: only negatives / empty expression', () => {
  const t = mk('* TODO x\n').tasks[0];
  assert.ok(Core.matchesShare('work', t, null, X('!home')));
  assert.ok(!Core.matchesShare('home', t, null, X('!home')));
  assert.ok(Core.matchesShare('anything', t, null, X('')));
});

test('matchesShare: error expression matches nothing (fail closed)', () => {
  const t = mk('* TODO x\n').tasks[0];
  assert.ok(!Core.matchesShare('flo', t, null, X('!')));
  assert.ok(!Core.matchesShare('flo', t, null, null));
});

test('shareTopicVisible', () => {
  assert.ok(Core.shareTopicVisible('flo', X('flo and !elena')));
  assert.ok(!Core.shareTopicVisible('home', X('flo and !elena')));   // not included
  assert.ok(!Core.shareTopicVisible('home', X('!home')));            // excluded
  assert.ok(Core.shareTopicVisible('work', X('!home')));             // no includes: rest visible
  assert.ok(Core.shareTopicVisible('anything', X('')));              // empty expr
  assert.ok(!Core.shareTopicVisible('flo', X('!')));                 // error: fail closed
});
