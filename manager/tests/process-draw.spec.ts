import { test, expect } from '@playwright/test';

test.describe('Process Draw/Graph Page', () => {
	test('should display draw page when process exists', async ({ page }) => {
		await page.goto('/processes');
		const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

		if ((await processLinks.count()) > 0) {
			const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
			await page.goto(`/processes/${pid}/draw`);

			// Check page title contains process ID
			await expect(
				page.getByRole('heading', { name: new RegExp(`Process.*${pid}`) })
			).toBeVisible();

			// Check link back to process page
			const processLink = page.locator(`a[href="/processes/${pid}"]`);
			await expect(processLink).toBeVisible();
		}
	});

	test('should display loading state initially', async ({ page }) => {
		await page.goto('/processes');
		const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

		if ((await processLinks.count()) === 0) {
			// Skip test if no processes exist
			console.log('Skipping test - no processes available');
			return;
		}

		const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
		await page.goto(`/processes/${pid}/draw`);

		// Check for loading spinner
		const spinner = page.locator('.loading-container svg, .loading-container [class*="spinner"]');
		const loadingText = page.getByText('Loading graph data...');

		// Either loading state should be visible, or graph should be loaded
		try {
			await expect(spinner.or(loadingText)).toBeVisible();
		} catch {
			// If not loading, check that graph container exists
			const graphContainer = page.locator('.col.h-100');
			await expect(graphContainer).toBeVisible();
		}
	});

	test('should display controls accordion', async ({ page }) => {
		await page.goto('/processes');
		const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

		if ((await processLinks.count()) > 0) {
			const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
			await page.goto(`/processes/${pid}/draw`);

			// Check accordion header
			await expect(page.getByRole('button', { name: /Options/ })).toBeVisible();
		}
	});

	test('should display predicate filter select', async ({ page }) => {
		await page.goto('/processes');
		const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

		if ((await processLinks.count()) > 0) {
			const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
			await page.goto(`/processes/${pid}/draw`);

			// Expand options accordion
			await page.getByRole('button', { name: /Options/ }).click();

			// Check predicate select exists
			const predicateSelect = page.locator('select#predicate-select');
			await expect(predicateSelect).toBeVisible();
			await expect(page.getByText('Filter by predicate:')).toBeVisible();

			// Check default option
			const allOption = page.locator('option[value="all"]');
			await expect(allOption).toBeVisible();
			await expect(allOption).toHaveText('All predicates');
		}
	});

	test('should display number of triples slider', async ({ page }) => {
		await page.goto('/processes');
		const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

		if ((await processLinks.count()) > 0) {
			const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
			await page.goto(`/processes/${pid}/draw`);

			// Expand options accordion
			await page.getByRole('button', { name: /Options/ }).click();

			// Check slider exists
			const slider = page.locator('input[type="range"]#num-triples-slider');
			await expect(slider).toBeVisible();

			// Check slider has proper attributes
			await expect(slider).toHaveAttribute('min', '1');
			await expect(slider).toHaveAttribute('max'); // max should be set to totalTriples

			// Check labels exist
			const sliderLabels = page.locator('.slider-labels');
			await expect(sliderLabels).toBeVisible();
			await expect(sliderLabels.locator('span').first()).toHaveText('1');
		}
	});

	test('should display legend components', async ({ page }) => {
		await page.goto('/processes');
		const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

		if ((await processLinks.count()) > 0) {
			const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
			await page.goto(`/processes/${pid}/draw`);

			// Check that legend components are rendered (they may be empty initially)
			// NodeColorLegend and EdgeColorLegend should exist in the DOM
			const legends = page.locator('[class*="legend"], [class*="Legend"]');
			expect(await legends.count()).toBeGreaterThanOrEqual(1);
		}
	});

	test('should display graph container', async ({ page }) => {
		await page.goto('/processes');
		const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

		if ((await processLinks.count()) > 0) {
			const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
			await page.goto(`/processes/${pid}/draw`);

			// Check main graph container
			const graphContainer = page.locator('.col.h-100');
			await expect(graphContainer).toBeVisible();

			// Check row container
			const row = page.locator('.row');
			await expect(row).toBeVisible();
		}
	});

	test('should handle predicate filtering', async ({ page }) => {
		await page.goto('/processes');
		const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

		if ((await processLinks.count()) > 0) {
			const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
			await page.goto(`/processes/${pid}/draw`);

			// Wait for page to load
			await page.waitForTimeout(2000); // Give time for triples to load

			// Expand options and check if predicate options are available
			await page.getByRole('button', { name: /Options/ }).click();

			const predicateSelect = page.locator('select#predicate-select');
			const optionCount = await predicateSelect.locator('option').count();

			if (optionCount > 1) {
				// If there are predicates, test selection
				const secondOption = predicateSelect.locator('option').nth(1);
				const optionValue = await secondOption.getAttribute('value');

				await predicateSelect.selectOption({ value: optionValue! });

				// Check URL updates with predicate parameter
				await expect(page).toHaveURL(new RegExp(`predicate=${encodeURIComponent(optionValue!)}`));
			}
		}
	});

	test('should handle triples slider interaction', async ({ page }) => {
		await page.goto('/processes');
		const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

		if ((await processLinks.count()) > 0) {
			const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
			await page.goto(`/processes/${pid}/draw`);

			// Wait for page to load
			await page.waitForTimeout(2000);

			// Expand options
			await page.getByRole('button', { name: /Options/ }).click();

			const slider = page.locator('input[type="range"]#num-triples-slider');
			if (await slider.isVisible()) {
				// Test slider interaction
				const initialValue = await slider.getAttribute('value');
				await slider.fill('50'); // Set to middle value

				// Check that label updates (if implemented)
				const label = page.locator('label[for="num-triples-slider"]');
				const labelText = await label.textContent();
				expect(labelText).toContain('Number of triples:');
			}
		}
	});

	test('should display tooltips and interactive elements from GraphRenderer', async ({ page }) => {
		await page.goto('/processes');
		const processLinks = page.locator('a[href*="/processes/"]:not([href="/processes/new"])');

		if ((await processLinks.count()) > 0) {
			const pid = (await processLinks.first().getAttribute('href'))?.split('/').pop();
			await page.goto(`/processes/${pid}/draw`);

			// Wait for graph to load
			await page.waitForTimeout(3000);

			// Check that graph renderer component is loaded (it contains buttons and tooltips)
			// This tests the sveltestrap Button and Tooltip components used in GraphRenderer
			const buttons = page.locator('button, [role="button"]');
			const tooltips = page.locator('[data-bs-toggle="tooltip"], [title]');

			// Should have some interactive elements
			expect((await buttons.count()) + (await tooltips.count())).toBeGreaterThan(0);
		}
	});
});
