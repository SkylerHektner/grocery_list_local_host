// The on-screen keyboard (phones). When it opens, the *visual* viewport shrinks, but the layout
// viewport (what `position: fixed`, `vh` and, on iOS, `dvh` refer to) does not, so a bottom
// sheet or a dropdown would end up behind the keyboard. trackVisualViewport() mirrors the
// visual viewport into CSS custom properties on <html>:
//
//   --vv-top     px from the top of the layout viewport to the top of the visible area
//   --vv-height  px of page that is actually visible (above the keyboard)
//   --kb-inset   px of the layout viewport covered at the bottom (the keyboard), else 0
//
// css/app.css sizes bottom sheets with them (they fall back to 100dvh without a visualViewport),
// and roomBelow() caps dropdowns (the omnibar's) to the space above the keyboard. Pure parts
// (viewportVars, roomBelow) are unit-tested in viewport.test.js.

/**
 * @param {number} innerHeight  window.innerHeight (the layout viewport)
 * @param {{height: number, offsetTop: number} | null | undefined} vv  window.visualViewport
 * @returns {Record<string, string>}  CSS custom properties to set on <html>
 */
export function viewportVars(innerHeight, vv) {
  if (!vv) return { '--vv-top': '0px', '--vv-height': `${Math.round(innerHeight)}px`, '--kb-inset': '0px' };
  const top = Math.max(0, vv.offsetTop);
  const height = Math.max(0, Math.min(vv.height, innerHeight));
  const inset = Math.max(0, innerHeight - height - top);
  return {
    '--vv-top': `${Math.round(top)}px`,
    '--vv-height': `${Math.round(height)}px`,
    '--kb-inset': `${Math.round(inset)}px`,
  };
}

/**
 * Pixels available below `top` (a client y coordinate) down to the bottom of the visible area,
 * minus `margin`; at least `min`.
 * @param {number} top
 * @param {{innerHeight: number, visualViewport?: {height: number, offsetTop: number} | null}} win
 * @param {{margin?: number, min?: number}} [options]
 */
export function roomBelow(top, win, { margin = 8, min = 140 } = {}) {
  const vv = win.visualViewport;
  const bottom = vv ? vv.offsetTop + vv.height : win.innerHeight;
  return Math.max(min, Math.floor(bottom - top - margin));
}

/**
 * Keeps the CSS custom properties above in sync with `win.visualViewport`. Returns a function
 * that stops tracking.
 * @param {Window} win
 */
export function trackVisualViewport(win) {
  const root = win.document.documentElement;
  let frame = 0;
  const apply = () => {
    frame = 0;
    for (const [name, value] of Object.entries(viewportVars(win.innerHeight, win.visualViewport))) {
      root.style.setProperty(name, value);
    }
  };
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(apply);
  };
  apply();
  const vv = win.visualViewport;
  vv?.addEventListener('resize', schedule);
  vv?.addEventListener('scroll', schedule);
  win.addEventListener('resize', schedule);
  return () => {
    vv?.removeEventListener('resize', schedule);
    vv?.removeEventListener('scroll', schedule);
    win.removeEventListener('resize', schedule);
  };
}
