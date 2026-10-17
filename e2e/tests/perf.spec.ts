import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Performance with a big catalog (SPEC §3.3 "fast", T8): the omnibar and the Items filter must
// stay instant with 1,000+ items. The extra items are served to this page only, by answering
// GET /api/state and /api/version from a route handler (the real DB snapshot plus EXTRA items),
// so the e2e DB that every other test shares is never touched. The test only reads and filters.

const EXTRA = 1200;
const BUDGET_MS = 50; // per keystroke: input event -> new results rendered and laid out

const ADJECTIVES = [
  'Organic', 'Smoked', 'Frozen', 'Fresh', 'Dried', 'Roasted', 'Spicy', 'Sweet', 'Salted', 'Unsalted',
  'Whole', 'Sliced', 'Ground', 'Wild', 'Baby', 'Large', 'Mini', 'Golden', 'Red', 'Green',
  'Black', 'White', 'Toasted', 'Pickled', 'Canned', 'Raw', 'Aged', 'Light', 'Crispy', 'Creamy',
];
const NOUNS = [
  'Paprika', 'Almonds', 'Peppers', 'Beans', 'Lentils', 'Cashews', 'Olives', 'Mushrooms', 'Onions', 'Carrots',
  'Peas', 'Corn', 'Spinach', 'Kale', 'Basil', 'Oregano', 'Thyme', 'Rice', 'Oats', 'Quinoa',
  'Walnuts', 'Pecans', 'Raisins', 'Apricots', 'Figs', 'Dates', 'Cherries', 'Berries', 'Plums', 'Pears',
  'Crackers', 'Chips', 'Pretzels', 'Noodles', 'Dumplings', 'Tortillas', 'Bagels', 'Muffins', 'Waffles', 'Sausages',
];

type Snapshot = {
  version: number;
  categories: { id: number; name: string }[];
  items: object[];
};

/** Serves the real snapshot plus EXTRA generated items to `page` (only). */
async function bigCatalog(page: Page) {
  const real: Snapshot = await (await page.request.get('/api/state')).json();
  const extra = [];
  for (let i = 0; i < EXTRA; i++) {
    const adjective = ADJECTIVES[i % ADJECTIVES.length];
    const noun = NOUNS[Math.floor(i / ADJECTIVES.length) % NOUNS.length];
    extra.push({
      id: 1_000_000 + i,
      name: `${adjective} ${noun}`,
      category_id: i % 13 === 0 ? null : real.categories[i % real.categories.length].id,
      aliases: i % 6 === 0 ? [`${noun} ${i}`] : [],
      staple: i % 9 === 0,
      use_count: i % 7,
      last_used: i % 7 ? 1_760_000_000 + i : 0,
    });
  }
  const snapshot = { ...real, items: [...real.items, ...extra] };
  await page.route('**/api/state', (route) => route.fulfill({ json: snapshot }));
  await page.route('**/api/version', (route) => route.fulfill({ json: { version: snapshot.version } }));
  return snapshot.items.length;
}

/**
 * Types `text` into the field one character at a time (then deletes it again), timing each
 * keystroke from the input event until the page has re-rendered and laid out. Returns ms.
 */
function keystrokeTimes(page: Page, testid: string, text: string): Promise<number[]> {
  return page.evaluate(
    async ({ testid, text }) => {
      const input = document.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!;
      input.focus();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const times: number[] = [];
      const step = async (value: string) => {
        await frame();
        const start = performance.now();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        void document.body.getBoundingClientRect().height; // style + layout of the new rows
        times.push(performance.now() - start);
      };
      for (let i = 1; i <= text.length; i++) await step(text.slice(0, i));
      for (let i = text.length - 1; i >= 0; i--) await step(text.slice(0, i));
      return times;
    },
    { testid, text },
  );
}

function report(name: string, times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const max = sorted[sorted.length - 1];
  const description = `${name}: ${times.length} keystrokes, median ${median.toFixed(1)} ms, max ${max.toFixed(1)} ms`;
  test.info().annotations.push({ type: 'perf', description });
  console.log(`perf: ${description}`);
  return { median, max };
}

test.describe('1,000+ items', () => {
  test.skip(({ isMobile }) => isMobile, 'timing is measured once, on the desktop project');

  test('the List omnibar answers every keystroke within budget', async ({ page }) => {
    const total = await bigCatalog(page);
    expect(total).toBeGreaterThan(1000);
    await page.goto('/#/list');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'live');

    const times = await keystrokeTimes(page, 'list-search', 'smoked paprika');
    const { max } = report('omnibar', times);
    expect(max).toBeLessThan(BUDGET_MS);
    // It still finds the right thing.
    await page.getByTestId('list-search').fill('smoked papr');
    await expect(page.getByTestId('omnibar-option').first()).toContainText('Smoked Paprika');
    await page.getByTestId('list-search').fill('');
  });

  test('the Items filter answers every keystroke within budget', async ({ page }) => {
    const total = await bigCatalog(page);
    await page.goto('/#/items');
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'live');
    await expect(page.getByTestId('items-summary')).toHaveText(new RegExp(`^${total.toLocaleString('en-US')} items|^${total} items`));

    const times = await keystrokeTimes(page, 'items-search', 'roasted pecans');
    const { max } = report('items filter', times);
    expect(max).toBeLessThan(BUDGET_MS);
    await page.getByTestId('items-search').fill('roasted pec');
    await expect(page.getByTestId('item-name').first()).toHaveText('Roasted Pecans');

    // The blank filter renders the first 100 rows; "Show more" (Enter or click) adds 100 and
    // moves focus to the first new row.
    await page.getByTestId('items-search').fill('');
    await expect(page.getByTestId('item-row')).toHaveCount(100);
    const more = page.getByTestId('items-more');
    await expect(more).toHaveText(`Show 100 more (${total - 100} not shown)`);
    await more.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('item-row')).toHaveCount(200);
    await expect(page.getByTestId('item-row').nth(100)).toBeFocused();
    // Typing again starts from the first page.
    await page.getByTestId('items-search').fill('a');
    await page.getByTestId('items-search').fill('');
    await expect(page.getByTestId('item-row')).toHaveCount(100);
  });
});
