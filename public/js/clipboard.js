// Copy text to the clipboard with fallbacks (SPEC §3.6). The app is served over plain HTTP on
// the LAN, where phones have no `navigator.clipboard` (it needs a secure context), so:
//
//   1. navigator.clipboard.writeText()             secure contexts (localhost, desktop)
//   2. hidden <textarea> + document.execCommand('copy')   everywhere else
//   3. `manual(text)`: the caller shows the text pre-selected for a manual copy
//
// No await happens before step 2 when step 1 is unavailable, so the copy still runs inside the
// user's click/keypress (Safari only allows execCommand('copy') there).
//
//   const how = await copyText(text, { manual: openCopyDialog });  // 'clipboard'|'command'|'manual'

/**
 * Tries each strategy in turn. Pure (strategies are injected), so it is unit-tested.
 * @param {string} text
 * @param {object} strategies
 * @param {((text: string) => Promise<void>) | null} [strategies.clipboard]  async API, or null
 *   when unavailable
 * @param {((text: string) => boolean) | null} [strategies.command]  sync; false when it failed
 * @param {(text: string) => (void | Promise<void>)} strategies.manual
 * @returns {Promise<'clipboard'|'command'|'manual'>}
 */
export async function copyWithFallbacks(text, { clipboard, command, manual }) {
  if (clipboard) {
    try {
      await clipboard(text);
      return 'clipboard';
    } catch {
      // permission denied, document not focused, ...: try the next one
    }
  }
  if (command) {
    try {
      if (command(text)) return 'command';
    } catch {
      // execCommand can throw in some browsers: fall through
    }
  }
  await manual(text);
  return 'manual';
}

/** The async Clipboard API, or null when the page can't use it (insecure context, old browser). */
export function clipboardApi(win = globalThis) {
  const writeText = win.navigator?.clipboard?.writeText;
  if (!win.isSecureContext || typeof writeText !== 'function') return null;
  return (text) => win.navigator.clipboard.writeText(text);
}

/**
 * Copies via a temporary off-screen textarea and `document.execCommand('copy')`. Focus and the
 * text selection of the previously focused field are restored afterwards.
 * @param {Document} doc
 * @returns {((text: string) => boolean) | null}
 */
export function execCommandCopy(doc = globalThis.document) {
  if (!doc || typeof doc.execCommand !== 'function') return null;
  return (text) => {
    const active = doc.activeElement;
    let selection = null;
    try {
      if (active && typeof active.selectionStart === 'number') {
        selection = [active.selectionStart, active.selectionEnd, active.selectionDirection];
      }
    } catch {
      // input types without selection support
    }
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.tabIndex = -1;
    // 16px: no zoom-on-focus on iOS. Off-screen but rendered (display:none can't be selected).
    area.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;font-size:16px;';
    doc.body.append(area);
    try {
      area.focus({ preventScroll: true });
      area.select();
      area.setSelectionRange(0, text.length);
      return doc.execCommand('copy') === true;
    } finally {
      area.remove();
      if (active && typeof active.focus === 'function' && active !== doc.body) {
        active.focus({ preventScroll: true });
        if (selection) {
          try {
            active.setSelectionRange(...selection);
          } catch {
            // ignore
          }
        }
      }
    }
  };
}

/**
 * Copies `text` in the browser with every fallback.
 * @param {string} text
 * @param {{manual: (text: string) => (void | Promise<void>)}} options
 */
export function copyText(text, { manual }) {
  return copyWithFallbacks(text, { clipboard: clipboardApi(), command: execCommandCopy(), manual });
}
