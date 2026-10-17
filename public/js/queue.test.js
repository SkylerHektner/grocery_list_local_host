import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createQueue } from './queue.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('tasks run one at a time, in order, even when later ones are faster', async () => {
  const queue = createQueue();
  const log = [];
  const task = (name, ms) => () =>
    new Promise((resolve) => {
      log.push(`start ${name}`);
      setTimeout(() => {
        log.push(`end ${name}`);
        resolve(name);
      }, ms);
    });
  const results = await Promise.all([queue.run(task('a', 20)), queue.run(task('b', 1)), queue.run(task('c', 5))]);
  assert.deepEqual(results, ['a', 'b', 'c']);
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
});

test('a failing task rejects its own promise but does not block the next', async () => {
  const queue = createQueue();
  const failed = queue.run(async () => {
    throw new Error('boom');
  });
  const next = queue.run(() => 'ok');
  await assert.rejects(failed, /boom/);
  assert.equal(await next, 'ok');
});

test('a synchronously throwing task is a rejection, not a crash', async () => {
  const queue = createQueue();
  const failed = queue.run(() => {
    throw new Error('sync');
  });
  await assert.rejects(failed, /sync/);
  assert.equal(await queue.run(() => 2), 2);
});

test('a task queued from inside a running task runs after it', async () => {
  const queue = createQueue();
  const log = [];
  await queue.run(async () => {
    log.push('outer start');
    queue.run(() => log.push('inner'));
    await tick();
    log.push('outer end');
  });
  await queue.idle();
  assert.deepEqual(log, ['outer start', 'outer end', 'inner']);
});

test('size counts queued and running tasks; idle waits for all of them', async () => {
  const queue = createQueue();
  assert.equal(queue.size, 0);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  queue.run(() => gate);
  queue.run(() => {});
  assert.equal(queue.size, 2);
  release();
  await queue.idle();
  assert.equal(queue.size, 0);
});
