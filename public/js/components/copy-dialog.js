// Last-resort copy (SPEC §3.6): the browser refused both clipboard routes, so show the text
// pre-selected in a textarea for a manual copy (Ctrl+C, or long-press -> Copy on a phone).

import { h } from '../dom.js';
import { openModal } from './dialog.js';

/**
 * @param {string} text
 * @returns {Promise<void>} resolves when the dialog closes
 */
export function openCopyDialog(text) {
  return new Promise((resolve) => {
    const area = h('textarea', {
      class: 'input copy-textarea',
      readonly: true,
      rows: String(Math.min(14, Math.max(4, text.split('\n').length))),
      'aria-label': 'List text',
      testid: 'copy-dialog-text',
      value: text,
      onFocus: () => area.select(),
    });
    let modal = null;
    const done = () => {
      modal?.close();
      resolve();
    };
    modal = openModal({
      title: 'Copy the list',
      body: [
        h(
          'p',
          { class: 'modal-message' },
          "This browser didn't allow copying automatically. The text is selected: press Ctrl+C, or on a phone tap and hold, then Copy.",
        ),
        area,
      ],
      actions: [h('button', { type: 'button', class: 'btn btn-primary', testid: 'copy-dialog-done', onClick: done }, 'Done')],
      testid: 'copy-dialog',
      closeButton: true,
      onRequestClose: done,
      initialFocus: () => area,
    });
    area.select();
    area.setSelectionRange(0, text.length);
  });
}
