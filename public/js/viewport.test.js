import { test } from 'node:test';
import assert from 'node:assert/strict';

import { roomBelow, viewportVars } from './viewport.js';

test('viewportVars: no keyboard', () => {
  assert.deepEqual(viewportVars(812, { height: 812, offsetTop: 0 }), {
    '--vv-top': '0px',
    '--vv-height': '812px',
    '--kb-inset': '0px',
  });
});

test('viewportVars: the keyboard covers the bottom (Android) or the page scrolled under it (iOS)', () => {
  assert.deepEqual(viewportVars(812, { height: 476, offsetTop: 0 }), {
    '--vv-top': '0px',
    '--vv-height': '476px',
    '--kb-inset': '336px',
  });
  assert.deepEqual(viewportVars(812, { height: 476.4, offsetTop: 120 }), {
    '--vv-top': '120px',
    '--vv-height': '476px',
    '--kb-inset': '216px',
  });
});

test('viewportVars: without visualViewport, the whole window', () => {
  assert.deepEqual(viewportVars(700, undefined), { '--vv-top': '0px', '--vv-height': '700px', '--kb-inset': '0px' });
});

test('roomBelow: space down to the bottom of the visible area, never under the minimum', () => {
  const phone = { innerHeight: 812, visualViewport: { height: 476, offsetTop: 0 } };
  assert.equal(roomBelow(200, phone), 268);
  assert.equal(roomBelow(200, phone, { margin: 0 }), 276);
  assert.equal(roomBelow(450, phone), 140, 'minimum');
  assert.equal(roomBelow(100, { innerHeight: 600 }, { min: 0 }), 492);
});
