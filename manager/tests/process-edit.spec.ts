import { test, expect } from '@playwright/test';

test.describe('Process Edit Page', () => {
  // Note: This test assumes there's at least one process in the system
  // and that we can navigate to its edit page

  test('should display edit page when process exists', async ({ page }) => {
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
      await page.goto(`/processes/${pid}/edit`);

      // Check page title
      await expect(page.getByRole('heading', { name: 'Edit crawling process' })).toBeVisible();

      // Check accordion sections exist
      await expect(page.getByRole('button', { name: /Add new crawling step/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /Edit other settings/ })).toBeVisible();
    }
  });

  test('should display new step form when process is done', async ({ page }) => {
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
      await page.goto(`/processes/${pid}/edit`);

      // Expand add new step section
      await page.getByRole('button', { name: /Add new crawling step/ }).click();

      // Check if form is visible (depends on process status)
      const seedsTextarea = page.locator('textarea[name="seeds"]');
      const isFormVisible = await seedsTextarea.isVisible();

      if (isFormVisible) {
        // Test form elements when visible
        await expect(page.getByText('Additional seeds:')).toBeVisible();
        await expect(seedsTextarea).toBeVisible();

        // Check max length input
        const maxLengthInput = page.locator('input[name="maxPathLength"]');
        await expect(maxLengthInput).toBeVisible();
        await expect(maxLengthInput).toHaveAttribute('type', 'number');

        // Check max props input
        const maxPropsInput = page.locator('input[name="maxPathProps"]');
        await expect(maxPropsInput).toBeVisible();
        await expect(maxPropsInput).toHaveAttribute('type', 'number');

        // Check radio buttons for limitation type
        const blacklistRadio = page.locator('input[type="radio"][value="blacklist"]');
        const whitelistRadio = page.locator('input[type="radio"][value="whitelist"]');
        await expect(blacklistRadio).toBeVisible();
        await expect(whitelistRadio).toBeVisible();

        // Check predicate list textarea
        const predListTextarea = page.locator('textarea[name="pred-list"]');
        await expect(predListTextarea).toBeVisible();

        // Check follow direction checkbox
        const followDirectionCheckbox = page.locator(
          'input[type="checkbox"][name="followDirection"]'
        );
        await expect(followDirectionCheckbox).toBeVisible();

        // Check add step button
        const addStepButton = page.locator('button', { hasText: 'Add new step' });
        await expect(addStepButton).toBeVisible();
      } else {
        // Check for message when process is not done
        await expect(page.getByText(/Current step is not done yet/)).toBeVisible();
      }
    }
  });

  test('should display settings edit form', async ({ page }) => {
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
      await page.goto(`/processes/${pid}/edit`);

      // Expand edit settings section
      await page.getByRole('button', { name: /Edit other settings/ }).click();

      // Check form exists
      const editForm = page.locator('form#edit-proc');
      await expect(editForm).toBeVisible();

      // Check email input
      const emailInput = page.locator('input[name="email"]');
      await expect(emailInput).toBeVisible();
      await expect(page.getByText('Email:')).toBeVisible();

      // Check webhook input
      const webhookInput = page.locator('input[name="webhook"]');
      await expect(webhookInput).toBeVisible();
      await expect(page.getByText('Webhook:')).toBeVisible();

      // Check save button
      const saveButton = page.locator('button[type="submit"]', { hasText: 'Save' });
      await expect(saveButton).toBeVisible();
    }
  });

  test('should display tooltips in edit forms', async ({ page }) => {
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
      await page.goto(`/processes/${pid}/edit`);

      // Expand both accordion sections
      await page.getByRole('button', { name: /Add new crawling step/ }).click();
      await page.getByRole('button', { name: /Edit other settings/ }).click();

      // Check tooltip triggers exist (question mark icons)
      const tooltipTriggers = page.locator('[id$="-tt"]');
      // Should have tooltips for seeds, pred-list, email, webhook
      expect(await tooltipTriggers.count()).toBeGreaterThanOrEqual(3);
    }
  });

  test('should pre-populate form fields with current values', async ({ page }) => {
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
      await page.goto(`/processes/${pid}/edit`);

      // Expand add new step section
      await page.getByRole('button', { name: /Add new crawling step/ }).click();

      // Check if form is visible and has default values
      const maxLengthInput = page.locator('input[name="maxPathLength"]');
      const maxPropsInput = page.locator('input[name="maxPathProps"]');

      if (await maxLengthInput.isVisible()) {
        // These should have values from the current step
        const maxLengthValue = await maxLengthInput.getAttribute('value');
        const maxPropsValue = await maxPropsInput.getAttribute('value');

        expect(maxLengthValue).not.toBe('');
        expect(maxPropsValue).not.toBe('');
      }
    }
  });

  test('should handle form interactions correctly', async ({ page }) => {
    await page.goto('/processes');
    const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

    if ((await processLinks.count()) > 0) {
      const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
      await page.goto(`/processes/${pid}/edit`);

      // Test settings form interaction
      await page.getByRole('button', { name: /Edit other settings/ }).click();

      // Fill email field
      const emailInput = page.locator('input[name="email"]');
      await emailInput.fill('test@example.com');
      await expect(emailInput).toHaveValue('test@example.com');

      // Fill webhook field
      const webhookInput = page.locator('input[name="webhook"]');
      await webhookInput.fill('https://example.com/webhook');
      await expect(webhookInput).toHaveValue('https://example.com/webhook');

      // Test new step form if available
      await page.getByRole('button', { name: /Add new crawling step/ }).click();

      const seedsTextarea = page.locator('textarea[name="seeds"]');
      if (await seedsTextarea.isVisible()) {
        await seedsTextarea.fill('https://example.com/new-seed');
        await expect(seedsTextarea).toHaveValue('https://example.com/new-seed');

        // Test radio button selection
        const whitelistRadio = page.locator('input[type="radio"][value="whitelist"]');
        await whitelistRadio.check();
        await expect(whitelistRadio).toBeChecked();

        // Test checkbox
        const followDirectionCheckbox = page.locator(
          'input[type="checkbox"][name="followDirection"]'
        );
        await followDirectionCheckbox.check();
        await expect(followDirectionCheckbox).toBeChecked();
      }
    }
  });
});
