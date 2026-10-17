// The Items view's row actions (SPEC §3.8) that go through a dialog or a quick mutation: staple
// on/off (`s`), the category picker (`c`, the row's category button), delete with a confirm
// naming the affected recipes, merge (picker, then a confirm explaining the result) and
// `+ New item "…"` (category picker, then create). Each mutation runs in the view's queue and
// reads the latest item first, so `s s s` lands as three toggles. Focus comes back to the row
// afterwards (a dialog's opener may have been re-rendered away meanwhile).

import { deleteMessage, itemBody, mergeMessage } from '../items-model.js';
import { pickCategory, pickMergeTarget } from './items-pickers.js';

/**
 * @param {object} host
 * @param {object} host.store
 * @param {object} host.api
 * @param {Function} host.toast
 * @param {Function} host.confirm
 * @param {ReturnType<import('../queue.js').createQueue>} host.queue
 * @param {ReturnType<import('./items-rows.js').createItemRows>} host.rows
 * @param {() => void} host.render        re-render the rows (flash marks show)
 * @param {() => void} host.refresh       recompute the filter results, then render
 * @param {() => void} host.focusInput
 * @param {() => number|null} host.editingId   the item whose editor is open
 * @param {() => void} host.closeEditor   close it (focus goes to its row)
 */
export function createItemActions(host) {
  const { store, api, toast, confirm, queue, rows } = host;
  const latest = (id) => store.state.itemsById.get(id);
  const keyOf = (id) => `item-${id}`;

  /** After a dialog about item `id`: back to its row (else the filter). */
  function refocus(id) {
    if (!rows.hasFocus() && !rows.focusRow(keyOf(id))) host.focusInput();
  }

  /** After a confirm: a "yes" closes the item's editor first (its row gets focus). */
  function settle(id, ok) {
    if (ok && host.editingId() === id) host.closeEditor();
    else refocus(id);
  }

  /** Runs `update(latestItem)` in the queue; `then(result)` runs if it returned something. */
  function mutate(id, update, then) {
    queue
      .run(async () => {
        const item = latest(id);
        return item ? update(item) : null;
      })
      .then(
        (result) => {
          if (result === null || result === undefined) return;
          rows.flash(id);
          host.render();
          then(result);
        },
        () => {}, // the api toasted the server's message
      );
  }

  function staple(id) {
    mutate(
      id,
      async (item) => {
        await api.updateItem(id, itemBody(item, { staple: !item.staple }));
        return { name: item.name, staple: !item.staple };
      },
      (done) => toast(done.staple ? `${done.name} is a staple now` : `${done.name} is no longer a staple`),
    );
  }

  async function category(id) {
    const item = latest(id);
    if (!item) return;
    const choice = await pickCategory({ store, title: `Category for ${item.name}`, current: item.category_id ?? null });
    refocus(id);
    if (!choice) return;
    mutate(
      id,
      async (now) => {
        if ((now.category_id ?? null) === choice.categoryId) return null;
        await api.updateItem(id, itemBody(now, { category_id: choice.categoryId }));
        return now.name;
      },
      (name) => {
        const picked = store.state.categoriesById.get(choice.categoryId);
        toast(picked ? `Moved ${name} to ${picked.name}` : `${name} is uncategorized now`);
      },
    );
  }

  async function remove(id) {
    const item = latest(id);
    if (!item) return;
    const ok = await confirm({
      title: `Delete ${item.name}?`,
      message: deleteMessage(item, store.state),
      confirmLabel: 'Delete item',
      danger: true,
    });
    settle(id, ok);
    if (!ok) return;
    queue.run(() => api.deleteItem(id)).then(
      () => toast(`Deleted ${item.name}`),
      () => {},
    );
  }

  async function merge(id) {
    const from = latest(id);
    if (!from) return;
    const intoId = await pickMergeTarget({ store, item: from });
    const into = intoId === null ? null : latest(intoId);
    if (!into || !latest(id)) {
      refocus(id);
      return;
    }
    const ok = await confirm({
      title: `Merge ${from.name} into ${into.name}?`,
      message: mergeMessage(latest(id), into, store.state),
      confirmLabel: 'Merge',
      testid: 'merge-confirm',
    });
    settle(id, ok);
    if (!ok) return;
    queue.run(() => api.mergeItem(id, intoId)).then(
      () => {
        rows.flash(intoId);
        host.render();
        rows.focusRow(keyOf(intoId));
        toast(`Merged ${from.name} into ${into.name}`);
      },
      () => {},
    );
  }

  /** `+ New item "…"`: pick a category, create, then focus the new row. */
  async function create(name) {
    const choice = await pickCategory({ store, title: `New item "${name}"`, lead: 'Choose its category.' });
    if (!choice) {
      host.focusInput();
      return;
    }
    try {
      const { id } = await queue.run(() => api.createItem({ name, category_id: choice.categoryId }));
      rows.flash(id);
      host.refresh();
      if (!rows.focusRow(keyOf(id))) host.focusInput();
    } catch {
      host.focusInput(); // the api toasted the server's message
    }
  }

  return { staple, category, delete: remove, merge, create };
}
