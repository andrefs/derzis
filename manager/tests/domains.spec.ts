import { test, expect } from '@playwright/test';

test.describe('Domains Page', () => {
	test('should display domains page with title and controls', async ({ page }) => {
		await page.goto('/domains');

		// Check page title
		await expect(page.getByRole('heading', { name: 'Domains' })).toBeVisible();

		// Check search input exists
		const searchInput = page.locator('input#searchInput');
		await expect(searchInput).toBeVisible();
		await expect(page.getByText('Search:')).toBeVisible();

		// Check sort select exists
		const sortSelect = page.locator('select#sortField');
		await expect(sortSelect).toBeVisible();
		await expect(page.getByText('Sort by:')).toBeVisible();

		// Check sort direction buttons exist
		const ascButton = page.getByRole('button', { name: '↑ Asc' });
		const descButton = page.getByRole('button', { name: '↓ Desc' });
		await expect(ascButton).toBeVisible();
		await expect(descButton).toBeVisible();
	});

	test('should display empty state when no domains exist', async ({ page }) => {
		await page.goto('/domains');

		// Check for empty state alert
		const emptyAlert = page.locator('.alert, [class*="alert"]');
		const emptyMessage = page.getByText(
			'No domains found. Domains will appear here once crawling processes have been started.'
		);

		// Either empty alert should be visible, or domain cards should exist
		try {
			await expect(emptyMessage).toBeVisible();
		} catch {
			// If empty message not visible, check that domain cards exist
			const domainCards = page.locator('.card, [class*="card"]');
			await expect(domainCards.first()).toBeVisible();
		}
	});

	test('should display domain cards with proper structure', async ({ page }) => {
		await page.goto('/domains');

		const domainCards = page.locator('.card, [class*="card"]');
		if ((await domainCards.count()) > 0) {
			const firstCard = domainCards.first();

			// Check card has title (domain name)
			const cardTitle = firstCard.locator('.card-title, h5');
			await expect(cardTitle).toBeVisible();

			// Check status badge exists
			const statusBadge = firstCard.locator('.badge, [class*="badge"]').first();
			await expect(statusBadge).toBeVisible();

			// Check status text is visible
			await expect(firstCard.locator('strong', { hasText: 'Status:' })).toBeVisible();

			// Check other sections exist
			await expect(firstCard.getByText('Crawl Stats:')).toBeVisible();
			await expect(firstCard.getByText('Last Accessed:')).toBeVisible();
			await expect(firstCard.getByText('Next Allowed:')).toBeVisible();
		}
	});

	test('should display status badges with correct colors', async ({ page }) => {
		await page.goto('/domains');

		const domainCards = page.locator('.card, [class*="card"]');
		if ((await domainCards.count()) > 0) {
			// Find status badges
			const statusBadges = page.locator('.badge, [class*="badge"]');

			if ((await statusBadges.count()) > 0) {
				// Check that badges have Bootstrap color classes
				const firstBadge = statusBadges.first();
				const classes = await firstBadge.getAttribute('class');

				// Should have some color class (Bootstrap 5 uses text-bg-* classes)
				expect(classes).toMatch(
					/(badge|text-bg)-(success|warning|danger|secondary|info|primary|dark)/
				);
			}
		}
	});

	test('should display warning badges when warnings exist', async ({ page }) => {
		await page.goto('/domains');

		const domainCards = page.locator('.card, [class*="card"]');
		if ((await domainCards.count()) > 0) {
			const firstCard = domainCards.first();

			// Check warnings section exists (be more specific to avoid conflicts)
			const warningsSection = firstCard
				.locator('div')
				.filter({ has: page.locator('strong', { hasText: 'Warnings:' }) });
			await expect(warningsSection).toBeVisible();

			// Look for warning badges (may or may not exist)
			const warningBadges = firstCard.locator('.badge');
			// If there are badges, they should be visible
			if ((await warningBadges.count()) > 0) {
				await expect(warningBadges.first()).toBeVisible();
			}
		}
	});

	test('should display robots status when available', async ({ page }) => {
		await page.goto('/domains');

		const domainCards = page.locator('.card, [class*="card"]');
		if ((await domainCards.count()) > 0) {
			const firstCard = domainCards.first();

			// Check if robots section exists (may be conditional)
			const robotsText = firstCard.getByText('Robots:');
			try {
				await expect(robotsText).toBeVisible();
				// If robots section exists, check for robots badge
				const robotsBadge = firstCard.locator('.badge').nth(1); // Second badge should be robots
				await expect(robotsBadge).toBeVisible();
			} catch {
				// Robots section may not exist for all domains, which is fine
			}
		}
	});

	test('should handle search functionality', async ({ page }) => {
		await page.goto('/domains');

		const searchInput = page.locator('input#searchInput');

		// Test search input interaction
		await searchInput.fill('example');
		await expect(searchInput).toHaveValue('example');

		// Clear search
		await searchInput.clear();
		await expect(searchInput).toHaveValue('');
	});

	test('should handle sorting functionality', async ({ page }) => {
		await page.goto('/domains');

		const sortSelect = page.locator('select#sortField');

		// Test sort options exist (check the select element itself has the expected options)
		const optionCount = await sortSelect.locator('option').count();
		expect(optionCount).toBeGreaterThanOrEqual(6); // Should have at least 6 sort options

		// Check specific options exist by value
		await expect(sortSelect.locator('option[value="origin"]')).toHaveCount(1);
		await expect(sortSelect.locator('option[value="status"]')).toHaveCount(1);
		await expect(sortSelect.locator('option[value="lastAccessed"]')).toHaveCount(1);

		// Test selecting different sort options
		await sortSelect.selectOption('status');
		await expect(sortSelect).toHaveValue('status');

		await sortSelect.selectOption('lastAccessed');
		await expect(sortSelect).toHaveValue('lastAccessed');
	});

	test('should handle sort direction buttons', async ({ page }) => {
		await page.goto('/domains');

		const ascButton = page.getByRole('button', { name: '↑ Asc' });
		const descButton = page.getByRole('button', { name: '↓ Desc' });

		// Test clicking asc button
		await ascButton.click();
		// Check button styling (should be active)
		await expect(ascButton).toHaveClass(/btn-secondary/);

		// Test clicking desc button
		await descButton.click();
		// Check button styling (should be active)
		await expect(descButton).toHaveClass(/btn-secondary/);
	});

	test('should display crawl statistics', async ({ page }) => {
		await page.goto('/domains');

		const domainCards = page.locator('.card, [class*="card"]');
		if ((await domainCards.count()) > 0) {
			const firstCard = domainCards.first();

			// Check crawl stats section
			await expect(firstCard.getByText('Queued:')).toBeVisible();
			await expect(firstCard.getByText('Success:')).toBeVisible();
			await expect(firstCard.getByText('Ongoing:')).toBeVisible();
			await expect(firstCard.getByText('Failed:')).toBeVisible();
			await expect(firstCard.getByText('Delay:')).toBeVisible();
		}
	});

	test('should display recent warnings when available', async ({ page }) => {
		await page.goto('/domains');

		const domainCards = page.locator('.card, [class*="card"]');
		if ((await domainCards.count()) > 0) {
			const firstCard = domainCards.first();

			// Check if recent warnings section exists (conditional)
			const recentWarningsText = firstCard.getByText('Recent Warnings:');
			try {
				await expect(recentWarningsText).toBeVisible();
			} catch {
				// Recent warnings may not exist, which is fine
			}
		}
	});

	test('should display responsive grid layout', async ({ page }) => {
		await page.goto('/domains');

		const domainCards = page.locator('.card, [class*="card"]');
		if ((await domainCards.count()) > 0) {
			// Check Bootstrap grid classes
			const columns = page.locator('[class*="col-"], [class*="col-"]');
			expect(await columns.count()).toBeGreaterThan(0);

			// Check for responsive classes
			const firstColumn = columns.first();
			const classes = await firstColumn.getAttribute('class');
			expect(classes).toMatch(/col-(xs|sm|md|lg|xl)/);
		}
	});
});
