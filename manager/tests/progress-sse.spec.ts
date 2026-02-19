import { test, expect } from '@playwright/test';

test.describe('Process SSE Progress Endpoint', () => {
  test('should return event stream for running process', async ({ request }) => {
    const response = await request.fetch('/api/processes/test-process-1/events', {
      method: 'GET'
    });

    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('text/event-stream');
  });

  test('should emit PROGRESS events with correct structure', async ({ request }) => {
    const response = await request.fetch('/api/processes/test-process-1/events', {
      method: 'GET'
    });

    expect(response.ok()).toBe(true);

    const text = await response.text();
    const events = text.split('\n\n').filter(e => e.startsWith('data:'));

    expect(events.length).toBeGreaterThan(0);

    const firstEvent = events[0].replace('data: ', '');
    const parsed = JSON.parse(firstEvent);

    expect(parsed).toHaveProperty('type');
    expect(parsed).toHaveProperty('step');
    expect(parsed).toHaveProperty('paths');
    expect(parsed).toHaveProperty('rate');
    expect(parsed.paths).toHaveProperty('done');
    expect(parsed.paths).toHaveProperty('remaining');
  });

  test('should include step number in event', async ({ request }) => {
    const response = await request.fetch('/api/processes/test-process-1/events', {
      method: 'GET'
    });

    expect(response.ok()).toBe(true);

    const text = await response.text();
    const events = text.split('\n\n').filter(e => e.startsWith('data:'));

    const firstEvent = events[0].replace('data: ', '');
    const parsed = JSON.parse(firstEvent);

    expect(typeof parsed.step).toBe('number');
    expect(parsed.step).toBeGreaterThan(0);
  });

  test('should return 404 for non-existent process', async ({ request }) => {
    const response = await request.fetch('/api/processes/non-existent-process/events', {
      method: 'GET'
    });

    expect(response.status()).toBe(404);
  });
});
