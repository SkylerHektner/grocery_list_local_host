// Serial task queue. Tasks run one at a time, in the order they were queued, so a burst of
// mutations (milk⏎ eggs⏎ bananas⏎, Delete Delete Ctrl+Z) all land on the server in order and
// each one sees the state the previous one produced. A failed task never blocks later ones.
// Pure; no DOM.
//
//   const queue = createQueue();
//   queue.run(() => api.addToList(id)).catch(() => {});   // api already toasted the error

/**
 * @returns {{
 *   run: <T>(task: () => T | Promise<T>) => Promise<T>,
 *   idle: () => Promise<void>,
 *   readonly size: number,
 * }}
 */
export function createQueue() {
  let tail = Promise.resolve();
  let size = 0;
  const settle = () => {
    size -= 1;
  };
  return {
    /**
     * Queues `task`; it starts once every earlier task has settled. Resolves/rejects with the
     * task's own result.
     */
    run(task) {
      size += 1;
      const result = tail.then(() => task());
      tail = result.then(settle, settle);
      return result;
    },
    /** Resolves once every task queued so far has settled. */
    idle() {
      return tail;
    },
    /** Tasks queued or running. */
    get size() {
      return size;
    },
  };
}
