import { test, expect } from './fixtures';

test('page loads and shows server health', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Grocery list');
  await expect(page.getByTestId('app-title')).toHaveText('Grocery list — coming soon');
  const health = page.getByTestId('health-status');
  await expect(health).toHaveAttribute('data-state', 'ok');
  await expect(health).toHaveText(/^Server OK · version \d+$/);
  // No console errors: asserted by the `consoleErrors` auto fixture.
});
