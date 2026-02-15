import { test, expect } from '@playwright/test';

test.describe('Database-Dependent Pages with Mock Data', () => {
  // Mock data for testing
  const mockProcesses = [
    {
      pid: 'test-process-1',
      status: 'completed',
      createdAt: new Date('2024-01-01T10:00:00Z').toISOString(),
      currentStep: {
        maxPathLength: 3,
        maxPathProps: 2,
        seeds: ['https://example.com/resource1']
      }
    },
    {
      pid: 'test-process-2',
      status: 'running',
      createdAt: new Date('2024-01-02T10:00:00Z').toISOString(),
      currentStep: {
        maxPathLength: 4,
        maxPathProps: 3,
        seeds: ['https://example.com/resource2']
      }
    }
  ];

  const mockDomains = [
    {
      origin: 'example.com',
      status: 'ready',
      lastAccessed: new Date('2024-01-01T10:00:00Z').toISOString(),
      crawl: {
        nextAllowed: new Date('2024-01-02T10:00:00Z').toISOString(),
        delay: 5,
        queued: 2,
        success: 10,
        ongoing: 1,
        failed: 0,
        pathHeads: 3
      },
      warnings: {
        E_ROBOTS_TIMEOUT: 1,
        E_RESOURCE_TIMEOUT: 0,
        E_DOMAIN_NOT_FOUND: 0,
        E_UNKNOWN: 2
      },
      robots: {
        status: 'done',
        checked: new Date('2024-01-01T09:00:00Z').toISOString()
      }
    },
    {
      origin: 'test.org',
      status: 'crawling',
      lastAccessed: new Date('2024-01-01T11:00:00Z').toISOString(),
      crawl: {
        nextAllowed: new Date('2024-01-03T10:00:00Z').toISOString(),
        delay: 10,
        queued: 5,
        success: 25,
        ongoing: 2,
        failed: 1,
        pathHeads: 7
      },
      warnings: {
        E_ROBOTS_TIMEOUT: 0,
        E_RESOURCE_TIMEOUT: 2,
        E_DOMAIN_NOT_FOUND: 0,
        E_UNKNOWN: 0
      },
      robots: {
        status: 'error',
        checked: new Date('2024-01-01T08:00:00Z').toISOString()
      }
    }
  ];

  test.describe('Processes List Page with Mock Data', () => {
    test('should display processes table with mock data', async ({ page }) => {
      // Mock the API call that loads processes
      await page.route('**/api/processes**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockProcesses)
        });
      });

      await page.goto('/processes');

      // Check page title
      await expect(page.getByRole('heading', { name: 'Processes' })).toBeVisible();

      // Check table headers
      await expect(page.getByRole('columnheader', { name: 'PID' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Max path length' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Max path props' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Submitted' })).toBeVisible();

      // Check that process data is displayed
      await expect(page.getByText('test-process-1')).toBeVisible();
      await expect(page.getByText('test-process-2')).toBeVisible();

      // Check status badges
      const badges = page.locator('.badge, [class*="badge"]');
      await expect(badges).toHaveCount(2);
    });

    test('should navigate to individual process page with mock data', async ({ page }) => {
      // Mock the API calls
      await page.route('**/api/processes**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockProcesses)
        });
      });

      // Mock the individual process API
      await page.route('**/api/processes/test-process-1**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...mockProcesses[0],
            steps: [mockProcesses[0].currentStep],
            notification: { email: 'test@example.com', webhook: '', ssePath: '/sse/test-process-1' }
          })
        });
      });

      await page.goto('/processes');

      // Click on a process link
      await page.getByRole('link', { name: 'test-process-1' }).click();

      // Should navigate to process detail page
      await expect(page).toHaveURL(/.*processes\/test-process-1/);

      // Check process detail elements
      await expect(page.getByRole('heading', { name: /Process.*test-process-1/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
    });
  });

  test.describe('Domains Page with Mock Data', () => {
    test('should display domains with mock data', async ({ page }) => {
      // Mock the domains API
      await page.route('**/api/domains**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockDomains)
        });
      });

      await page.goto('/domains');

      // Check page title
      await expect(page.getByRole('heading', { name: 'Domains' })).toBeVisible();

      // Check domain cards are displayed
      await expect(page.getByText('example.com')).toBeVisible();
      await expect(page.getByText('test.org')).toBeVisible();

      // Check status badges
      const statusBadges = page.locator('.badge, [class*="badge"]');
      await expect(statusBadges).toHaveCount(4); // 2 domains × 2 badges each (status + robots)
    });

    test('should handle search functionality with mock data', async ({ page }) => {
      await page.route('**/api/domains**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockDomains)
        });
      });

      await page.goto('/domains');

      // Test search functionality
      const searchInput = page.locator('input#searchInput');
      await searchInput.fill('example');

      // Should filter to show only example.com
      await expect(page.getByText('example.com')).toBeVisible();
      await expect(page.getByText('test.org')).toBeHidden();
    });

    test('should handle sorting with mock data', async ({ page }) => {
      await page.route('**/api/domains**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockDomains)
        });
      });

      await page.goto('/domains');

      // Test sorting by status
      const sortSelect = page.locator('select#sortField');
      await sortSelect.selectOption('status');

      // Check that sorting controls are present
      const ascButton = page.getByRole('button', { name: '↑ Asc' });
      const descButton = page.getByRole('button', { name: '↓ Desc' });
      await expect(ascButton).toBeVisible();
      await expect(descButton).toBeVisible();
    });
  });

  test.describe('Process Detail Page with Mock Data', () => {
    test('should display process details with mock data', async ({ page }) => {
      const mockProcessDetail = {
        ...mockProcesses[0],
        steps: [mockProcesses[0].currentStep],
        notification: {
          email: 'test@example.com',
          webhook: 'https://example.com/webhook',
          ssePath: '/sse/test-process-1'
        },
        timeToLastResource: '2h 30m',
        timeRunning: '5h 15m',
        updatedAt: new Date('2024-01-01T12:00:00Z').toISOString()
      };

      await page.route('**/api/processes/test-process-1**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockProcessDetail)
        });
      });

      await page.goto('/processes/test-process-1');

      // Check page elements
      await expect(page.getByRole('heading', { name: /Process.*test-process-1/ })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Details' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Steps' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();

      // Check status badge
      const statusBadge = page.locator('.badge, [class*="badge"]').first();
      await expect(statusBadge).toBeVisible();
      await expect(statusBadge).toContainText('completed');
    });

    test('should display triples download links', async ({ page }) => {
      const mockProcessDetail = {
        ...mockProcesses[0],
        steps: [mockProcesses[0].currentStep],
        notification: { email: '', webhook: '', ssePath: '/sse/test-process-1' }
      };

      await page.route('**/api/processes/test-process-1**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(mockProcessDetail)
        });
      });

      await page.goto('/processes/test-process-1');

      // Check download links
      const jsonLink = page.locator('a[href="/api/processes/test-process-1/triples.json.gz"]');
      const ntLink = page.locator('a[href="/api/processes/test-process-1/triples.nt.gz"]');

      await expect(jsonLink).toBeVisible();
      await expect(ntLink).toBeVisible();
      await expect(jsonLink).toContainText('JSON');
      await expect(ntLink).toContainText('N-Triples');
    });
  });

  test.describe('Process Draw Page with Mock Data', () => {
    test('should display graph page with mock data', async ({ page }) => {
      const mockGraphData = {
        nodes: [
          { id: 'node1', label: 'Resource 1', x: 100, y: 100 },
          { id: 'node2', label: 'Resource 2', x: 200, y: 200 }
        ],
        edges: [{ id: 'edge1', source: 'node1', target: 'node2' }]
      };

      await page.route('**/api/processes/test-process-1/triples.json.gz**', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              subject: { value: 'http://example.com/subject' },
              predicate: { value: 'http://example.com/predicate' },
              object: { value: 'http://example.com/object' },
              createdAt: '2024-01-01T10:00:00Z'
            }
          ])
        });
      });

      await page.goto('/processes/test-process-1/draw');

      // Check page loads (graph rendering may take time)
      await expect(page.getByRole('heading', { name: /Process.*test-process-1/ })).toBeVisible();

      // Check controls are present
      await expect(page.getByRole('button', { name: /Options/ })).toBeVisible();
    });
  });
});
