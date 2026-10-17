// Asks for a name (e.g. "New recipe"): a one-field modal. Enter submits, Esc cancels; the
// server's validation message shows under the field and the dialog stays open to fix it.
//
//   const id = await promptName({
//     title: 'New recipe', label: 'Recipe name', confirmLabel: 'Create',
//     submit: async (name) => (await api.quiet.createRecipe({ name })).id,   // throw = error
//   });   // -> the submit result, or null when cancelled

import { h } from '../dom.js';
import { openModal } from './dialog.js';

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.label          accessible name of the field
 * @param {string} [options.value]        initial text (selected)
 * @param {string} [options.placeholder]
 * @param {string} [options.confirmLabel]
 * @param {string} [options.testid]       panel; the field is `-input`, the error `-error`, the
 *   buttons `-confirm` / `-cancel`
 * @param {(name: string) => Promise<unknown>} options.submit  rejects with an Error whose message
 *   is shown
 * @returns {Promise<unknown|null>}
 */
export function promptName({
  title,
  label,
  value = '',
  placeholder = '',
  confirmLabel = 'Save',
  testid = 'name-dialog',
  submit,
}) {
  return new Promise((resolve) => {
    let modal = null;
    let busy = false;
    const errorId = `${testid}-error`;
    const error = h('p', { class: 'field-error', id: errorId, role: 'alert', testid: errorId, hidden: true });
    const input = h('input', {
      class: 'input',
      type: 'text',
      value,
      placeholder,
      maxlength: '80',
      autocomplete: 'off',
      enterkeyhint: 'done',
      'aria-label': label,
      'aria-describedby': errorId,
      testid: `${testid}-input`,
      onInput: () => {
        error.hidden = true;
        input.removeAttribute('aria-invalid');
      },
    });
    const done = (result) => {
      modal?.close();
      resolve(result);
    };
    async function save() {
      if (busy) return;
      busy = true;
      confirmButton.disabled = true;
      try {
        done(await submit(input.value));
      } catch (err) {
        error.textContent = err?.message ?? 'Something went wrong';
        error.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        input.select();
      } finally {
        busy = false;
        confirmButton.disabled = false;
      }
    }
    const confirmButton = h(
      'button',
      { type: 'button', class: 'btn btn-primary', testid: `${testid}-confirm`, onClick: save },
      confirmLabel,
    );
    modal = openModal({
      title,
      body: h('div', { class: 'name-field' }, input, error),
      actions: [
        h('button', { type: 'button', class: 'btn btn-ghost', testid: `${testid}-cancel`, onClick: () => done(null) }, 'Cancel'),
        confirmButton,
      ],
      testid,
      onRequestClose: () => done(null),
      onEnter: save,
      initialFocus: () => input,
    });
    input.select();
  });
}
