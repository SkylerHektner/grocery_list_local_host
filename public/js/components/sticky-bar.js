// A bar that sticks to the top of the page while scrolling (the omnibar, the recipe filter). At
// rest it sits on the page's paper texture; once stuck it gets a solid background and a hairline
// (`.is-stuck`, toggled by an IntersectionObserver on a zero-height sentinel placed above it).
//
//   const { sentinel, bar } = stickyBar(ctx, { testid: 'list-bar' }, omnibar.el);
//   container.append(header, sentinel, bar, card);

import { h } from '../dom.js';

/**
 * @param {{onCleanup: (fn: () => void) => void}} ctx  disconnects the observer on unmount
 * @param {{testid?: string}} attrs
 * @param {...Node} children
 * @returns {{sentinel: HTMLElement, bar: HTMLElement}}
 */
export function stickyBar(ctx, { testid } = {}, ...children) {
  const bar = h('div', { class: 'sticky-bar list-bar', testid }, ...children);
  const sentinel = h('div', { class: 'list-bar-sentinel', 'aria-hidden': 'true' });
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(([entry]) => {
      bar.classList.toggle('is-stuck', !entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(sentinel);
    ctx.onCleanup(() => observer.disconnect());
  }
  return { sentinel, bar };
}
