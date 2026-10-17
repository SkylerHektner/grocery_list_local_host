// DOM builders for the recipe editor's ingredient rows (see recipe-ingredients.js for the
// behaviour): category groups, rows with the recipe's note for each item and its inline editor,
// and the empty state. No state of their own: `view` carries what to show and the handlers.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { noteArt } from '../components/empty.js';

const kbd = (key) => h('kbd', { class: 'kbd' }, key);

/**
 * @typedef {object} IngredientView
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
 * @param {import('../recipes-model.js').IngredientGroup} group
 * @param {IngredientView} view
 */
export function ingredientGroupView(group, view) {
  return h(
    'section',
    { class: 'list-group', testid: 'ingredient-group', 'data-category': group.name, 'aria-label': group.name },
    h(
      'h2',
      { class: 'group-header', 'aria-hidden': 'true' },
      h('span', { class: 'group-name' }, group.name),
      h('span', { class: 'group-count' }, group.rows.length),
    ),
    h('ul', { class: 'rows', role: 'list' }, group.rows.map((r) => rowView(r, view))),
  );
}

/**
 * @param {import('../recipes-model.js').IngredientRow} row
 * @param {IngredientView} view
 */
function rowView({ item, note, staple }, view) {
  const id = item.id;
  const editing = view.editingId === id;
  const flashed = view.flashes.get(id);
  const button = (cls, testid, label, title, iconName, size, onClick) =>
    h(
      'button',
      {
        type: 'button',
        class: ['btn btn-ghost btn-icon btn-sm', cls],
        tabindex: '-1',
        'aria-label': label,
        title,
        testid,
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
      class: ['row', 'list-row', 'ingredient-row', editing && 'is-editing', flashed && 'is-flash'],
      style: flashed ? { animationDelay: `-${view.now - flashed}ms` } : null,
      tabindex: id === view.cursorId ? '0' : '-1',
      'aria-label': editing ? null : [item.name, note && `note: ${note}`, staple && 'staple'].filter(Boolean).join(', '),
      testid: 'ingredient-row',
      dataset: { key: `ingredient-${id}`, itemId: String(id) },
    },
    h(
      'div',
      { class: 'row-main', onClick: () => view.onEdit(id) },
      h('span', { class: 'row-name', testid: 'ingredient-name' }, item.name),
      editing
        ? noteInput(id, item, note, view)
        : note && h('span', { class: 'row-note', testid: 'ingredient-note' }, note),
      staple &&
        h(
          'span',
          { class: 'row-tags' },
          h('span', { class: 'tag tag-warm', title: 'Starts unchecked when the recipe goes on the list' }, 'staple'),
        ),
    ),
    h(
      'span',
      { class: 'row-actions' },
      !editing &&
        button(
          'row-note-btn',
          'ingredient-edit-note',
          note ? `Edit the note for ${item.name}` : `Add a note to ${item.name}`,
          'Note (Enter)',
          'pencil',
          16,
          view.onEdit,
        ),
      button('row-remove', 'ingredient-remove', `Remove ${item.name} from the recipe`, 'Remove (Delete)', 'close', 18, view.onRemove),
    ),
  );
}

function noteInput(id, item, note, view) {
  const input = h('input', {
    class: 'input note-input',
    type: 'text',
    value: note ?? '',
    placeholder: 'Note for the list, e.g. 1 lb',
    maxlength: '80',
    'aria-label': `Note for ${item.name} in this recipe`,
    enterkeyhint: 'done',
    autocomplete: 'off',
    testid: 'ingredient-note-input',
    dataset: { key: `ingredient-note-${id}` },
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

/** A recipe without ingredients: teaches adding them. */
export function ingredientsEmptyView() {
  return h(
    'div',
    { class: 'empty list-empty', testid: 'ingredients-empty' },
    noteArt(),
    h('h2', { class: 'empty-title' }, 'No ingredients yet'),
    h(
      'p',
      { class: 'empty-body' },
      h('span', { class: 'only-keys' }, 'Type an item and press ', kbd('Enter'), '. Then the next one.'),
      h('span', { class: 'only-touch' }, 'Type an item above and tap it to add it.'),
    ),
    h(
      'ul',
      { class: 'empty-tips' },
      h(
        'li',
        null,
        h('span', { class: 'only-keys' }, kbd('Shift+Enter'), ' creates a new item'),
        h('span', { class: 'only-touch' }, 'Unknown items can be created on the spot'),
      ),
      h('li', null, h('code', null, 'ground beef, 1 lb'), ' adds a note for the list'),
      h('li', null, 'Staples start unchecked when the recipe goes on the list'),
    ),
  );
}
