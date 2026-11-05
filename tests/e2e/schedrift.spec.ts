import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MPP = join(process.cwd(), 'tests/fixtures/mpxj/mpp14relations.mpp');

async function openSample(page: Page) {
  await page.goto('/');
  await page.getByTestId('open-sample').click();
  await expect(page.getByTestId('gantt')).toBeVisible();
  await expect(page.getByTestId('golive-original')).toHaveText('Thu 11 Mar 2027');
}

function row(page: Page, name: string) {
  return page.locator('[role=row][data-uid]').filter({ hasText: name }).first();
}

async function delay(page: Page, task: string, field: 'Start delay' | 'Duration extension', days: number) {
  const input = page.getByLabel(`${field} for ${task}`, { exact: true });
  await input.fill(String(days));
  await input.press('Enter');
}

test('imports the sample and draws the Gantt chart with critical path and dependencies', async ({ page }) => {
  await openSample(page);
  await expect(page.getByTestId('project-name')).toHaveText('Atlas ERP Rollout');
  await expect(row(page, 'User acceptance testing (UAT)')).toBeVisible();
  // dependency arrows and critical bars are drawn
  expect(await page.locator('[data-link]').count()).toBeGreaterThan(10);
  expect(await page.locator('g[data-critical]').count()).toBeGreaterThan(3);
  await expect(page.getByTestId('impact-strip')).toContainText('Critical tasks');
});

test('expands and collapses phases, switches Executive/Detailed and zoom', async ({ page }) => {
  await openSample(page);
  const rows = page.locator('[role=row][data-uid]');
  const before = await rows.count();
  await page.getByRole('button', { name: 'Collapse Build' }).click();
  await expect(row(page, 'System configuration')).toHaveCount(0);
  expect(await rows.count()).toBe(before - 5);
  await page.getByRole('button', { name: 'Expand Build' }).click();
  await expect(row(page, 'System configuration')).toBeVisible();

  await page.getByRole('radio', { name: 'Executive' }).click();
  await expect(row(page, 'Go-Live')).toBeVisible();
  await expect(row(page, 'System configuration')).toHaveCount(0);
  await expect(row(page, 'Build complete')).toBeVisible();
  await page.getByRole('radio', { name: 'Detailed' }).click();

  await page.getByRole('radio', { name: 'Weeks' }).click();
  await expect(page.getByRole('radio', { name: 'Weeks' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Quarters' }).click();
  await expect(page.getByRole('radio', { name: 'Quarters' })).toHaveAttribute('aria-checked', 'true');
});

test('selecting a task shows its scheduling details', async ({ page }) => {
  await openSample(page);
  await row(page, 'Training materials').click();
  const panel = page.getByTestId('task-details');
  await expect(panel).toContainText('Training materials');
  await expect(panel).toContainText('System configuration'); // predecessor
  await expect(panel).toContainText('End-user training'); // successor
  await expect(panel).toContainText('52 days'); // total float
  await expect(panel).not.toContainText('Critical');
});

test('single-task delay on a critical task moves Go-Live and shows the chain', async ({ page }) => {
  await openSample(page);
  await row(page, 'User acceptance testing (UAT)').click();
  await delay(page, 'User acceptance testing (UAT)', 'Start delay', 10);
  await page.getByTestId('run-simulation').click();
  await expect(page.getByTestId('golive-simulated')).toHaveText('Thu 25 Mar 2027');
  await expect(page.getByTestId('golive-variance')).toHaveText('+10 days');
  await expect(page.getByTestId('impact-summary')).toContainText('User acceptance testing (UAT) → UAT sign-off');
  await expect(page.getByTestId('drift-band')).toHaveCount(1);
  expect(await page.locator('g[data-state=changed]').count()).toBeGreaterThan(3);
  expect(await page.getByTestId('compare-bar').count()).toBeGreaterThan(3);
  // tasks off the chain are untouched
  await expect(row(page, 'Training materials')).not.toHaveClass(/opacity/);

  await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /^Simulation/ }).click();
  await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /^Simulation/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('driving-chain')).toContainText('Production migration');
  await expect(page.getByText('No longer critical')).toBeVisible();
});

test('a delay within float is absorbed', async ({ page }) => {
  await openSample(page);
  await row(page, 'Training materials').click();
  await delay(page, 'Training materials', 'Start delay', 10);
  await page.getByTestId('run-simulation').click();
  await expect(page.getByTestId('golive-variance')).toHaveText('0 days');
  await expect(page.getByTestId('impact-summary')).toContainText('absorbs');
});

test('multiple-task scenario does not double count overlapping delays', async ({ page }) => {
  await openSample(page);
  await row(page, 'User acceptance testing (UAT)').click();
  await row(page, 'Production migration').click({ modifiers: ['Control'] });
  await delay(page, 'User acceptance testing (UAT)', 'Start delay', 5);
  await delay(page, 'Production migration', 'Start delay', 3);
  await page.getByTestId('run-simulation').click();
  await expect(page.getByTestId('golive-variance')).toHaveText('+5 days');

  // Reset restores the original schedule
  await page.getByTestId('reset-simulation').click();
  await expect(page.getByTestId('golive-simulated')).toHaveText('—');
  await expect(page.locator('g[data-state=changed]')).toHaveCount(0);
});

test('duration extensions on a chain add up', async ({ page }) => {
  await openSample(page);
  await row(page, 'Cutover rehearsal').click();
  await row(page, 'Production migration').click({ modifiers: ['Control'] });
  await delay(page, 'Cutover rehearsal', 'Duration extension', 2);
  await delay(page, 'Production migration', 'Duration extension', 1);
  await page.getByTestId('run-simulation').click();
  await expect(page.getByTestId('golive-variance')).toHaveText('+3 days');
});

test('editing dependencies recalculates and rejects cycles', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: 'Project data' }).click();
  await expect(page.getByTestId('validation-panel')).toContainText('23 of 23');

  // Cycle: make System integration testing depend on Go-Live (ID 26)
  const preds = page.getByRole('button', { name: /^Predecessors of System integration testing/ });
  await preds.click();
  const input = page.getByRole('textbox', { name: 'Predecessors of System integration testing' });
  await input.fill('15; 26');
  await input.press('Enter');
  await expect(page.getByTestId('notice')).toContainText('circular dependency');
  await input.press('Escape');

  // Valid edit through the dialog: add a 5-day lag to UAT sign-off → Cutover rehearsal
  await page.getByRole('button', { name: 'Edit dependencies of Cutover rehearsal' }).click();
  await page.getByLabel('Lag in working days').first().fill('5');
  await page.getByTestId('save-dependencies').click();
  await expect(page.getByTestId('golive-original')).toHaveText('Thu 18 Mar 2027');
  await expect(page.locator('tr[data-uid="24"]')).toContainText('+5d');
});

test('saves locally and reopens with the scenario', async ({ page }) => {
  await openSample(page);
  await row(page, 'User acceptance testing (UAT)').click();
  await delay(page, 'User acceptance testing (UAT)', 'Start delay', 4);
  await page.getByTestId('run-simulation').click();
  await page.getByTestId('save-button').click();
  await expect(page.getByTestId('notice')).toContainText('saved');

  await page.goto('/');
  await page.getByTestId('recent-list').getByText('Atlas ERP Rollout').first().click();
  await expect(page.getByTestId('golive-variance')).toHaveText('+4 days');
  await expect(page.getByTestId('golive-original')).toHaveText('Thu 11 Mar 2027');
});

test('presentation mode', async ({ page }) => {
  await openSample(page);
  await page.getByTestId('present-button').click();
  await expect(page.getByTestId('presentation')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-present', 'true');
  const h = await row(page, 'Go-Live').evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBe(40);
  await page.getByRole('button', { name: 'Hide task list' }).click();
  await expect(page.locator('[role=treegrid]')).toHaveCount(0);
  await page.getByTestId('exit-present').click();
  await expect(page.getByTestId('presentation')).toHaveCount(0);
});

test('rejects a file that is not a project', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').first().setInputFiles({ name: 'notes.xml', mimeType: 'text/xml', buffer: Buffer.from('<html><body>hello</body></html>') });
  await expect(page.getByTestId('notice')).toContainText('not a Microsoft Project XML');
  await page.getByTestId('file-input').first().setInputFiles({ name: 'fake.mpp', mimeType: 'application/octet-stream', buffer: Buffer.from('definitely not an mpp') });
  await expect(page.getByTestId('notice')).toContainText('Could not import fake.mpp');
});

test('reports circular dependencies on import without failing', async ({ page }) => {
  const xml = readFileSync(join(process.cwd(), 'public/samples/atlas-erp-rollout.xml'), 'utf8').replace(
    '<UID>3</UID>',
    '<UID>3</UID>\n      <PredecessorLink><PredecessorUID>6</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>',
  );
  await page.goto('/');
  await page.getByTestId('file-input').first().setInputFiles({ name: 'cycle.xml', mimeType: 'text/xml', buffer: Buffer.from(xml) });
  await expect(page.getByTestId('import-report')).toContainText('Circular dependencies');
  await page.getByRole('button', { name: 'Continue to timeline' }).click();
  await expect(page.getByTestId('gantt')).toBeVisible();
});

test('imports a real .mpp file through MPXJ', async ({ page, request }) => {
  const status = await (await request.get('/api/status')).json();
  test.skip(!status.mpp || !existsSync(MPP), 'MPXJ runtime or fixture missing (run npm run setup && npm run fixtures)');
  await page.goto('/');
  await page.getByTestId('file-input').first().setInputFiles(MPP);
  await expect(page.getByTestId('gantt')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('project-name')).toBeVisible();
  await expect(page.locator('[role=row][data-uid]')).toHaveCount(5);
  await row(page, 'Task 2').click();
  await expect(page.getByTestId('task-details')).toContainText('Task 1');
});
