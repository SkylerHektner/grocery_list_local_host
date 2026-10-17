// Shared empty-state art: a small sticky note (styled by .empty-art / .note-* in app.css).

const SVG = 'http://www.w3.org/2000/svg';

/** A small sticky-note illustration for empty states. */
export function noteArt() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'empty-art');
  svg.setAttribute('aria-hidden', 'true');
  const parts = [
    ['path', { class: 'note-paper', d: 'M12 10h40a2 2 0 0 1 2 2v28L40 54H12a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2z' }],
    ['path', { class: 'note-fold', d: 'M40 54V42a2 2 0 0 1 2-2h12' }],
    ['path', { class: 'note-line', d: 'M19 22h26M19 30h20M19 38h12' }],
  ];
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}
