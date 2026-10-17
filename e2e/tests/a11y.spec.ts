import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Accessibility & resilience (T8): every view by keyboard alone without focus ever falling back
// to <body>, ARIA roles/names on the widgets, and the Offline state while the server is down.
// The DB is shared by every test of the run: the walk uses its own recipe, item and category.

type Snapshot = {
  items: { id: number; name: string }[];
  categories: { id: number; name: string }[];
};

async function state(request: APIRequestContext): Promise<Snapshot> {
  const res = await request.get('/api/state');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function itemId(request: APIRequestContext, name: string) {
  const item = (await state(request)).items.find((i) => i.name === name);
  if (!item) throw new Error(`no item named ${name}`);
  return item.id;
}

/** A name nothing else fuzzy-matches (random letters). */
function uniqueName() {
  let suffix = '';
  for (let i = 0; i < 9; i++) suffix += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  return `Zq${suffix}`;
}

async function open(page: Page, hash: string) {
  await page.goto(`/${hash}`);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'live');
}

/** What has focus: "body", or the element's data-testid / id / tag. */
function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return 'body';
    return (el as HTMLElement).dataset.testid || el.id || el.tagName.toLowerCase();
  });
}

/** Presses `key` and checks that focus is (still, or soon again) somewhere other than <body>. */
async function press(page: Page, key: string) {
  await page.keyboard.press(key);
  await expect.poll(() => focused(page), { message: `focus after ${key}` }).not.toBe('body');
}

async function type(page: Page, text: string) {
  await page.keyboard.type(text);
}

const toast = (page: Page, text: string) => page.getByTestId('toast').filter({ hasText: text });

test.describe('keyboard only', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard flows: desktop project');

  test('every view by keyboard; focus never drops to <body>', async ({ page, request }) => {
    expect((await request.delete('/api/list')).ok()).toBeTruthy();
    const recipe = `${uniqueName()} walk`;
    const ingredients = [await itemId(request, 'Milk'), await itemId(request, 'Eggs')];
    expect((await request.post('/api/recipes', { data: { name: recipe, ingredients: ingredients.map((item_id) => ({ item_id })) } })).ok()).toBeTruthy();
    const item = `${uniqueName()} walk item`;
    expect((await request.post('/api/items', { data: { name: item } })).ok()).toBeTruthy();
    const category = `${uniqueName()} aisle`;

    // ── List ──
    await open(page, '#/list');
    await expect(page.getByTestId('list-search')).toBeFocused();
    for (const word of ['milk', 'bananas']) {
      await type(page, word);
      await press(page, 'Enter');
    }
    await expect(page.getByTestId('list-row')).toHaveCount(2);
    await press(page, 'ArrowDown'); // into the list: Bananas (Produce) first
    await expect.poll(() => focused(page)).toBe('list-row');
    await press(page, 'n'); // note editor
    await expect.poll(() => focused(page)).toBe('note-input');
    await type(page, 'ripe');
    await press(page, 'Enter');
    await expect.poll(() => focused(page)).toBe('list-row');
    await press(page, 'Delete'); // Bananas: focus moves to Milk
    await expect(page.getByTestId('list-row')).toHaveCount(1);
    await expect.poll(() => focused(page)).toBe('list-row');
    await press(page, 'Delete'); // the last one: back to the search box
    await expect(page.getByTestId('list-row')).toHaveCount(0);
    await expect.poll(() => focused(page)).toBe('list-search');
    await press(page, 'Escape'); // empty search: leave it, focus stays in the view
    await expect.poll(() => focused(page)).toBe('view-root');
    await press(page, 'Control+z'); // Milk comes back
    await expect(page.getByTestId('list-row')).toHaveCount(1);
    await press(page, '?');
    await expect(page.getByTestId('shortcuts-overlay')).toBeVisible();
    await press(page, 'Escape');
    await expect(page.getByTestId('shortcuts-overlay')).toHaveCount(0);
    await press(page, '/');
    await expect.poll(() => focused(page)).toBe('list-search');

    // The combobox: aria-activedescendant names the highlighted option.
    const search = page.getByTestId('list-search');
    await type(page, recipe.slice(0, 7));
    await expect(search).toHaveAttribute('aria-expanded', 'true');
    const active = async () => {
      const id = await search.getAttribute('aria-activedescendant');
      return id ? page.locator(`[id="${id}"]`) : null;
    };
    await expect((await active())!).toHaveAttribute('aria-selected', 'true');
    await expect((await active())!).toHaveAttribute('role', 'option');
    await expect((await active())!).toContainText(recipe);
    // A recipe: the cull dialog; Esc cancels and focus is back in the search box.
    await press(page, 'Enter');
    const cull = page.getByTestId('cull-dialog');
    await expect(cull).toBeVisible();
    await expect(cull).toHaveAttribute('role', 'dialog');
    await expect(cull).toHaveAttribute('aria-modal', 'true');
    await press(page, 'Escape');
    await expect(cull).toHaveCount(0);
    await expect.poll(() => focused(page)).toBe('list-search');
    await type(page, recipe.slice(0, 7));
    await press(page, 'Enter');
    await expect(cull).toBeVisible();
    await press(page, 'Enter');
    await expect(cull).toHaveCount(0);
    const added = toast(page, `from ${recipe}`);
    await expect(added).toBeVisible();
    // Undo from the toast by keyboard: the toast goes, focus does not drop to <body>.
    await added.getByTestId('toast-action').focus();
    await press(page, 'Enter');
    await expect(added).toHaveCount(0);
    await press(page, 'Escape');
    await expect(search).toHaveAttribute('aria-expanded', 'false');
    expect(await search.getAttribute('aria-activedescendant')).toBeNull();

    // ── Recipes ──
    await press(page, 'Alt+2');
    await expect.poll(() => focused(page)).toBe('recipes-search');
    await type(page, recipe);
    await press(page, 'Enter'); // opens the editor
    await expect(page.getByTestId('recipe-name-input')).toHaveValue(recipe);
    await expect.poll(() => focused(page)).toBe('recipe-search');
    await press(page, 'ArrowDown'); // into the ingredients
    await expect.poll(() => focused(page)).toBe('ingredient-row');
    await press(page, 'End');
    await press(page, 'Delete');
    await expect(page.getByTestId('ingredient-row')).toHaveCount(1);
    await expect.poll(() => focused(page)).toBe('ingredient-row');
    await press(page, 'Delete'); // the last one: back to the search box
    await expect(page.getByTestId('ingredient-row')).toHaveCount(0);
    await expect.poll(() => focused(page)).toBe('recipe-search');
    await press(page, 'F2');
    await expect.poll(() => focused(page)).toBe('recipe-name-input');
    await press(page, 'Escape');
    await expect.poll(() => focused(page)).toBe('recipe-search');
    await press(page, 'Escape'); // empty search: back to the index, on this recipe's row
    await expect(page).toHaveURL(/#\/recipes$/);
    await expect.poll(() => focused(page)).toBe('recipe-row');
    await press(page, 'a'); // no ingredients: the dialog offers the editor
    await expect(page.getByTestId('cull-empty')).toBeVisible();
    await press(page, 'Escape');
    await expect.poll(() => focused(page)).toBe('recipe-row');
    await press(page, 'n');
    await expect(page.getByTestId('new-recipe-dialog')).toBeVisible();
    await press(page, 'Escape');
    await expect.poll(() => focused(page)).toBe('recipe-row');

    // ── Items ──
    await press(page, 'Alt+3');
    await expect.poll(() => focused(page)).toBe('items-search');
    await type(page, item);
    await press(page, 'Enter'); // edit the top match
    await expect.poll(() => focused(page)).toBe('item-edit-name');
    await press(page, 'Escape');
    await expect.poll(() => focused(page)).toBe('item-row');
    const row = page.getByTestId('item-row').filter({ hasText: item });
    await press(page, 's');
    await expect(row.getByTestId('item-staple')).toBeVisible();
    await press(page, 'c');
    await expect(page.getByTestId('category-picker')).toBeVisible();
    await press(page, '1'); // the first category in the walk
    await expect(page.getByTestId('category-picker')).toHaveCount(0);
    await expect(row.getByTestId('item-category')).not.toHaveClass(/is-uncategorized/);
    await expect.poll(() => focused(page)).toBe('item-row');
    await press(page, 'c');
    await press(page, 'Tab'); // Tab = Uncategorized, like the omnibar's picker
    await expect(page.getByTestId('category-picker')).toHaveCount(0);
    await expect(row.getByTestId('item-category')).toHaveClass(/is-uncategorized/);
    await expect.poll(() => focused(page)).toBe('item-row');
    await press(page, 'm');
    await expect(page.getByTestId('merge-picker')).toBeVisible();
    await press(page, 'Escape');
    await expect.poll(() => focused(page)).toBe('item-row');
    await press(page, 'Delete');
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await press(page, 'Enter');
    await expect(row).toHaveCount(0);
    await expect.poll(() => focused(page)).toMatch(/^(item-row|item-create|items-search)$/);
    await press(page, '/');
    await press(page, 'Escape'); // clears the filter
    await expect(page.getByTestId('items-search')).toHaveValue('');
    await press(page, 'Escape'); // leaves it
    await expect.poll(() => focused(page)).toBe('view-root');

    // ── Store order ──
    await press(page, 'Alt+4');
    await expect.poll(() => focused(page)).toBe('category-row');
    await press(page, 'n');
    await expect(page.getByTestId('new-category-dialog')).toBeVisible();
    await type(page, category);
    await press(page, 'Enter');
    const catRow = page.getByTestId('category-row').filter({ hasText: category });
    await expect(catRow).toBeFocused();
    await press(page, 'F2');
    await expect(page.getByTestId('rename-category-dialog')).toBeVisible();
    await press(page, 'Escape');
    await expect(catRow).toBeFocused();
    await press(page, 'Delete');
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await press(page, 'Enter');
    await expect(catRow).toHaveCount(0);
    await expect.poll(() => focused(page)).toBe('category-row');
    await press(page, 'Home');
    await press(page, 'Alt+1');
    await expect.poll(() => focused(page)).toBe('list-search');
  });
});

test('ARIA: widgets have roles and every control has a name', async ({ page, request, isMobile }) => {
  expect((await request.delete('/api/list')).ok()).toBeTruthy();
  const milk = await itemId(request, 'Milk');
  expect((await request.post('/api/list/items', { data: { item_id: milk } })).ok()).toBeTruthy();

  /** Every visible control in the page has an accessible name. */
  async function controlsAreNamed(where: string) {
    const controls = page.locator('button:visible, a[href]:visible, input:visible, select:visible, textarea:visible');
    const count = await controls.count();
    expect(count, where).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(controls.nth(i), `${where}: control #${i}`).toHaveAccessibleName(/\S/);
    }
  }

  await open(page, '#/list');
  const search = page.getByTestId('list-search');
  await expect(search).toHaveRole('combobox');
  const listbox = page.locator(`[id="${await search.getAttribute('aria-controls')}"]`);
  await expect(listbox).toHaveAttribute('role', 'listbox');
  await expect(page.getByRole('list').first()).toBeAttached();
  await expect(page.getByTestId('list-row').first()).toHaveAccessibleName(/^Milk/);
  await expect(page.getByTestId('sync-status')).toHaveRole('status');
  await controlsAreNamed('list');

  await open(page, '#/recipes');
  await expect(page.getByTestId('recipe-list')).toHaveRole('list');
  await expect(page.getByTestId('recipe-row').first()).toHaveAccessibleName(/ingredients?|No ingredients/);
  await controlsAreNamed('recipes');

  await open(page, '#/items');
  await expect(page.getByTestId('item-list')).toHaveRole('list');
  await expect(page.getByTestId('item-row').filter({ hasText: 'Milk' }).first()).toHaveAccessibleName(
    /^Milk, Dairy & Eggs, on the list/,
  );
  await controlsAreNamed('items');
  await page.getByTestId('item-row').filter({ hasText: 'Birthday candles' }).getByTestId('item-category').click();
  const picker = page.getByTestId('category-picker');
  await expect(picker).toHaveRole('dialog');
  await expect(picker).toHaveAttribute('aria-modal', 'true');
  await expect(picker).toHaveAccessibleName('Category for Birthday candles');
  const filter = page.getByTestId('category-picker-input');
  await expect(filter).toHaveRole('combobox');
  if (!isMobile) {
    await page.keyboard.press('ArrowDown');
    const id = await filter.getAttribute('aria-activedescendant');
    await expect(page.locator(`[id="${id}"]`)).toHaveAttribute('aria-selected', 'true');
  }
  await controlsAreNamed('category picker');
  await page.getByTestId('category-picker-cancel').click();

  await open(page, '#/categories');
  await expect(page.getByTestId('category-list')).toHaveRole('list');
  await controlsAreNamed('store order');
});

test('server unreachable: "Offline — reconnecting", slower retries, then back to Live', async ({
  page,
  consoleErrors,
}) => {
  await open(page, '#/list');
  let polls = 0;
  await page.route('**/api/version', (route) => {
    polls += 1;
    return route.abort('connectionrefused');
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); // poll now
  const status = page.getByTestId('sync-status');
  await expect(status).toHaveAttribute('data-state', 'offline');
  await expect(status).toContainText('Offline');
  await expect(status).toHaveAttribute('title', /Reconnecting automatically/);
  if (!(await page.evaluate(() => matchMedia('(max-width: 700px)').matches))) {
    await expect(status).toHaveText('Offline — reconnecting');
  }
  // Backing off: the next polls come 3 s, then 6 s later (then 12 s, ...): two in the next
  // 10.5 s, where a steady 3 s poll would have made three.
  const before = polls;
  await page.waitForTimeout(10_500);
  expect(polls - before).toBeLessThanOrEqual(2);
  expect(polls - before).toBeGreaterThanOrEqual(1);

  // The server is back: the next poll (or focus) goes Live again.
  await page.unroute('**/api/version');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(status).toHaveAttribute('data-state', 'live');
  await expect(status).toHaveText('Live');
  // Chromium logs each refused request; nothing else may have been logged.
  expect(consoleErrors.every((e) => /ERR_CONNECTION_REFUSED|Failed to load resource|api\/version/.test(e))).toBe(true);
  consoleErrors.length = 0;
});
