import { test, expect } from '@playwright/test';

test.describe('Individual Process Page', () => {
  // Note: These tests assume there's at least one process in the system
  // In a real scenario, you might need to create test data or mock the API

  test('should display process details when process exists', async ({ page }) => {
    // First check if processes exist
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      const firstProcessLink = processLinks.first();
      const href = await firstProcessLink.getAttribute('href');
      const pid = href?.split('/').pop();

      await firstProcessLink.click();

      // Check page title contains process ID
      await expect(
        page.getByRole('heading', { name: new RegExp(`Process.*${pid}`) })
      ).toBeVisible();

      // Check edit link exists
      const editLink = page.locator(`a[href="/processes/${pid}/edit"]`);
      await expect(editLink).toBeVisible();

      // Check Details section exists
      await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();

      // Check status badge exists
      const statusBadge = page.locator('.badge, [class*="badge"]').first();
      await expect(statusBadge).toBeVisible();
    }
  });

  test('should display triples download links when process exists', async ({ page }) => {
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
      await processLinks.first().click();

      // Check triples section has download links
      const jsonLink = page.locator(`a[href="/api/processes/${pid}/triples.json.gz"]`);
      const ntLink = page.locator(`a[href="/api/processes/${pid}/triples.nt.gz"]`);

      await expect(jsonLink).toBeVisible();
      await expect(ntLink).toBeVisible();

      // Check links contain download icons
      await expect(jsonLink.locator('svg, [class*="icon"]')).toBeVisible();
      await expect(ntLink.locator('svg, [class*="icon"]')).toBeVisible();
    }
  });

  test('should display navigation links when process exists', async ({ page }) => {
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
      await processLinks.first().click();

      // Check draw link exists
      const drawLink = page.locator(`a[href="/processes/${pid}/draw"]`);
      await expect(drawLink).toContainText('Draw');
      await expect(drawLink.locator('svg, [class*="icon"]')).toBeVisible();
    }
  });

  test('should display steps and notifications sections when process exists', async ({ page }) => {
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      await processLinks.first().click();

      // Check sections exist
      await expect(page.locator('h3', { hasText: 'Steps' })).toBeVisible();
      await expect(page.locator('h3', { hasText: 'Notifications' })).toBeVisible();

      // Check notification table rows
      await expect(page.getByRole('rowheader', { name: 'Email' })).toBeVisible();
      await expect(page.getByRole('rowheader', { name: 'Webhook' })).toBeVisible();
    }
  });

  test('should display progress section for running processes', async ({ page }) => {
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      await processLinks.first().click();

      const progressSection = page.locator('[class*="progress"], #progress, .progress');
      if (await progressSection.count() > 0) {
        await expect(progressSection.first()).toBeVisible();
      }
    }
  });
});
