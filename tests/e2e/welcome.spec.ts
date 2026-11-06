import { expect, test, type Page } from '@playwright/test';

const KEY = 'schedrift.welcome-seen.v1';
const REPO = 'https://github.com/jervilangelo/schedrift';

async function openSample(page: Page) {
  await page.getByTestId('open-sample').click();
  await expect(page.getByTestId('gantt')).toBeVisible();
}

test('appears once after the first project opens, and Continue keeps the project', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome-card')).toHaveCount(0); // not before a project is loaded
  await openSample(page);
  const card = page.getByTestId('welcome-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Enjoying Schedrift?');
  await expect(card).toContainText('Jervil Angelo De Leon');
  await expect(card).toContainText('Free & Open Source · Made with care');
  await expect(page.getByTestId('welcome-continue')).toBeFocused();

  await page.getByTestId('welcome-continue').click();
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId('project-name')).toHaveText('Atlas ERP Rollout');
  await expect(page.getByTestId('golive-original')).toHaveText('Thu 11 Mar 2027');
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe('1');

  // Not again: neither on reload nor on another import.
  await page.reload();
  await openSample(page);
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('welcome-card')).toHaveCount(0);
});

test('Escape and the close button dismiss it', async ({ page }) => {
  await page.goto('/');
  await openSample(page);
  await expect(page.getByTestId('welcome-card')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('welcome-card')).toHaveCount(0);
  await expect(page.getByTestId('gantt')).toBeVisible();

  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await page.reload();
  await openSample(page);
  await page.getByTestId('welcome-card').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('welcome-card')).toHaveCount(0);
});

test('a click on the backdrop does not dismiss it', async ({ page }) => {
  await page.goto('/');
  await openSample(page);
  await expect(page.getByTestId('welcome-card')).toBeVisible();
  await page.mouse.click(8, 400);
  await expect(page.getByTestId('welcome-card')).toBeVisible();
});

test('Star on GitHub opens the repository in a new tab and keeps the session', async ({ page, context }) => {
  await context.route('https://github.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }));
  await page.goto('/');
  await openSample(page);
  const star = page.getByTestId('welcome-star');
  await expect(star).toHaveAttribute('href', REPO);
  await expect(star).toHaveAttribute('target', '_blank');
  await expect(star).toHaveAttribute('rel', /noopener/);
  const [popup] = await Promise.all([context.waitForEvent('page'), star.click()]);
  expect(popup.url()).toBe(REPO);
  await expect(page.getByTestId('welcome-card')).toHaveCount(0);
  await expect(page.getByTestId('project-name')).toHaveText('Atlas ERP Rollout');
});

test('does not appear after a failed import', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').first().setInputFiles({ name: 'broken.xml', mimeType: 'text/xml', buffer: Buffer.from('<nope/>') });
  await expect(page.getByTestId('notice')).toContainText('Could not import');
  await page.waitForTimeout(1200);
  await expect(page.getByTestId('welcome-card')).toHaveCount(0);
});

test('waits for the import report, and an export still downloads normally', async ({ page }) => {
  await page.goto('/');
  await openSample(page);
  await page.getByTestId('welcome-continue').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  expect(download.suggestedFilename()).toBe('Atlas-ERP-Rollout.schedrift.json');
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });
  test('opens and closes without waiting on animations', async ({ page }) => {
    await page.goto('/');
    await openSample(page);
    await expect(page.getByTestId('welcome-card')).toBeVisible();
    const duration = await page.getByTestId('welcome-card').evaluate((el) => (globalThis as unknown as { getComputedStyle(e: unknown): { animationDuration: string } }).getComputedStyle(el).animationDuration);
    expect(parseFloat(duration)).toBeLessThan(0.01);
    await page.getByTestId('welcome-continue').click();
    await expect(page.getByTestId('welcome-card')).toHaveCount(0);
  });
});

test('branding assets and favicons load', async ({ page, request }) => {
  for (const path of ['/favicon.svg', '/favicon.ico', '/favicon-32x32.png', '/apple-touch-icon.png', '/site.webmanifest', '/branding/svg/schedrift-logo-horizontal.svg']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
  await page.goto('/');
  const logo = page.getByTestId('brand').getByRole('img', { name: 'Schedrift' });
  await expect(logo).toBeVisible();
  const { w, h, nw, nh } = await logo.evaluate((el) => {
    const img = el as unknown as { clientWidth: number; clientHeight: number; naturalWidth: number; naturalHeight: number };
    return { w: img.clientWidth, h: img.clientHeight, nw: img.naturalWidth, nh: img.naturalHeight };
  });
  expect(Math.abs(w / h - nw / nh)).toBeLessThan(0.02); // proportions kept
  await expect(page.getByTestId('start-github')).toHaveAttribute('href', 'https://github.com/jervilangelo/schedrift');
});
