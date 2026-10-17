import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Store order (SPEC §3.9): reorder by keyboard (Alt+↑/↓) and by the row buttons, add, rename,
// delete. The DB is shared by every test of the run (and other specs rely on the demo walk
// order), so tests that move demo categories put the order back in a `finally`, and the others
// work on categories they create and delete again.

type Snapshot = {
  categories: { id: number; name: string }[];
  items: { id: number; name: string; category_id: number | null }[];
};

async function state(request: APIRequestContext): Promise<Snapshot> {
  const res = await request.get('/api/state');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

const order = async (request: APIRequestContext) => (await state(request)).categories.map((c) => c.name);

async function exportText(request: APIRequestContext) {
  const res = await request.get('/api/list/export');
  expect(res.ok()).toBeTruthy();
  return res.text();
}

async function resetList(request: APIRequestContext) {
  expect((await request.delete('/api/list')).ok()).toBeTruthy();
}

async function addToList(request: APIRequestContext, name: string) {
  const item = (await state(request)).items.find((i) => i.name === name);
  if (!item) throw new Error(`no item named ${name}`);
  expect((await request.post('/api/list/items', { data: { item_id: item.id } })).ok()).toBeTruthy();
}

async function createCategory(request: APIRequestContext, name: string) {
  const res = await request.post('/api/categories', { data: { name } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as number;
}

async function deleteCategory(request: APIRequestContext, id: number) {
  await request.delete(`/api/categories/${id}`); // may already be gone
}

async function createItem(request: APIRequestContext, name: string, categoryId: number | null) {
  const res = await request.post('/api/items', { data: { name, category_id: categoryId } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as number;
}

/** A name nothing else matches (random letters). */
function uniqueName() {
  let suffix = '';
  for (let i = 0; i < 9; i++) suffix += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  return `Zq${suffix}`;
}

async function open(page: Page, hash = '#/categories') {
  await page.goto(`/${hash}`);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'live');
}

const row = (page: Page, name: string) =>
  page.getByTestId('category-row').filter({ has: page.getByTestId('category-name').getByText(name, { exact: true }) });
const names = (page: Page) => page.getByTestId('category-name');
const toast = (page: Page, text: string) => page.getByTestId('toast').filter({ hasText: text });
const press = (locator: Locator, isMobile: boolean) => (isMobile ? locator.tap() : locator.click());

test('Alt+↓ moves a category down the walk and the export follows; Alt+↑ moves it back', async ({
  page,
  request,
  isMobile,
}) => {
  test.skip(isMobile, 'keyboard flow (phones: the row buttons, below)');
  const original = (await state(request)).categories.map((c) => c.id);
  const [first, second] = await order(request);
  expect([first, second]).toEqual(['Produce', 'Bakery']);
  try {
    await resetList(request);
    await addToList(request, 'Bananas');
    await addToList(request, 'Sourdough bread');
    expect(await exportText(request)).toBe('PRODUCE\nBananas\n\nBAKERY\nSourdough bread');

    await open(page);
    const produce = row(page, 'Produce');
    await expect(produce).toBeFocused(); // keyboards start on the first stop
    await page.keyboard.press('Alt+ArrowDown');
    await expect(names(page).nth(0)).toHaveText('Bakery');
    await expect(names(page).nth(1)).toHaveText('Produce');
    await expect(produce).toBeFocused(); // focus follows the moved row
    await expect(produce.getByTestId('category-position')).toHaveText('2');
    await expect.poll(() => exportText(request)).toBe('BAKERY\nSourdough bread\n\nPRODUCE\nBananas');

    // Held down: rapid moves land in order, without racing.
    for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowDown');
    await expect(produce.getByTestId('category-position')).toHaveText('5');
    await expect.poll(async () => (await order(request)).indexOf('Produce')).toBe(4);
    await expect(produce).toBeFocused();

    // ↑/↓ only move focus; Alt+↑ moves the category back to the top.
    await page.keyboard.press('ArrowUp');
    await expect(row(page, (await order(request))[3])).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(produce).toBeFocused();
    for (let i = 0; i < 5; i++) await page.keyboard.press('Alt+ArrowUp'); // one more than needed
    await expect(names(page).first()).toHaveText('Produce');
    await expect.poll(async () => (await state(request)).categories.map((c) => c.id)).toEqual(original);
    expect(await exportText(request)).toBe('PRODUCE\nBananas\n\nBAKERY\nSourdough bread');
  } finally {
    await request.put('/api/categories/order', { data: { ids: original } });
  }
});

test('the ↑/↓ buttons on each row reorder (tap on phones)', async ({ page, request, isMobile }) => {
  const x = uniqueName();
  const y = uniqueName();
  const xId = await createCategory(request, x);
  const yId = await createCategory(request, y);
  try {
    await open(page);
    const xRow = row(page, x);
    const yRow = row(page, y);
    await expect(yRow.getByTestId('category-down')).toHaveAttribute('aria-disabled', 'true'); // last stop
    if (isMobile) {
      for (const button of ['category-up', 'category-down', 'category-delete']) {
        const box = (await yRow.getByTestId(button).boundingBox())!;
        expect(box.width, button).toBeGreaterThanOrEqual(44);
        expect(box.height, button).toBeGreaterThanOrEqual(44);
      }
    }

    await press(yRow.getByTestId('category-up'), isMobile);
    await expect(names(page).nth(-2)).toHaveText(y);
    await expect(names(page).nth(-1)).toHaveText(x);
    await expect.poll(async () => (await order(request)).slice(-2)).toEqual([y, x]);
    await expect(xRow.getByTestId('category-down')).toHaveAttribute('aria-disabled', 'true');

    await press(yRow.getByTestId('category-down'), isMobile);
    await expect.poll(async () => (await order(request)).slice(-2)).toEqual([x, y]);
    await expect(names(page).nth(-1)).toHaveText(y);
  } finally {
    await deleteCategory(request, xId);
    await deleteCategory(request, yId);
  }
});

test('delete a category: the confirm counts its items, which then show as Uncategorized', async ({
  page,
  request,
  isMobile,
}) => {
  const name = uniqueName();
  const id = await createCategory(request, name);
  const item = uniqueName();
  const itemId = await createItem(request, item, id);
  await open(page);
  const target = row(page, name);
  await expect(target.getByTestId('category-count')).toHaveText('1 item');

  if (isMobile) {
    await target.getByTestId('category-delete').tap();
  } else {
    await target.focus();
    await page.keyboard.press('Delete');
  }
  await expect(page.getByTestId('confirm-dialog-message')).toHaveText(
    "Its 1 item becomes Uncategorized (last on the list) until you pick a new category for it. This can't be undone.",
  );
  if (isMobile) await page.getByTestId('confirm-dialog-confirm').tap();
  else await page.keyboard.press('Enter');
  await expect(toast(page, `Deleted ${name}; 1 item now uncategorized`)).toBeVisible();
  await expect(target).toHaveCount(0);
  const s = await state(request);
  expect(s.categories.some((c) => c.id === id)).toBe(false);
  expect(s.items.find((i) => i.id === itemId)?.category_id).toBeNull();

  // "Review" opens the Items view filtered to the uncategorized items.
  await expect(page.getByTestId('uncategorized-count')).toContainText('item');
  await press(page.getByTestId('review-uncategorized'), isMobile);
  await expect(page).toHaveURL(/#\/items\/uncategorized$/);
  await expect(page.getByTestId('filter-uncategorized')).toHaveAttribute('aria-pressed', 'true');
  const itemRow = page.getByTestId('item-row').filter({ hasText: item });
  await expect(itemRow).toHaveClass(/is-uncategorized/);
  await expect(itemRow.getByTestId('item-category')).toHaveText('Uncategorized');
});

test('add (n) and rename (F2) a category; the export header follows; a duplicate shows inline', async ({
  page,
  request,
  isMobile,
  consoleErrors,
}) => {
  await resetList(request);
  const name = uniqueName();
  let id: number | null = null;
  try {
    await open(page);
    if (isMobile) await page.getByTestId('new-category').tap();
    else await page.keyboard.press('n');
    const add = page.getByTestId('new-category-dialog-input');
    await expect(add).toBeFocused();
    await add.fill(name.toLowerCase());
    if (isMobile) await page.getByTestId('new-category-dialog-confirm').tap();
    else await page.keyboard.press('Enter');
    const added = row(page, name);
    await expect(names(page).last()).toHaveText(name); // appended at the end of the walk
    if (!isMobile) await expect(added).toBeFocused();
    id = (await state(request)).categories.find((c) => c.name === name)!.id;

    const item = uniqueName();
    await createItem(request, item, id);
    await addToList(request, item);
    expect(await exportText(request)).toBe(`${name.toUpperCase()}\n${item}`);

    // Rename: F2 on the row (phones: tap it).
    if (isMobile) await added.getByTestId('category-name').tap();
    else await page.keyboard.press('F2');
    const input = page.getByTestId('rename-category-dialog-input');
    await expect(input).toHaveValue(name);
    await input.fill('Produce');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('rename-category-dialog-error')).toHaveText('a category named "Produce" already exists');
    await expect.poll(() => consoleErrors.length).toBeGreaterThan(0);
    consoleErrors.length = 0; // the expected 409

    const renamed = uniqueName();
    await input.fill(renamed);
    if (isMobile) await page.getByTestId('rename-category-dialog-confirm').tap();
    else await page.keyboard.press('Enter');
    await expect(page.getByTestId('rename-category-dialog')).toHaveCount(0);
    await expect(row(page, renamed)).toBeVisible();
    if (!isMobile) await expect(row(page, renamed)).toBeFocused();
    await expect.poll(() => exportText(request)).toBe(`${renamed.toUpperCase()}\n${item}`);
  } finally {
    if (id !== null) await deleteCategory(request, id);
  }
});
