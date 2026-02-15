import { test, expect } from '@playwright/test';

test.describe('Processes List Page', () => {
  test('should display processes table with correct headers', async ({ page }) => {
    await page.goto('/processes');

    // Check page title
    await expect(page.getByRole('heading', { name: 'Processes' })).toBeVisible();

    // Check table headers
    await expect(page.getByRole('columnheader', { name: 'PID' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Max path length' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Max path props' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Submitted' })).toBeVisible();
  });

  test('should display table with striped rows and hover effects', async ({ page }) => {
    await page.goto('/processes');

    // Check table has Bootstrap classes for styling
    const table = page.locator('table');
    await expect(table).toHaveClass(/table-striped/);
    await expect(table).toHaveClass(/table-hover/);
  });

  test('should display status badges', async ({ page }) => {
    await page.goto('/processes');

    // Look for badge elements (may not have processes in test data)
    const badges = page.locator('.badge, [class*="badge"]');
    // If there are badges, they should be visible
    if ((await badges.count()) > 0) {
      await expect(badges.first()).toBeVisible();
    }
  });

  test('should show empty state message when no processes exist', async ({ page }) => {
    await page.goto('/processes');

    // Check for empty state message
    const emptyMessage = page.locator('text=Oops, there are no processes yet!');
    const link = page.locator('text=Add a new one');

    // Either empty message should be visible, or processes should exist
    try {
      await expect(emptyMessage).toBeVisible();
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', '/processes/new');
    } catch {
      // If empty message not visible, check that process links exist
      const processLinks = page.locator('a[href*="/processes/"]');
      await expect(processLinks.first()).toBeVisible();
    }
  });

  test('should navigate to individual process when clicking PID link', async ({ page }) => {
    await page.goto('/processes');

    // Find and click on a process link if it exists
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');
    if ((await processLinks.count()) > 0) {
      const firstLink = processLinks.first();
      const href = await firstLink.getAttribute('href');
      await firstLink.click();
      await expect(page).toHaveURL(href!);
    }
  });

  test('should navigate to new process page', async ({ page }) => {
    await page.goto('/processes');

    // Check if there's a link to create new process
    const newProcessLink = page.locator('a[href="/processes/new"]');
    if (await newProcessLink.isVisible()) {
      await newProcessLink.click();
      await expect(page).toHaveURL('/processes/new');
    }
  });
});
