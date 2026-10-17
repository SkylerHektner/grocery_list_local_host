// DOM builders for the list (see list-rows.js for the behaviour): category groups, rows, the
// inline note editor and the empty state. No state of their own: `view` carries what to show
// and the handlers to call.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { noteArt } from '../components/empty.js';

/**
 * @typedef {object} RowView
 * @property {number|null} editingId   the row whose note editor is open
 * @property {number|null} cursorId    the row with tabindex=0 (roving tabindex)
 * @property {Map<number, number>} flashes  item id -> time its highlight started
 * @property {number} now
 * @property {(id: number) => void} onEdit
 * @property {(id: number) => void} onRemove
 * @property {(id: number, value: string) => void} onSave     Enter in the note editor
 * @property {(id: number) => void} onCancel                  Esc in the note editor
 * @property {(id: number, input: HTMLInputElement) => void} onBlur
 */

/**
 * @param {import('../list-model.js').ListGroup} group
 * @param {RowView} view
 */
export function groupView(group, view) {
  const headingId = `list-group-${group.key}`;
  return h(
    'section',
    { class: 'list-group', testid: 'list-group', 'data-category': group.name, 'aria-labelledby': headingId },
    h(
      'h2',
      { class: 'group-header', id: headingId },
      h('span', { class: 'group-name' }, group.name),
      h('span', { class: 'group-count', 'aria-label': `${group.rows.length} items` }, group.rows.length),
    ),
    h('ul', { class: 'rows' }, group.rows.map((r) => rowView(r, view))),
  );
}

/**
 * @param {import('../list-model.js').ListRow} row
 * @param {RowView} view
 */
function rowView({ entry, item, recipes }, view) {
  const id = item.id;
  const editing = view.editingId === id;
  const flashed = view.flashes.get(id);
  const button = (testid, key, label, title, iconName, size, onClick) =>
    h(
      'button',
      {
        type: 'button',
        class: ['btn btn-ghost btn-icon btn-sm', testid === 'remove-entry' ? 'row-remove' : 'row-note-btn'],
        tabindex: '-1',
        'aria-label': label,
        title,
        testid,
        dataset: { key },
        onClick: (e) => {
          e.stopPropagation();
          onClick(id);
        },
      },
      icon(iconName, { size }),
    );
  return h(
    'li',
    {
      class: ['row', 'list-row', editing && 'is-editing', flashed && 'is-flash'],
      // Re-renders mid-highlight continue the animation instead of restarting it.
      style: flashed ? { animationDelay: `-${view.now - flashed}ms` } : null,
      tabindex: id === view.cursorId ? '0' : '-1',
      testid: 'list-row',
      dataset: { key: `item-${id}`, itemId: String(id) },
    },
    h(
      'div',
      { class: 'row-main', onClick: () => view.onEdit(id) },
      h('span', { class: 'row-name', testid: 'row-name' }, item.name),
      editing
        ? noteInput(id, item, entry.note, view)
        : entry.note && h('span', { class: 'row-note', testid: 'row-note' }, entry.note),
    ),
    recipes.length > 0 &&
      h('span', { class: 'row-tags' }, recipes.map((r) => h('span', { class: 'tag', testid: 'row-source' }, r.name))),
    h(
      'span',
      { class: 'row-actions' },
      !editing &&
        button(
          'edit-note',
          `note-btn-${id}`,
          entry.note ? `Edit the note for ${item.name}` : `Add a note to ${item.name}`,
          'Note (Enter)',
          'pencil',
          16,
          view.onEdit,
        ),
      button('remove-entry', `remove-${id}`, `Remove ${item.name}`, 'Remove (Delete)', 'close', 18, view.onRemove),
    ),
  );
}

function noteInput(id, item, note, view) {
  const input = h('input', {
    class: 'input note-input',
    type: 'text',
    value: note ?? '',
    placeholder: 'Add a note, e.g. 2 dozen',
    maxlength: '80',
    'aria-label': `Note for ${item.name}`,
    enterkeyhint: 'done',
    autocomplete: 'off',
    testid: 'note-input',
    dataset: { key: `note-${id}` },
    onClick: (e) => e.stopPropagation(),
    onKeydown: (e) => {
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        view.onSave(id, input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        view.onCancel(id);
      }
    },
    onBlur: () => view.onBlur(id, input),
  });
  return input;
}

/** The empty list: teaches the core loop. */
export function emptyView() {
  const kbd = (key) => h('kbd', { class: 'kbd' }, key);
  return h(
    'div',
    { class: 'empty list-empty', testid: 'list-empty' },
    noteArt(),
    h('h2', { class: 'empty-title' }, 'Your list is empty'),
    h(
      'p',
      { class: 'empty-body' },
      h('span', { class: 'only-keys' }, 'Type an item and press ', kbd('Enter'), '. Then the next one.'),
      h('span', { class: 'only-touch' }, 'Type an item above and tap it to add it.'),
    ),
    h(
      'ul',
      { class: 'empty-tips' },
      h('li', null, h('code', null, 'eggs, 2 dozen'), ' adds a note'),
      h(
        'li',
        null,
        h('span', { class: 'only-keys' }, kbd('Shift+Enter'), ' creates a new item'),
        h('span', { class: 'only-touch' }, 'Unknown items can be created on the spot'),
      ),
      h('li', { class: 'only-keys' }, kbd('↓'), ' moves into the list to edit or remove'),
    ),
  );
}
