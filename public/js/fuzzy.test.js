import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalize } from './fuzzy.js';

test('normalize lowercases and strips diacritics', () => {
  assert.equal(normalize('Crème Brûlée'), 'creme brulee');
  assert.equal(normalize('JALAPEÑO'), 'jalapeno');
  assert.equal(normalize('Parmesan'), 'parmesan');
  assert.equal(normalize(''), '');
});
