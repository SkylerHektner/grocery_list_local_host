import { test, expect } from './fixtures';

test('page loads, connects and shows the list view', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Grocery list');
  await expect(page.getByTestId('app-title')).toContainText('Grocery list');
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('view-list')).toBeVisible();
  await expect(page.getByTestId('state-version')).toHaveText(/^v\d+$/);
  // No console errors: asserted by the `consoleErrors` auto fixture.
});
