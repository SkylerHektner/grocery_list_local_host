// The Items view's inline editor (SPEC §3.8): name, category, aliases (comma-separated) and the
// staple flag of one item, plus "Merge into…" and "Delete". Enter in any field saves, Esc
// cancels. The element is created once per edit and moved (not rebuilt) by live-sync
// re-renders, so typing, focus and selection survive them; only the category <select> options
// follow other devices (renamed/added/deleted categories). The server's validation message
// shows inline, on the field it is about.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { draftChanged, formatAliases, parseAliases } from '../items-model.js';

/**
 * @param {object} options
 * @param {object} options.item       the item as the edit starts
 * @param {object} options.state      derived store state (categories for the select)
 * @param {() => void} options.onSave
 * @param {() => void} options.onCancel
 * @param {() => void} options.onMerge
 * @param {() => void} options.onDelete
 */
export function createItemEditor({ item, state, onSave, onCancel, onMerge, onDelete }) {
  const id = item.id;
  const baseline = item;
  let busy = false;

  const field = (name, key) => ({ testid: `item-edit-${name}`, dataset: { key: `edit-${key}-${id}` } });
  const clearError = () => showError(null);

  const nameInput = h('input', {
    class: 'input',
    type: 'text',
    value: item.name,
    maxlength: '80',
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    ...field('name', 'name'),
    onInput: clearError,
  });
  const categorySelect = h('select', { class: 'input item-select', ...field('category', 'category'), onChange: clearError });
  const aliasesInput = h('input', {
    class: 'input',
    type: 'text',
    value: formatAliases(item.aliases),
    placeholder: 'e.g. Parmesan, Parm',
    autocomplete: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    ...field('aliases', 'aliases'),
    onInput: clearError,
  });
  const stapleBox = h('input', { type: 'checkbox', class: 'checkbox', checked: !!item.staple, ...field('staple', 'staple') });
  const error = h('p', { class: 'field-error', role: 'alert', testid: 'item-editor-error', hidden: true });
  const saveButton = h('button', { type: 'button', class: 'btn btn-primary btn-sm', testid: 'item-edit-save', onClick: () => onSave() }, 'Save');
  const fields = { name: nameInput, category: categorySelect, aliases: aliasesInput };

  let signature = null; // categories the select was built from
  fillCategories(state, item.category_id);

  /** (Re)builds the select's options, keeping `selected` when that category still exists. */
  function fillCategories(s, selected) {
    const next = s.categories.map((c) => `${c.id}:${c.name}`).join('\n');
    if (next === signature) return; // unchanged: don't disturb an open dropdown
    signature = next;
    const value = selected !== null && selected !== undefined && s.categoriesById.has(selected) ? String(selected) : '';
    categorySelect.replaceChildren(
      ...s.categories.map((c) => h('option', { value: String(c.id) }, c.name)),
      h('option', { value: '' }, 'Uncategorized'),
    );
    categorySelect.value = value;
  }

  const label = (text, control, extra) => h('label', { class: ['field', extra] }, h('span', { class: 'field-label' }, text), control);

  const el = h(
    'div',
    {
      class: 'item-editor',
      role: 'group',
      tabindex: '-1',
      'aria-label': `Edit ${item.name}`,
      testid: 'item-editor',
      onKeydown: (e) => {
        if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        } else if (e.key === 'Enter' && !e.shiftKey && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          e.stopPropagation();
          if (!e.repeat) onSave();
        }
      },
    },
    h(
      'div',
      { class: 'item-editor-fields' },
      label('Name', nameInput, 'field-name'),
      label('Category', categorySelect, 'field-category'),
      label('Aliases', aliasesInput, 'field-aliases'),
      h(
        'label',
        { class: 'field-check' },
        stapleBox,
        h('span', null, h('strong', null, 'Staple'), h('span', { class: 'muted' }, ' · usually have it; recipes add it unchecked')),
      ),
    ),
    error,
    h(
      'div',
      { class: 'item-editor-actions' },
      h(
        'span',
        { class: 'item-editor-more' },
        h(
          'button',
          { type: 'button', class: 'btn btn-ghost btn-sm', testid: 'item-merge', title: 'Merge into another item (m)', onClick: () => onMerge() },
          icon('merge', { size: 16 }),
          'Merge into…',
        ),
        h(
          'button',
          { type: 'button', class: 'btn btn-ghost btn-sm btn-quiet-danger', testid: 'item-delete', title: 'Delete (Delete)', onClick: () => onDelete() },
          icon('trash', { size: 16 }),
          'Delete',
        ),
      ),
      h(
        'span',
        { class: 'item-editor-done' },
        h('span', { class: 'item-editor-keys only-keys', 'aria-hidden': 'true' }, h('kbd', { class: 'kbd' }, 'Enter'), ' save ', h('kbd', { class: 'kbd' }, 'Esc'), ' cancel'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', testid: 'item-edit-cancel', onClick: () => onCancel() }, 'Cancel'),
        saveButton,
      ),
    ),
  );

  /** @param {string|null} message  @param {'name'|'aliases'|'category'} [at] */
  function showError(message, at = 'name') {
    error.textContent = message ?? '';
    error.hidden = !message;
    for (const [key, control] of Object.entries(fields)) {
      if (message && key === at) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    }
    if (message) {
      error.id = `item-editor-error-${id}`;
      fields[at]?.setAttribute('aria-describedby', error.id);
    }
  }

  return {
    id,
    el,
    /** The draft as a full PUT body. */
    read() {
      return {
        name: nameInput.value,
        category_id: categorySelect.value === '' ? null : Number(categorySelect.value),
        aliases: parseAliases(aliasesInput.value),
        staple: stapleBox.checked,
      };
    },
    /** True when the user changed something since the edit started. */
    dirty() {
      return draftChanged(baseline, this.read());
    },
    /** @param {'name'|'aliases'|'category'} [at] */
    focus(at = 'name') {
      const control = fields[at] ?? nameInput;
      control.focus();
      if (control instanceof HTMLInputElement) control.select();
    },
    showError,
    get busy() {
      return busy;
    },
    setBusy(value) {
      busy = value;
      saveButton.disabled = value;
    },
    /** Live sync: the category options follow other devices; the typing stays. */
    sync(s) {
      fillCategories(s, categorySelect.value === '' ? null : Number(categorySelect.value));
    },
  };
}
