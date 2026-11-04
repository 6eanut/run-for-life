import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_RECORD } from '../src/domain/sample';

// The data module fixes "today" via the browser clock; every run is seeded into storage.
const TODAY = new Date(2026, 10, 4, 12, 0, 0); // 2026-11-04, browser local time
const seed = (page: Page, records: unknown[]) =>
  page.addInitScript(runs => localStorage.setItem('run-for-life:v1', JSON.stringify({ version: 1, records: runs })), records);

const run = (overrides: Record<string, unknown>) => ({ ...SAMPLE_RECORD, ...overrides });

const rangeSelect = (page: Page) => page.getByRole('combobox', { name: '统计时间范围', exact: true });
const period = (page: Page) => page.getByRole('region', { name: '期间汇总', exact: true });
const calendar = (page: Page) => page.getByRole('region', { name: '12周跑步日历', exact: true });

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(TODAY); });

test('custom range filters the period, calendar and trends while lifetime totals stay complete', async ({ page }) => {
  const records = [
    run({ id: 'a', date: '2026-09-15', startTime: '07:00', distanceKm: 3 }),
    run({ id: 'b', date: '2026-10-20', startTime: '08:00', distanceKm: 4 }),
    run({ id: 'c', date: '2026-11-01', startTime: '09:00', distanceKm: 5 }),
    run({ id: 'd', date: '2026-11-03', startTime: '18:00', distanceKm: 6 }),
  ];
  await seed(page, records);
  await page.goto('/');

  // Lifetime band at the top of the app keeps every record.
  await expect(page.getByTestId('total-runs')).toHaveText('4');
  await expect(page.getByTestId('total-distance')).toHaveText('18.00');

  // Presets apply immediately; default is all.
  await expect(rangeSelect(page)).toHaveValue('all');

  await rangeSelect(page).selectOption('custom');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-10-15');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-11-02');
  await page.getByRole('button', { name: '应用时间范围', exact: true }).click();

  const applied = page.getByTestId('applied-range');
  await expect(applied).toContainText('2026.10.15');
  await expect(applied).toContainText('2026.11.02');
  await expect(applied).toContainText('2 条记录');

  await expect(period(page).getByTestId('period-runs')).toHaveText('2');
  await expect(period(page).getByTestId('period-distance')).toHaveText('9.00');
  await expect(period(page).getByTestId('period-active-days')).toHaveText('2');

  // Lifetime numbers do not move when a period is selected.
  await expect(page.getByTestId('total-runs')).toHaveText('4');
  await expect(page.getByTestId('total-distance')).toHaveText('18.00');

  // The trend table follows the same range.
  const trends = page.getByRole('region', { name: '单次跑步趋势', exact: true });
  await trends.getByText('查看图表数据', { exact: true }).click();
  const rows = page.getByRole('table', { name: '单次跑步趋势数据', exact: true }).locator('tbody tr');
  await expect(rows).toHaveCount(2);

  // Records before the start of the range are shown as outside, not as rest days.
  await expect(calendar(page).getByRole('button', { name: /2026年9月15日/ })).toHaveAttribute('aria-disabled', 'true');
});

test('an unknown distance is never faked as zero kilometres', async ({ page }) => {
  const records = [
    run({ id: 'known', date: '2026-10-20', startTime: '08:00', distanceKm: 4 }),
    run({ id: 'unknown', date: '2026-10-25', startTime: '08:00', durationSeconds: 2000, distanceKm: null, averagePaceSecondsPerKm: null }),
  ];
  await seed(page, records);
  await page.goto('/');

  await rangeSelect(page).selectOption('90d');
  await expect(period(page).getByTestId('period-runs')).toHaveText('2');
  await expect(period(page).getByTestId('period-distance')).toHaveText('4.00');
  await expect(page.getByTestId('period-distance-note')).toContainText('1 次距离未记录');
});

test('a day with several runs lists each training in the selected-day panel', async ({ page }) => {
  const records = [
    run({ id: 'm1', date: '2026-11-03', startTime: '07:10', distanceKm: 3, durationSeconds: 1200 }),
    run({ id: 'm2', date: '2026-11-03', startTime: '19:40', distanceKm: 5, durationSeconds: 1900 }),
  ];
  await seed(page, records);
  await page.goto('/');

  const cell = calendar(page).getByRole('button', { name: /2026年11月3日/ });
  await expect(cell).toHaveAttribute('aria-label', /2 次跑步/);
  await cell.click();
  const detail = page.getByTestId('selected-day');
  await expect(detail).toContainText('2026年11月3日');
  await expect(detail).toContainText('07:10');
  await expect(detail).toContainText('19:40');
  await expect(detail).toContainText('3.00');
  await expect(detail).toContainText('5.00');
});

test('an invalid or reversed custom range shows a friendly error and keeps the applied range', async ({ page }) => {
  const records = [run({ id: 'b', date: '2026-10-20', startTime: '08:00', distanceKm: 4 })];
  await seed(page, records);
  await page.goto('/');

  await rangeSelect(page).selectOption('custom');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-10-15');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-30');
  await page.getByRole('button', { name: '应用时间范围', exact: true }).click();
  await expect(page.getByTestId('applied-range')).toContainText('2026.10.15');

  // Reversed range: error shown, previous range still applied.
  await page.getByLabel('开始日期', { exact: true }).fill('2026-11-01');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: '应用时间范围', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('开始日期');
  await expect(page.getByTestId('applied-range')).toContainText('2026.10.15');
  await expect(page.getByTestId('applied-range')).toContainText('2026.10.30');

  // A cleared date is an invalid custom range: error shown, previous range intact.
  await page.getByLabel('开始日期', { exact: true }).fill('');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-12-01');
  await page.getByRole('button', { name: '应用时间范围', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('applied-range')).toContainText('2026.10.15');
  await expect(page.getByTestId('applied-range')).toContainText('2026.10.30');
});

test('the calendar fits a 320px viewport without horizontal overflow', async ({ page }) => {
  await seed(page, [run({ id: 'b', date: '2026-11-01', startTime: '08:00' })]);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await expect(calendar(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await expect(page.getByText('按已导入的记录展示，空格不代表必须跑')).toBeVisible();
});

test('an empty period shows a gentle empty state instead of fake numbers', async ({ page }) => {
  await page.goto('/');
  const empty = period(page).getByRole('status');
  await expect(empty).toContainText('这段时间还没有跑步记录');
  await expect(period(page).getByTestId('period-runs')).toHaveText('0');
  await expect(period(page).getByTestId('period-active-days')).toHaveText('0');
  await expect(page.getByTestId('applied-range')).toContainText('全部记录');
  await expect(page.getByTestId('applied-range')).toContainText('0 条记录');
});

test('changing the range resets a selection that is no longer inside it', async ({ page }) => {
  const records = [
    run({ id: 'a', date: '2026-09-15', startTime: '07:00', distanceKm: 3 }),
    run({ id: 'b', date: '2026-10-20', startTime: '08:00', distanceKm: 4 }),
    run({ id: 'c', date: '2026-11-01', startTime: '09:00', distanceKm: 5 }),
    run({ id: 'd', date: '2026-11-03', startTime: '18:00', distanceKm: 6 }),
  ];
  await seed(page, records);
  await page.goto('/');

  await calendar(page).getByRole('button', { name: /2026年9月15日/ }).click();
  await expect(page.getByTestId('selected-day')).toContainText('2026年9月15日');

  // Apply a range that excludes 9/15; the stale selection must not linger as "no runs".
  await rangeSelect(page).selectOption('custom');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-10-15');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-11-02');
  await page.getByRole('button', { name: '应用时间范围', exact: true }).click();

  const detail = page.getByTestId('selected-day');
  await expect(detail).not.toContainText('2026年9月15日');
  await expect(detail).toContainText('2026年11月1日'); // most recent run inside the new range
  await expect(detail).not.toContainText('这一天没有跑步记录');
});

test('the selected day cell reports aria-pressed and updates on selection', async ({ page }) => {
  const records = [
    run({ id: 'a', date: '2026-11-01', startTime: '08:00', distanceKm: 4 }),
    run({ id: 'b', date: '2026-11-03', startTime: '09:00', distanceKm: 5 }),
  ];
  await seed(page, records);
  await page.goto('/');

  const nov1 = calendar(page).getByRole('button', { name: /2026年11月1日/ });
  const nov3 = calendar(page).getByRole('button', { name: /2026年11月3日/ });
  // Default selection is the most recent recorded day.
  await expect(nov3).toHaveAttribute('aria-pressed', 'true');
  await expect(nov1).toHaveAttribute('aria-pressed', 'false');
  await nov1.click();
  await expect(nov1).toHaveAttribute('aria-pressed', 'true');
  await expect(nov3).toHaveAttribute('aria-pressed', 'false');
});

test('the calendar names the exact date span it covers', async ({ page }) => {
  await seed(page, [run({ id: 'a', date: '2026-11-01', startTime: '08:00' })]);
  await page.goto('/');
  const span = page.getByTestId('calendar-span');
  await expect(span).toContainText('2026年8月17日');
  await expect(span).toContainText('2026年11月8日');
});

test('a thousand hours of running still fits a 320px viewport', async ({ page }) => {
  const base = new Date(2026, 6, 1); // 2026-07-01
  const records = Array.from({ length: 120 }, (_, index) => {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + index);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return run({ id: `bulk-${index}`, date: iso, startTime: '07:00', durationSeconds: 30000, distanceKm: 10 });
  });
  await seed(page, records);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');

  const duration = period(page).getByTestId('period-duration');
  await expect(duration).toHaveText('1000.0');
  await expect(period(page).getByTestId('period-duration-unit')).toHaveText('小时');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  const right = await duration.evaluate(el => el.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(320);
});

test('the period note explains that calories and elevation only sum recorded data', async ({ page }) => {
  await seed(page, [run({ id: 'a', date: '2026-11-01', startTime: '08:00', distanceKm: 4 })]);
  await page.goto('/');
  await expect(period(page)).toContainText('已记录');
});

test('selecting a recorded-free day keeps the day picker and detail in sync', async ({ page }) => {
  await seed(page, [run({ id: 'a', date: '2026-11-01', startTime: '08:00', distanceKm: 4 })]);
  await page.goto('/');

  const select = page.getByRole('combobox', { name: '选择日历中的日期', exact: true });
  // With runs present the picker lists recorded days only; the default is the latest one.
  await expect(select).toHaveValue('2026-11-01');

  await calendar(page).getByRole('button', { name: /2026年11月4日/ }).click();
  await expect(select).toHaveValue('2026-11-04');
  const selectedOption = select.locator('option:checked');
  await expect(selectedOption).toContainText('2026年11月4日');
  await expect(selectedOption).toContainText('没有记录');
  await expect(page.getByTestId('selected-day')).toContainText('2026年11月4日');

  // Returning to the recorded day restores the recorded state.
  await select.selectOption('2026-11-01');
  await expect(page.getByTestId('selected-day')).toContainText('2026年11月1日');
  await expect(page.getByTestId('selected-day')).not.toContainText('这一天没有跑步记录');
});
