import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_KEY, otherTheme, readTheme, writeTheme } from './theme.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const throwing = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
  removeItem() {
    throw new Error('blocked');
  },
};

test('light is the default: nothing stored, junk, no storage or blocked storage', () => {
  assert.equal(readTheme(memoryStorage()), 'light');
  assert.equal(readTheme(memoryStorage({ [THEME_KEY]: 'purple' })), 'light');
  assert.equal(readTheme(null), 'light');
  assert.equal(readTheme(throwing), 'light');
});

test('dark round-trips; light is stored as no entry', () => {
  const storage = memoryStorage();
  writeTheme(storage, 'dark');
  assert.equal(storage.data.get(THEME_KEY), 'dark');
  assert.equal(readTheme(storage), 'dark');
  writeTheme(storage, 'light');
  assert.equal(storage.data.has(THEME_KEY), false);
  assert.equal(readTheme(storage), 'light');
});

test('writing never throws when storage is missing or blocked', () => {
  assert.doesNotThrow(() => writeTheme(null, 'dark'));
  assert.doesNotThrow(() => writeTheme(throwing, 'dark'));
  assert.doesNotThrow(() => writeTheme(throwing, 'light'));
});

test('otherTheme flips between the two', () => {
  assert.equal(otherTheme('light'), 'dark');
  assert.equal(otherTheme('dark'), 'light');
});
