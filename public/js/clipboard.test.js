import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { clipboardApi, copyWithFallbacks, execCommandCopy } from './clipboard.js';

function recorder() {
  const calls = [];
  return {
    calls,
    manual: (text) => {
      calls.push(['manual', text]);
    },
  };
}

describe('copyWithFallbacks', () => {
  test('uses the Clipboard API when it works', async () => {
    const r = recorder();
    const how = await copyWithFallbacks('A\nB', {
      clipboard: async (t) => r.calls.push(['clipboard', t]),
      command: () => assert.fail('not reached'),
      manual: r.manual,
    });
    assert.equal(how, 'clipboard');
    assert.deepEqual(r.calls, [['clipboard', 'A\nB']]);
  });

  test('falls back to execCommand when the API rejects or is unavailable', async () => {
    for (const clipboard of [null, async () => Promise.reject(new Error('NotAllowedError'))]) {
      const r = recorder();
      const how = await copyWithFallbacks('text', {
        clipboard,
        command: (t) => {
          r.calls.push(['command', t]);
          return true;
        },
        manual: r.manual,
      });
      assert.equal(how, 'command');
      assert.deepEqual(r.calls, [['command', 'text']]);
    }
  });

  test('without the API, execCommand runs synchronously (inside the user gesture)', () => {
    let ran = false;
    copyWithFallbacks('x', { clipboard: null, command: () => (ran = true), manual: () => {} });
    assert.equal(ran, true);
  });

  test('shows the manual copy when execCommand fails, throws or is missing', async () => {
    const commands = [() => false, () => { throw new Error('nope'); }, null];
    for (const command of commands) {
      const r = recorder();
      const how = await copyWithFallbacks('text', { clipboard: null, command, manual: r.manual });
      assert.equal(how, 'manual');
      assert.deepEqual(r.calls, [['manual', 'text']]);
    }
  });

  test('waits for the manual step to finish', async () => {
    let closed = false;
    const how = await copyWithFallbacks('t', {
      manual: () => new Promise((resolve) => setTimeout(() => resolve((closed = true)), 5)),
    });
    assert.equal(how, 'manual');
    assert.equal(closed, true);
  });
});

describe('clipboardApi', () => {
  const nav = { clipboard: { writeText: async () => {} } };

  test('only in a secure context with writeText', () => {
    assert.equal(typeof clipboardApi({ isSecureContext: true, navigator: nav }), 'function');
    assert.equal(clipboardApi({ isSecureContext: false, navigator: nav }), null);
    assert.equal(clipboardApi({ isSecureContext: true, navigator: {} }), null);
    assert.equal(clipboardApi({ isSecureContext: true }), null);
  });
});

describe('execCommandCopy', () => {
  test('is null without a document that has execCommand', () => {
    assert.equal(execCommandCopy(undefined), null);
    assert.equal(execCommandCopy({}), null);
  });

  test('selects a temporary textarea, copies, removes it and restores focus', () => {
    const log = [];
    const field = {
      selectionStart: 2,
      selectionEnd: 4,
      selectionDirection: 'forward',
      focus: () => log.push('field focus'),
      setSelectionRange: (...args) => log.push(['field select', ...args]),
    };
    const area = {
      style: {},
      setAttribute() {},
      focus: () => log.push('area focus'),
      select: () => log.push('area select'),
      setSelectionRange: (a, b) => log.push(['area range', a, b]),
      remove: () => log.push('area removed'),
    };
    const doc = {
      activeElement: field,
      body: { append: (el) => log.push(el === area ? 'area added' : 'other') },
      createElement: () => area,
      execCommand: (cmd) => {
        log.push(['exec', cmd, area.value]);
        return true;
      },
    };
    const copy = execCommandCopy(doc);
    assert.equal(copy('PRODUCE\nBananas'), true);
    assert.deepEqual(log, [
      'area added',
      'area focus',
      'area select',
      ['area range', 0, 15],
      ['exec', 'copy', 'PRODUCE\nBananas'],
      'area removed',
      'field focus',
      ['field select', 2, 4, 'forward'],
    ]);
  });

  test('reports false when the browser refuses', () => {
    const doc = {
      activeElement: null,
      body: { append() {} },
      createElement: () => ({ style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() {} }),
      execCommand: () => false,
    };
    assert.equal(execCommandCopy(doc)('x'), false);
  });
});
