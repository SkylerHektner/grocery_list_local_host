import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Phone layout at 375×812 (SPEC §3.11, T8): a whole shopping-list session by tapping, tap
// targets, the sticky omnibar, sheets above the on-screen keyboard, the bottom tab bar never
// covering content or toasts, and no horizontal scroll anywhere. Mobile project only. The DB is
// shared by every test of the run: each test clears the list and uses unique names.

test.skip(({ isMobile }) => !isMobile, 'phone layout only');

type Snapshot = {
  items: { id: number; name: string }[];
  recipes: { id: number; name: string; item_ids: number[] }[];
  list: { entries: { item_id: number }[] };
};

async function state(request: APIRequestContext): Promise<Snapshot> {
  const res = await request.get('/api/state');
  expect(res.ok()).toBeTruthy();
  return res.json();
}

async function resetList(request: APIRequestContext) {
  expect((await request.delete('/api/list')).ok()).toBeTruthy();
}

async function ids(request: APIRequestContext, names: string[]) {
  const { items } = await state(request);
  return names.map((name) => {
    const item = items.find((i) => i.name === name);
    if (!item) throw new Error(`no item named ${name}`);
    return item.id;
  });
}

async function addToList(request: APIRequestContext, names: string[]) {
  for (const id of await ids(request, names)) {
    expect((await request.post('/api/list/items', { data: { item_id: id } })).ok()).toBeTruthy();
  }
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

const listRow = (page: Page, name: string) =>
  page.getByTestId('list-row').filter({ has: page.getByTestId('row-name').getByText(name, { exact: true }) });
const toast = (page: Page, text: string) => page.getByTestId('toast').filter({ hasText: text });

/** Visible interactive elements smaller than 44×44 px (the touch target minimum). */
function smallTargets(page: Page) {
  return page.evaluate(() => {
    const selector = [
      'button',
      'a[href]',
      'input:not([type="checkbox"])', // a search box's tap target is its whole label (below)
      'label.search',
      'select',
      'textarea',
      '[role="option"]:not([aria-disabled="true"])',
      'li[tabindex]',
      'label.cull-label',
      'label.field-check',
    ].join(',');
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest('[inert]') || el.closest('.visually-hidden')) continue;
      if (el instanceof HTMLInputElement && el.closest('label.search')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue; // not rendered
      if (r.height < 43.5 || r.width < 43.5) {
        const name = el.dataset.testid ?? el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30);
        out.push(`${el.tagName.toLowerCase()} ${name}: ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test('a whole phone session by tapping: add items, add a recipe via the sheet, remove, copy', async ({
  page,
  request,
}) => {
  await resetList(request);
  const recipe = `${uniqueName()} soup`;
  const itemIds = await ids(request, ['Yellow onions', 'Carrots', 'Garlic', 'Chicken stock']);
  expect((await request.post('/api/recipes', { data: { name: recipe, item_ids: itemIds } })).ok()).toBeTruthy();
  // A phone on plain HTTP: no Clipboard API.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined, configurable: true });
  });
  await open(page, '#/list');
  const search = page.getByTestId('list-search');
  await expect(search).not.toBeFocused(); // no keyboard popping up on load

  // Add two items by tapping their suggestions.
  for (const [typed, name] of [
    ['banan', 'Bananas'],
    ['greek y', 'Greek yogurt'],
  ]) {
    await search.tap();
    await search.fill(typed);
    await page.getByTestId('omnibar-option').filter({ hasText: name }).first().tap();
    await expect(listRow(page, name)).toBeVisible();
    await expect(search).toHaveValue('');
  }

  // A recipe: the cull sheet fills the screen; skip the stock, keep the rest (Garlic is a staple).
  await search.tap();
  await search.fill(recipe.slice(0, 8));
  await page.getByTestId('omnibar-option').filter({ hasText: recipe }).tap();
  const sheet = page.getByTestId('cull-dialog');
  await expect(sheet).toBeVisible();
  // Full screen once it has slid in.
  await expect.poll(async () => (await sheet.boundingBox())!.y).toBeLessThanOrEqual(1);
  const box = (await sheet.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThanOrEqual(811);
  const stock = sheet.getByTestId('cull-row').filter({ hasText: 'Chicken stock' });
  await stock.locator('label').tap();
  await expect(stock.getByTestId('cull-check')).not.toBeChecked();
  await expect(sheet.getByTestId('cull-count')).toHaveText('Adding 2 of 4');
  await page.getByTestId('cull-confirm').tap();
  await expect(sheet).toHaveCount(0);
  await expect(toast(page, `Added 2 items from ${recipe}`)).toBeVisible();
  await expect(listRow(page, 'Yellow onions')).toBeVisible();
  await expect(listRow(page, 'Carrots')).toBeVisible();
  await expect(listRow(page, 'Chicken stock')).toHaveCount(0);

  // Remove one with its × (always visible on touch screens).
  await listRow(page, 'Bananas').getByTestId('remove-entry').tap();
  await expect(listRow(page, 'Bananas')).toHaveCount(0);
  await expect(toast(page, 'Removed Bananas')).toBeVisible();
  await expect.poll(async () => (await state(request)).list.entries.length).toBe(3);

  // Copy: execCommand, or the pre-selected text to copy by hand. Either way the exact export.
  const expected = await (await request.get('/api/list/export')).text();
  expect(expected).toBe('PRODUCE\nCarrots\nYellow onions\n\nDAIRY & EGGS\nGreek yogurt');
  await page.getByTestId('copy-list').tap();
  const dialog = page.getByTestId('copy-dialog');
  await expect(toast(page, 'Copied 3 items').or(dialog)).toBeVisible();
  if (await dialog.isVisible()) {
    await expect(page.getByTestId('copy-dialog-text')).toHaveValue(expected);
    await page.getByTestId('copy-dialog-done').tap();
  }
  // The manual fallback when the browser refuses both clipboard routes.
  await page.evaluate(() => {
    document.execCommand = () => false;
  });
  await page.getByTestId('copy-list').tap();
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('copy-dialog-text')).toHaveValue(expected);
  expect(await smallTargets(page)).toEqual([]);
  await page.getByTestId('copy-dialog-done').tap();
  await expect(dialog).toHaveCount(0);
});

test('tap targets are at least 44 px in every view and dialog', async ({ page, request }) => {
  await resetList(request);
  await addToList(request, ['Milk', 'Parmigiano Reggiano']);
  const carbonara = (await state(request)).recipes.find((r) => r.name === 'Spaghetti Carbonara')!;
  expect(
    (await request.post('/api/list/recipes', { data: { recipe_id: carbonara.id, item_ids: carbonara.item_ids } })).ok(),
  ).toBeTruthy();

  await open(page, '#/list');
  expect(await smallTargets(page), 'list').toEqual([]);
  await listRow(page, 'Milk').getByTestId('row-name').tap(); // note editor
  await expect(page.getByTestId('note-input')).toBeVisible();
  expect(await smallTargets(page), 'note editor').toEqual([]);
  await page.getByTestId('list-search').fill('newthing');
  await page.getByTestId('omnibar-create-item').tap(); // category picker
  await expect(page.getByTestId('omnibar-picker-back')).toBeVisible();
  expect(await smallTargets(page), 'omnibar picker').toEqual([]);
  await page.getByTestId('omnibar-picker-back').tap();

  await open(page, '#/recipes');
  expect(await smallTargets(page), 'recipes').toEqual([]);
  await page.getByTestId('recipe-row').filter({ hasText: 'Tacos' }).locator('.recipe-row-main').tap();
  await expect(page.getByTestId('recipe-name-input')).toHaveValue('Tacos');
  expect(await smallTargets(page), 'recipe editor').toEqual([]);
  await page.getByTestId('recipe-add-to-list').tap();
  await expect(page.getByTestId('cull-dialog')).toBeVisible();
  expect(await smallTargets(page), 'cull sheet').toEqual([]);
  await page.getByTestId('cull-cancel').tap();

  await open(page, '#/items');
  expect(await smallTargets(page), 'items').toEqual([]);
  await page.getByTestId('item-row').filter({ hasText: 'Birthday candles' }).getByTestId('item-category').tap();
  await expect(page.getByTestId('category-picker')).toBeVisible();
  expect(await smallTargets(page), 'category picker').toEqual([]);
  await page.getByTestId('category-picker-cancel').tap();
  await page.getByTestId('item-row').filter({ hasText: 'Birthday candles' }).locator('.item-row-main').tap();
  await expect(page.getByTestId('item-editor')).toBeVisible();
  expect(await smallTargets(page), 'item editor').toEqual([]);
  expect(await horizontalOverflow(page), 'item editor').toBeLessThanOrEqual(0);
  await page.getByTestId('item-edit-cancel').tap();

  await open(page, '#/categories');
  expect(await smallTargets(page), 'store order').toEqual([]);
  await page.getByTestId('category-row').first().getByTestId('category-delete').tap();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  expect(await smallTargets(page), 'confirm').toEqual([]);
  await page.getByTestId('confirm-dialog-cancel').tap();
  await page.getByTestId('shortcuts-button').tap();
  await expect(page.getByTestId('shortcuts-overlay')).toBeVisible();
  expect(await smallTargets(page), 'shortcut overlay').toEqual([]);
});

test('long names wrap between words next to recipe tags; no horizontal scroll anywhere', async ({
  page,
  request,
}) => {
  await resetList(request);
  const carbonara = (await state(request)).recipes.find((r) => r.name === 'Spaghetti Carbonara')!;
  expect(
    (await request.post('/api/list/recipes', { data: { recipe_id: carbonara.id, item_ids: carbonara.item_ids } })).ok(),
  ).toBeTruthy();
  await open(page, '#/list');
  const name = listRow(page, 'Parmigiano Reggiano').getByTestId('row-name');
  await expect(name).toBeVisible();
  await expect(listRow(page, 'Parmigiano Reggiano').getByTestId('row-source')).toHaveText('Spaghetti Carbonara');
  // Each word sits on one line: a word split across lines has more than one client rect.
  const split = await name.evaluate((el) => {
    const text = el.firstChild as Text;
    const words = [...text.data.matchAll(/\S+/g)];
    return words.filter((m) => {
      const range = document.createRange();
      range.setStart(text, m.index!);
      range.setEnd(text, m.index! + m[0].length);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1;
    }).map((m) => m[0]);
  });
  expect(split).toEqual([]);

  for (const hash of ['#/list', '#/recipes', '#/items', '#/categories', `#/recipes/${carbonara.id}`]) {
    await open(page, hash);
    await expect(page.getByTestId('view-root')).not.toBeEmpty();
    expect(await horizontalOverflow(page), hash).toBeLessThanOrEqual(0);
  }
});

test('the omnibar stays in reach on a long list; the tab bar never covers rows or toasts', async ({
  page,
  request,
}) => {
  await resetList(request);
  const { items } = await state(request);
  const names = items.filter((i) => !i.name.startsWith('Zq')).slice(0, 30).map((i) => i.name);
  await addToList(request, names);
  await open(page, '#/list');
  await expect(page.getByTestId('list-row')).toHaveCount(names.length);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
  const search = page.getByTestId('list-search');
  const bar = (await page.getByTestId('list-bar').boundingBox())!;
  expect(bar.y).toBeGreaterThanOrEqual(-1);
  expect(bar.y).toBeLessThan(60); // stuck to the top of the screen
  await expect(page.getByTestId('list-bar')).toHaveClass(/is-stuck/);

  // The last thing on the page ends above the tab bar.
  const tabs = (await page.getByTestId('tabs').boundingBox())!;
  const body = (await page.getByTestId('list-body').boundingBox())!;
  expect(body.y + body.height).toBeLessThanOrEqual(tabs.y);

  // So does a toast.
  await page.getByTestId('list-row').last().getByTestId('remove-entry').tap();
  const removed = page.getByTestId('toast').filter({ hasText: 'Removed' });
  await expect(removed).toBeVisible();
  const toastBox = (await removed.boundingBox())!;
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(tabs.y);

  // Still usable from down here: tap, type, add.
  await search.tap();
  await search.fill('sparkling');
  await page.getByTestId('omnibar-option').filter({ hasText: 'Sparkling water' }).tap();
  await expect(listRow(page, 'Sparkling water')).toBeVisible();
});

test('bottom sheets sit above the on-screen keyboard (visual viewport)', async ({ page }) => {
  await open(page, '#/recipes');
  // viewport.js mirrors window.visualViewport into CSS custom properties.
  const vars = await page.evaluate(() => {
    const s = document.documentElement.style;
    return [s.getPropertyValue('--vv-top'), s.getPropertyValue('--vv-height'), s.getPropertyValue('--kb-inset')];
  });
  expect(vars).toEqual(['0px', '812px', '0px']);

  // With a keyboard covering the bottom 400 px, the name sheet ends right above it.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--vv-height', '412px');
    document.documentElement.style.setProperty('--kb-inset', '400px');
  });
  await page.getByTestId('new-recipe').tap();
  const dialog = page.getByTestId('new-recipe-dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const b = (await dialog.boundingBox())!;
      return Math.round(b.y + b.height);
    })
    .toBe(412);
  const input = (await page.getByTestId('new-recipe-dialog-input').boundingBox())!;
  expect(input.y).toBeGreaterThan(0);
  expect(input.y + input.height).toBeLessThan(412);
  await page.getByTestId('new-recipe-dialog-cancel').tap();
  await expect(dialog).toHaveCount(0);
});
