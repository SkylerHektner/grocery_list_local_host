import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// List view & omnibar (SPEC §3.1, §3.2, §3.5, §3.6, §3.10). The DB is shared by every test of
// the run, so each test clears the list first and creates items with unique names.

type Snapshot = {
  version: number;
  categories: { id: number; name: string }[];
  items: { id: number; name: string; category_id: number | null; staple: boolean }[];
  recipes: { id: number; name: string; item_ids: number[] }[];
  list: { entries: { item_id: number; note: string | null }[]; recipe_ids: number[] };
};

async function state(request: APIRequestContext): Promise<Snapshot> {
  const res = await request.get('/api/state');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function resetList(request: APIRequestContext) {
  expect((await request.delete('/api/list')).ok()).toBeTruthy();
}

async function itemId(request: APIRequestContext, name: string) {
  const item = (await state(request)).items.find((i) => i.name === name);
  if (!item) throw new Error(`no item named ${name}`);
  return item.id;
}

async function addViaApi(request: APIRequestContext, name: string, note?: string) {
  const id = await itemId(request, name);
  const res = await request.post('/api/list/items', { data: note ? { item_id: id, note } : { item_id: id } });
  expect(res.ok()).toBeTruthy();
}

async function noteOf(request: APIRequestContext, name: string) {
  const id = await itemId(request, name);
  return (await state(request)).list.entries.find((e) => e.item_id === id)?.note;
}

/** A name no other item fuzzy-matches (random letters, so no typo/prefix overlap). */
function uniqueName() {
  let suffix = '';
  for (let i = 0; i < 9; i++) suffix += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  return `Zq${suffix}`;
}

async function open(page: Page, hash = '#/list') {
  await page.goto(`/${hash}`);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('view-list')).toBeVisible();
}

/** Focuses the omnibar (desktop autofocuses it; phones don't). */
async function omnibar(page: Page) {
  const input = page.getByTestId('list-search');
  await input.click();
  await expect(input).toBeFocused();
  return input;
}

const group = (page: Page, category: string) =>
  page.locator(`[data-testid="list-group"][data-category="${category}"]`);
const groupNames = (page: Page, category: string) => group(page, category).getByTestId('row-name');
const row = (page: Page, name: string) =>
  page.getByTestId('list-row').filter({ has: page.getByTestId('row-name').getByText(name, { exact: true }) });
const toast = (page: Page, text: string) => page.getByTestId('toast').filter({ hasText: text });

async function previewText(page: Page) {
  return page.getByTestId('export-preview').evaluate((el) => el.textContent);
}

test('rapid keyboard entry: four type+Enter in a row all land, grouped in walk order', async ({ page, request }) => {
  await resetList(request);
  await open(page);
  const input = await omnibar(page);

  for (const word of ['milk', 'eggs', 'bananas', 'parmesan']) {
    await page.keyboard.type(word);
    await page.keyboard.press('Enter');
  }
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();

  await expect(groupNames(page, 'Produce')).toHaveText(['Bananas']);
  await expect(groupNames(page, 'Deli & Cheese')).toHaveText(['Parmigiano Reggiano']);
  await expect(groupNames(page, 'Dairy & Eggs')).toHaveText(['Eggs', 'Milk']);
  const categories = await page
    .getByTestId('list-group')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.category));
  expect(categories).toEqual(['Produce', 'Deli & Cheese', 'Dairy & Eggs']);
  await expect(page.getByTestId('list-summary')).toHaveText('4 items');
  await expect.poll(async () => (await state(request)).list.entries.length).toBe(4);
  // Plain adds are quiet: no toasts.
  await expect(page.getByTestId('toast')).toHaveCount(0);

  // The dropdown marks items already on the list; re-adding one only says so.
  await page.keyboard.type('milk');
  await expect(page.getByTestId('omnibar-option').first().getByTestId('option-badge')).toHaveText('on list');
  await page.keyboard.press('Enter');
  await expect(toast(page, 'Milk is already on the list')).toBeVisible();
  await expect(page.getByTestId('list-row')).toHaveCount(4);
});

test('inline note syntax: "eggs, 2 dozen" adds Eggs with the note', async ({ page, request }) => {
  await resetList(request);
  await open(page);
  await omnibar(page);

  await page.keyboard.type('eggs, 2 dozen');
  await expect(page.getByTestId('omnibar-note-text')).toHaveText('2 dozen');
  await expect(page.getByTestId('omnibar-option').first()).toContainText('Eggs');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Eggs').getByTestId('row-note')).toHaveText('2 dozen');
  await expect.poll(() => noteOf(request, 'Eggs')).toBe('2 dozen');

  // Re-adding with another note updates it.
  await page.keyboard.type('eggs,1 dozen');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Eggs').getByTestId('row-note')).toHaveText('1 dozen');
  await expect(toast(page, 'Note updated')).toBeVisible();
});

test('fuzzy: a typo picks the right item; the highlight resets as the query changes', async ({ page, request }) => {
  await resetList(request);
  await open(page);
  const input = await omnibar(page);

  await page.keyboard.type('tac');
  const options = page.locator('[data-testid="list-results"] [role="option"]');
  await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await expect(options.first()).toContainText('Tacos');
  await expect(options.first()).toContainText('Recipe');
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute('aria-activedescendant', (await options.nth(1).getAttribute('id'))!);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp'); // clamped at the top
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('o'); // "taco": highlight back on the top result
  await expect(options.first()).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.type('parmesian');
  const first = page.getByTestId('omnibar-option').first();
  await expect(first).toContainText('Parmigiano Reggiano');
  await expect(first.locator('.option-alias')).toContainText('Parmesan');
  await expect(first).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(groupNames(page, 'Deli & Cheese')).toHaveText(['Parmigiano Reggiano']);
});

test('create a new item by keyboard: create row, Shift+Enter, digits, Tab and filtering', async ({
  page,
  request,
}) => {
  await resetList(request);
  await open(page);
  const input = await omnibar(page);
  const name = uniqueName();

  // No fuzzy matches: the create row is highlighted, so Enter starts creation.
  await page.keyboard.type(`${name}, blue`);
  await expect(page.getByTestId('omnibar-option')).toHaveCount(0);
  await expect(page.getByTestId('omnibar-create-item')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('omnibar-create-recipe')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('omnibar-picker-name')).toHaveText(name);

  // Esc goes back to the search with the text intact; Shift+Enter opens the picker again.
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue(`${name}, blue`);
  await page.keyboard.press('Shift+Enter');
  const second = page.locator('[data-testid="category-option"][data-number="2"]');
  const category = (await second.locator('.option-label').textContent())!.trim();
  await page.keyboard.press('2');

  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(group(page, category).getByTestId('row-name')).toHaveText([name]);
  await expect(row(page, name).getByTestId('row-note')).toHaveText('blue');
  const snapshot = await state(request);
  const created = snapshot.items.find((i) => i.name === name)!;
  expect(snapshot.categories.find((c) => c.id === created.category_id)?.name).toBe(category);

  // Tab = Uncategorized.
  const loose = uniqueName();
  await page.keyboard.type(loose);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.press('Tab');
  await expect(groupNames(page, 'Uncategorized')).toContainText([loose]);

  // Typing filters the categories (digits only pick while the filter is empty).
  const dairy = uniqueName();
  await page.keyboard.type(dairy);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('dairy');
  await expect(page.getByTestId('category-option').first()).toContainText('Dairy & Eggs');
  await page.keyboard.press('Enter');
  await expect(groupNames(page, 'Dairy & Eggs')).toHaveText([dairy]);
  await expect(input).toBeFocused();
});

test('create a new item by tap (mobile)', async ({ page, request, isMobile }) => {
  test.skip(!isMobile, 'touch flow');
  await resetList(request);
  await open(page);
  const name = uniqueName();

  await page.getByTestId('list-search').tap();
  await page.keyboard.type(name);
  await page.getByTestId('omnibar-create-item').tap();
  await expect(page.getByTestId('omnibar-picker-title')).toBeVisible();
  const option = page.getByTestId('category-option').nth(2);
  expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const category = (await option.locator('.option-label').textContent())!.trim();
  await option.tap();

  await expect(group(page, category).getByTestId('row-name')).toHaveText([name]);
  await expect(page.getByTestId('list-search')).toHaveValue('');
  // Tap targets on the row and no horizontal scroll with content on the list.
  for (const id of ['remove-entry', 'edit-note']) {
    const box = (await row(page, name).getByTestId(id).boundingBox())!;
    expect(box.height, id).toBeGreaterThanOrEqual(44);
    expect(box.width, id).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Remove by tap: the always-visible ×.
  await row(page, name).getByTestId('remove-entry').tap();
  await expect(page.getByTestId('list-empty')).toBeVisible();
});

test('keyboard culling: ↓ into the list, Delete twice, Ctrl+Z restores one', async ({ page, request }) => {
  await resetList(request);
  for (const name of ['Bananas', 'Eggs', 'Milk']) await addViaApi(request, name);
  await open(page);
  const input = await omnibar(page);
  const rows = page.getByTestId('list-row');

  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Bananas')).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(row(page, 'Eggs')).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('row-name')).toHaveText(['Milk']);
  await expect(row(page, 'Milk')).toBeFocused();
  await expect(toast(page, 'Removed Eggs')).toBeVisible();
  await expect.poll(async () => (await state(request)).list.entries.length).toBe(1);

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('row-name')).toHaveText(['Eggs', 'Milk']);
  await expect(row(page, 'Milk')).toBeFocused();
  await expect.poll(async () => (await state(request)).list.entries.length).toBe(2);

  // The Undo button in the other removal toast restores the one before.
  await toast(page, 'Removed Bananas').getByTestId('toast-action').click();
  await expect(page.getByTestId('row-name')).toHaveText(['Bananas', 'Eggs', 'Milk']);

  // j/k move, x removes; ↑ on the first row and Esc go back to the search.
  await row(page, 'Milk').focus();
  await page.keyboard.press('k');
  await expect(row(page, 'Eggs')).toBeFocused();
  await page.keyboard.press('x');
  await expect(rows).toHaveCount(2);
  await expect(row(page, 'Milk')).toBeFocused();
  await page.keyboard.press('k');
  await expect(row(page, 'Bananas')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(input).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('j');
  await expect(row(page, 'Milk')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(input).toBeFocused();
});

test('items are a grid of tiles: ↑/↓ follow the columns, ←/→ go in reading order', async ({ page, request }) => {
  await resetList(request);
  const produce = ['Avocados', 'Bananas', 'Bell peppers', 'Broccoli', 'Carrots', 'Cilantro', 'Garlic'];
  for (const name of [...produce, 'Milk']) await addViaApi(request, name);
  await open(page);
  const input = await omnibar(page);
  const box = async (name: string) => (await row(page, name).boundingBox())!;
  const focusedName = () =>
    page.evaluate(() => document.activeElement?.querySelector('[data-testid="row-name"]')?.textContent ?? null);

  // Desktop: several tiles share a line; a phone: one column. Either way ↓ lands on the tile on
  // the next line that is closest to the column it came from.
  const [first, second] = [await box('Avocados'), await box('Bananas')];
  const columns = Math.abs(first.y - second.y) < 2 ? 2 : 1;
  if (page.viewportSize()!.width > 700) expect(columns).toBe(2);

  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Avocados')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const below = (await focusedName())!;
  const belowBox = await box(below);
  expect(belowBox.y).toBeGreaterThan(first.y + 2);
  expect(Math.abs(belowBox.x - first.x)).toBeLessThan(2);
  if (columns === 1) expect(below).toBe('Bananas');
  else expect(below).not.toBe('Bananas');

  // → / ← (and j / k) step through tiles in reading order.
  await page.keyboard.press('ArrowLeft');
  await expect.poll(focusedName).toBe(produce[produce.indexOf(below) - 1]);
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(row(page, 'Bananas')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft'); // clamped at the first tile
  await expect(row(page, 'Avocados')).toBeFocused();

  // ↓ from the last line of Produce goes into Dairy & Eggs; ↑ from the top line: the search.
  await row(page, 'Garlic').focus();
  await page.keyboard.press('ArrowDown');
  await expect(row(page, 'Milk')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => produce.includes((await focusedName()) ?? '')).toBe(true);
  await row(page, 'Bananas').focus();
  if (columns === 2) {
    await page.keyboard.press('ArrowUp');
    await expect(input).toBeFocused();
  }

  // A tile with its note editor open takes the whole line.
  await row(page, 'Bananas').focus();
  await page.keyboard.press('Enter');
  const editing = await box('Bananas');
  const body = (await page.getByTestId('list-body').boundingBox())!;
  expect(editing.width).toBeGreaterThan(body.width * 0.9);
  await page.keyboard.press('Escape');
});

test('note editing by keyboard: Enter saves, Esc cancels, empty clears',async ({ page, request }) => {
  await resetList(request);
  await addViaApi(request, 'Milk');
  await open(page);
  await omnibar(page);
  const milk = row(page, 'Milk');
  const note = page.getByTestId('note-input');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(note).toBeFocused();
  await page.keyboard.type('2 gallons');
  await page.keyboard.press('Enter');
  await expect(milk.getByTestId('row-note')).toHaveText('2 gallons');
  await expect(milk).toBeFocused();
  await expect.poll(() => noteOf(request, 'Milk')).toBe('2 gallons');

  // `n` edits too (text selected); Esc cancels.
  await page.keyboard.press('n');
  await expect(note).toHaveValue('2 gallons');
  await page.keyboard.type('whole');
  await page.keyboard.press('Escape');
  await expect(note).toHaveCount(0);
  await expect(milk.getByTestId('row-note')).toHaveText('2 gallons');
  await expect(milk).toBeFocused();

  // An empty note clears it.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(milk.getByTestId('row-note')).toHaveCount(0);
  await expect.poll(() => noteOf(request, 'Milk')).toBeNull();
});

test('removing a recipe chip keeps manually added items; Undo brings it back', async ({ page, request }) => {
  await resetList(request);
  await addViaApi(request, 'Milk');
  const recipe = (await state(request)).recipes.find((r) => r.name === 'Weekly Staples')!;
  const res = await request.post('/api/list/recipes', { data: { recipe_id: recipe.id, item_ids: recipe.item_ids } });
  expect(res.ok()).toBeTruthy();
  await open(page);

  const chip = page.getByTestId('recipe-chip').filter({ hasText: 'Weekly Staples' });
  await expect(chip).toBeVisible();
  await expect(page.getByTestId('list-row')).toHaveCount(recipe.item_ids.length);
  await expect(row(page, 'Milk').getByTestId('row-source')).toHaveText(['Weekly Staples']);
  await expect(page.getByTestId('list-summary')).toHaveText(`${recipe.item_ids.length} items · 1 recipe`);

  await chip.getByTestId('recipe-chip-remove').click();
  await expect(page.getByTestId('recipe-chip')).toHaveCount(0);
  await expect(page.getByTestId('row-name')).toHaveText(['Milk']);
  await expect(row(page, 'Milk').getByTestId('row-source')).toHaveCount(0);
  const removed = toast(page, `Removed Weekly Staples and ${recipe.item_ids.length - 1} items`);
  await expect(removed).toBeVisible();

  await removed.getByTestId('toast-action').click();
  await expect(chip).toBeVisible();
  await expect(page.getByTestId('list-row')).toHaveCount(recipe.item_ids.length);
});

test('clear list asks first; cancel keeps it, confirm empties it (with Undo)', async ({ page, request }) => {
  await resetList(request);
  await addViaApi(request, 'Milk');
  await addViaApi(request, 'Eggs');
  await open(page);

  await page.getByTestId('clear-list').click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText('Clear the list?');
  await expect(page.getByTestId('confirm-dialog-message')).toContainText('2 items');
  await page.getByTestId('confirm-dialog-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('list-row')).toHaveCount(2);

  await page.getByTestId('clear-list').click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByTestId('list-empty')).toBeVisible();
  await expect(page.getByTestId('list-empty')).toContainText('Your list is empty');
  await expect(page.getByTestId('clear-list')).toBeDisabled();
  await expect.poll(() => previewText(page)).toBe('');
  await expect.poll(async () => (await state(request)).list.entries.length).toBe(0);

  await toast(page, 'Cleared the list').getByTestId('toast-action').click();
  await expect(page.getByTestId('list-row')).toHaveCount(2);
});

const EXPECTED_EXPORT = 'PRODUCE\nBananas\n\nDAIRY & EGGS\nEggs (2 dozen)\nMilk\n\nOTHER\nBirthday candles';

async function addExportFixture(request: APIRequestContext) {
  await resetList(request);
  await addViaApi(request, 'Milk');
  await addViaApi(request, 'Eggs', '2 dozen');
  await addViaApi(request, 'Bananas');
  await addViaApi(request, 'Birthday candles');
  expect(await (await request.get('/api/list/export')).text()).toBe(EXPECTED_EXPORT);
}

test('copy puts the exact export text on the clipboard (button and Ctrl+Shift+C)', async ({
  page,
  context,
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'Clipboard API path; the mobile fallback has its own test');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await addExportFixture(request);
  await open(page);
  await expect.poll(() => previewText(page)).toBe(EXPECTED_EXPORT);

  // The system clipboard on Windows stores line breaks as \r\n.
  const clipboard = async () =>
    (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');

  await page.getByTestId('copy-list').click();
  await expect(toast(page, 'Copied 4 items')).toBeVisible();
  expect(await clipboard()).toBe(EXPECTED_EXPORT);

  // Ctrl+Shift+C works from the omnibar mid-typing and leaves the typing alone.
  await page.evaluate(() => navigator.clipboard.writeText('stale'));
  const input = await omnibar(page);
  await page.keyboard.type('mil');
  await page.keyboard.press('Control+Shift+C');
  await expect.poll(clipboard).toBe(EXPECTED_EXPORT);
  await expect(input).toHaveValue('mil');
  await expect(input).toBeFocused();
});

test('copy without the Clipboard API (plain-HTTP phone): fallbacks work, preview is exact', async ({ page, request }) => {
  // What a phone sees over plain HTTP on the LAN: no navigator.clipboard.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true });
  });
  await addExportFixture(request);
  await open(page);

  const toggle = page.getByTestId('export-toggle');
  if (await toggle.isVisible()) {
    await expect(page.getByTestId('export-preview')).toBeHidden(); // collapsed on narrow screens
    await toggle.click();
  }
  await expect(page.getByTestId('export-preview')).toBeVisible();
  await expect.poll(() => previewText(page)).toBe(EXPECTED_EXPORT);

  // execCommand('copy'), or the manual dialog if the browser refuses: never an error.
  await page.getByTestId('copy-list').click();
  const dialog = page.getByTestId('copy-dialog');
  await expect(toast(page, 'Copied 4 items').or(dialog)).toBeVisible();
  if (await dialog.isVisible()) await page.getByTestId('copy-dialog-done').click();

  // Last resort: the text pre-selected in a dialog.
  await page.evaluate(() => {
    document.execCommand = () => false;
  });
  await page.getByTestId('copy-list').click();
  await expect(dialog).toBeVisible();
  const area = page.getByTestId('copy-dialog-text');
  await expect(area).toHaveValue(EXPECTED_EXPORT);
  await expect(area).toBeFocused();
  const selected = await area.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]);
  expect(selected).toEqual([0, EXPECTED_EXPORT.length]);
  await page.getByTestId('copy-dialog-done').click();
  await expect(dialog).toHaveCount(0);
});

test('live sync: a change from another page arrives without clobbering typing or a note edit', async ({
  page,
  context,
  request,
}) => {
  await resetList(request);
  await open(page);
  const other = await context.newPage();
  await open(other);

  // This page is mid-typing with the dropdown open.
  const input = await omnibar(page);
  await page.keyboard.type('bana');
  await expect(page.getByTestId('omnibar-option').first()).toHaveAttribute('aria-selected', 'true');

  await omnibar(other);
  await other.keyboard.type('milk');
  await other.keyboard.press('Enter');
  await expect(other.getByTestId('row-name')).toHaveText(['Milk']);

  await expect(page.getByTestId('row-name')).toHaveText(['Milk'], { timeout: 8000 });
  await expect(input).toHaveValue('bana');
  await expect(input).toBeFocused();
  await expect(page.getByTestId('list-popup')).toBeVisible();
  await expect(page.getByTestId('omnibar-option').first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('row-name')).toHaveText(['Bananas', 'Milk']);
  await expect(other.getByTestId('row-name')).toHaveText(['Bananas', 'Milk'], { timeout: 8000 });

  // A half-typed note survives an update from the other page too.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const note = page.getByTestId('note-input');
  await page.keyboard.type('ripe');
  await other.keyboard.type('eggs');
  await other.keyboard.press('Enter');
  await expect(page.getByTestId('row-name')).toHaveText(['Bananas', 'Eggs', 'Milk'], { timeout: 8000 });
  await expect(note).toBeFocused();
  await expect(note).toHaveValue('ripe');
  await page.keyboard.press('Enter');
  await expect(row(page, 'Bananas').getByTestId('row-note')).toHaveText('ripe');
  await other.close();
});
