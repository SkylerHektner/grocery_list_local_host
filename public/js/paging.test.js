import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ROW_PAGE, moreLabel, visibleResults } from './paging.js';

const results = Array.from({ length: 250 }, (_, i) => ({ item: { id: i + 1 } }));

test('visibleResults: the first page, and how many are left', () => {
  const { shown, hidden } = visibleResults(results, ROW_PAGE);
  assert.equal(shown.length, 100);
  assert.equal(hidden, 150);
  assert.equal(visibleResults(results.slice(0, 5), ROW_PAGE).hidden, 0);
  assert.equal(visibleResults(results, 1000).shown.length, 250);
});

test('visibleResults: rows that must stay (the editor, a row about to get focus) extend the page', () => {
  const { shown, hidden } = visibleResults(results, 100, [null, undefined, 180, 9999]);
  assert.equal(shown.length, 180);
  assert.equal(shown.at(-1).item.id, 180);
  assert.equal(hidden, 70);
  assert.equal(visibleResults(results, 100, [5]).shown.length, 100);
});

test('moreLabel', () => {
  assert.equal(moreLabel(1145), 'Show 100 more (1145 not shown)');
  assert.equal(moreLabel(100), 'Show the last 100');
  assert.equal(moreLabel(7), 'Show the last 7');
  assert.equal(moreLabel(1), 'Show the last item');
});
