import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const VIEWS = [
  { id: 'list', key: 'Alt+1' },
  { id: 'recipes', key: 'Alt+2' },
  { id: 'items', key: 'Alt+3' },
  { id: 'categories', key: 'Alt+4' },
] as const;

/** Runs `body` as an async function in the page. A string, so the test transpiler never
 *  rewrites its dynamic `import()` of the app's own modules. */
function inPage<T = unknown>(page: Page, body: string): Promise<T> {
  return page.evaluate(`(async () => { ${body} })()`) as Promise<T>;
}

async function open(page: Page, hash = '#/list') {
  await page.goto(`/${hash}`);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'live');
}

test('defaults to the list view and routes with the tabs and history', async ({ page }) => {
  await open(page, '');
  await expect(page).toHaveURL(/#\/list$/);
  await expect(page.getByTestId('view-list')).toBeVisible();
  await expect(page.getByTestId('tab-list')).toHaveAttribute('aria-current', 'page');

  for (const { id } of VIEWS) {
    await page.getByTestId(`tab-${id}`).click();
    await expect(page).toHaveURL(new RegExp(`#/${id}$`));
    await expect(page.getByTestId(`view-${id}`)).toBeVisible();
    await expect(page.getByTestId(`tab-${id}`)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-testid="tabs"] [aria-current="page"]')).toHaveCount(1);
  }

  await page.goBack();
  await expect(page.getByTestId('view-items')).toBeVisible();
  await page.goto('/#/no-such-view');
  await expect(page).toHaveURL(/#\/list$/);
  await expect(page.getByTestId('view-list')).toBeVisible();
});

test('Alt+1..4 switch views; / and Ctrl+K focus the search box', async ({ page }) => {
  await open(page, '#/list');
  for (const { id, key } of [...VIEWS].reverse()) {
    await page.keyboard.press(key);
    await expect(page).toHaveURL(new RegExp(`#/${id}$`));
    await expect(page.getByTestId(`view-${id}`)).toBeVisible();
  }

  // On the list view now (its omnibar may be autofocused: Esc on the empty box leaves it).
  // `/` focuses the search box and is not typed into it.
  const search = page.getByTestId('list-search');
  await page.keyboard.press('Escape');
  await expect(search).not.toBeFocused();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('');

  // Typing works; `/` and `?` are just characters inside a text field.
  await page.keyboard.type('par?/');
  await expect(search).toHaveValue('par?/');
  await expect(page.getByTestId('shortcuts-overlay')).toHaveCount(0);

  // Alt+2 works even while typing; Ctrl+K focuses the new view's search box.
  await page.keyboard.press('Alt+2');
  await expect(page.getByTestId('view-recipes')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('recipes-search')).toBeFocused();
});

test('the search box previews fuzzy matches with highlighting', async ({ page }) => {
  await open(page, '#/list');
  await page.getByTestId('list-search').fill('pmsn');
  const first = page.getByTestId('omnibar-option').first();
  await expect(first).toContainText('Parmigiano Reggiano');
  await expect(first.locator('mark')).toHaveText(['P', 'm', 's', 'n']);
  await page.getByTestId('list-search').fill('xqz');
  await expect(page.getByTestId('omnibar-option')).toHaveCount(0);
  await expect(page.getByTestId('omnibar-create-item')).toHaveText(/Create item.*xqz/);
});

test('? opens the shortcut overlay; Esc closes it and restores focus', async ({ page }) => {
  await open(page, '#/categories');
  await page.keyboard.press('?');
  const overlay = page.getByTestId('shortcuts-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  // Everywhere first, then this view's group; every SPEC group is listed.
  const groups = overlay.getByTestId('shortcut-group');
  await expect(groups.first()).toContainText('Everywhere');
  await expect(groups.nth(1)).toContainText('Store order');
  await expect(overlay).toContainText('Toggle all');
  await expect(overlay).toContainText('Ctrl');
  // Global shortcuts are suspended while it is open.
  await page.keyboard.press('Alt+1');
  await expect(page).toHaveURL(/#\/categories$/);

  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);

  // The header button opens it too; closing returns focus to the button.
  const button = page.getByTestId('shortcuts-button');
  await button.click();
  await expect(overlay).toBeVisible();
  await page.getByTestId('shortcuts-overlay-close').click();
  await expect(overlay).toHaveCount(0);
  await expect(button).toBeFocused();
});

test('live sync: a change made elsewhere shows up on every open page', async ({ page, context, request }) => {
  await open(page, '#/recipes');
  const other = await context.newPage();
  await open(other, '#/items');

  const count = other.getByTestId('count-recipes');
  await expect(count).toHaveText(/^\d+$/);
  const before = Number(await count.textContent());

  const name = `Sync probe ${Date.now()}`;
  const res = await request.post('/api/recipes', { data: { name } });
  expect(res.ok()).toBeTruthy();

  await expect(page.getByTestId('recipe-name').filter({ hasText: name })).toBeVisible({ timeout: 6000 });
  await expect(count).toHaveText(String(before + 1), { timeout: 6000 });
  await other.close();
});

test('a mutation updates the page at once; an API error shows the server message', async ({
  page,
  consoleErrors,
}) => {
  await open(page, '#/items');
  const count = page.getByTestId('count-items');
  await expect(count).toHaveText(/^\d+$/);
  const before = Number(await count.textContent());

  // The mutation response goes straight into the store: no poll needed (well under 3 s).
  await inPage(page, `
    const { api } = await import('/js/api.js');
    await api.createItem({ name: 'Instant probe ' + Date.now() });
  `);
  await expect(count).toHaveText(String(before + 1), { timeout: 1000 });

  // "Milk" exists in the demo catalog: 409 with the server's message in an error toast.
  await inPage(page, `
    const { api } = await import('/js/api.js');
    await api.createItem({ name: 'milk' }).catch(() => {});
  `);
  const toast = page.getByTestId('toast').filter({ hasText: 'already exists' });
  await expect(toast).toHaveText('an item named "Milk" already exists');
  await expect(toast).toHaveAttribute('data-variant', 'error');
  await expect(toast).toHaveAttribute('role', 'alert');
  await toast.getByTestId('toast-close').click();
  await expect(toast).toHaveCount(0);

  // Chromium logs the 409 response as a console error: expected here.
  await expect.poll(() => consoleErrors.length).toBeGreaterThan(0);
  expect(consoleErrors.every((e) => e.includes('409'))).toBe(true);
  consoleErrors.length = 0;
});

test('toast actions and the confirm dialog work by keyboard', async ({ page }) => {
  await open(page, '#/list');

  await inPage(page, `
    const { toast } = await import('/js/components/toast.js');
    window.__undone = false;
    toast('Removed Milk', { action: { label: 'Undo', onClick: () => { window.__undone = true; } } });
  `);
  const toast = page.getByTestId('toast').filter({ hasText: 'Removed Milk' });
  await toast.getByTestId('toast-action').click();
  await expect(toast).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __undone: boolean }).__undone)).toBe(true);

  const ask = `
    const { confirm } = await import('/js/components/dialog.js');
    window.__answer = 'pending';
    confirm({ title: 'Clear the list?', message: 'All 3 items go.', confirmLabel: 'Clear', danger: true })
      .then((v) => { window.__answer = v; });
  `;
  const answer = () => page.evaluate(() => (window as unknown as { __answer: unknown }).__answer);
  const dialog = page.getByTestId('confirm-dialog');

  // Enter confirms (focus starts on the confirm button).
  await inPage(page, ask);
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('confirm-dialog-confirm')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect.poll(answer).toBe(true);

  // Esc cancels; Tab stays trapped inside the dialog.
  await inPage(page, ask);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('confirm-dialog-cancel')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('confirm-dialog-confirm')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect.poll(answer).toBe(false);
});

test('mobile: no horizontal scroll at 375 and 360 px; tabs are a bottom bar', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile layout only');
  for (const width of [375, 360]) {
    await page.setViewportSize({ width, height: 740 });
    for (const { id } of VIEWS) {
      await open(page, `#/${id}`);
      await expect(page.getByTestId(`view-${id}`)).toBeVisible();
      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        return el.scrollWidth - el.clientWidth;
      });
      expect(overflow, `${id} at ${width}px`).toBeLessThanOrEqual(0);
    }
  }
  const tabs = await page.getByTestId('tabs').boundingBox();
  expect(tabs).not.toBeNull();
  expect(tabs!.y + tabs!.height).toBeGreaterThanOrEqual(740 - 1);
  // Tap targets: every tab is at least 44 px tall.
  for (const { id } of VIEWS) {
    const box = await page.getByTestId(`tab-${id}`).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
