import { test as base, expect } from '@playwright/test';

/**
 * Import `test`/`expect` from here instead of '@playwright/test'.
 *
 * `consoleErrors` is an auto fixture: every test fails if the page logged a console error or
 * threw an uncaught exception. A test that provokes an expected error (e.g. a 409 response,
 * which Chromium logs as "Failed to load resource") can inspect and then clear it:
 * `consoleErrors.length = 0`.
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));
      await use(errors);
      expect(errors, 'browser console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
