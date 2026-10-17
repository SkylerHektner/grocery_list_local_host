// Inline SVG icons (24x24, stroked with currentColor). Built with DOM calls, no innerHTML.

const SVG = 'http://www.w3.org/2000/svg';

const PATHS = {
  search: ['M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13z', 'M15.5 15.5 20 20'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  alert: ['M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16z', 'M12 8v4.5', 'M12 15.8v.2'],
  plus: ['M12 5v14', 'M5 12h14'],
  list: ['M9 6.5h11', 'M9 12h11', 'M9 17.5h11', 'M4.5 6.5h.01', 'M4.5 12h.01', 'M4.5 17.5h.01'],
  book: [
    'M6.5 4H18v13H6.5A2.5 2.5 0 0 0 4 19.5V6.5A2.5 2.5 0 0 1 6.5 4z',
    'M4 19.5A2.5 2.5 0 0 0 6.5 22H18v-5',
    'M8.5 8.5h5',
  ],
  tag: [
    'M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1.5 1.5 0 0 1 0 2.1l-6.7 6.7a1.5 1.5 0 0 1-2.1 0z',
    'M8 8h.01',
  ],
  route: [
    'M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M18 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16',
  ],
  keyboard: [
    'M4 6.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 16V8A1.5 1.5 0 0 1 4 6.5z',
    'M6.5 10h.01', 'M10 10h.01', 'M13.5 10h.01', 'M17.5 10h.01', 'M8 14h8',
  ],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
};

/**
 * @param {keyof typeof PATHS} name
 * @param {{size?: number, label?: string}} [options]  `label` makes it a labelled image;
 *   otherwise the icon is decorative (aria-hidden).
 * @returns {SVGSVGElement}
 */
export function icon(name, { size = 20, label } = {}) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `icon icon-${name}`);
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const d of PATHS[name] ?? []) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
