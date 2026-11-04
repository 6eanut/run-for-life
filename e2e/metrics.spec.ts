import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_RECORD } from '../src/domain/sample';

// Trends render inside the statistics page and read every stored numeric field. These
// tests seed the fields directly so each new metric can be checked against its own
// column, including honest handling of negative temperatures and true zeroes.
const TODAY = new Date(2026, 10, 4, 12, 0, 0); // 2026-11-04, browser local time
const seed = (page: Page, records: unknown[]) =>
  page.addInitScript(runs => localStorage.setItem('run-for-life:v1', JSON.stringify({ version: 1, records: runs })), records);

const run = (overrides: Record<string, unknown>) => ({ ...SAMPLE_RECORD, ...overrides });

const trends = (page: Page) => page.getByRole('region', { name: '单次跑步趋势', exact: true });
const metricSelect = (page: Page) => trends(page).getByRole('combobox', { name: '趋势指标', exact: true });
const dataTable = (page: Page) => trends(page).getByRole('table', { name: '单次跑步趋势数据', exact: true });
const openTable = async (page: Page) => {
  if (!(await dataTable(page).isVisible())) await trends(page).getByText('查看图表数据', { exact: true }).click();
  await expect(dataTable(page)).toBeVisible();
  return dataTable(page);
};
const choose = async (page: Page, label: string) => {
  await metricSelect(page).selectOption({ label });
  return openTable(page);
};
// The value column is the last cell; targeting it avoids matching digits in the date.
const valueCells = (page: Page) => dataTable(page).locator('tbody tr td:last-child');

// SAMPLE_RECORD has a value for every numeric field, so it proves each id reads its own column.
const SAMPLE_WITHOUT_WEATHER: Record<string, unknown> = {
  activeCaloriesKcal: null, totalCaloriesKcal: null, elevationGainMeters: null,
  effortLevel: null, temperatureCelsius: null, humidityPercent: null, airQualityIndex: null,
};

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(TODAY); });

test('the metric picker groups all thirteen metrics and keeps the original labels', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');

  const groups = metricSelect(page).locator('optgroup');
  await expect(groups).toHaveCount(3);
  await expect(groups.nth(0)).toHaveAttribute('label', '训练表现');
  await expect(groups.nth(1)).toHaveAttribute('label', '消耗与爬升');
  await expect(groups.nth(2)).toHaveAttribute('label', '强度与环境');

  // Original wording stays so older flows keep matching by label.
  await expect(metricSelect(page).locator('option')).toHaveCount(13);
  for (const label of ['跑步距离', '平均配速', '平均心率', '运动时长', '平均步频', '平均功率',
    '动态消耗', '总消耗', '累计爬升', '运动强度', '气温', '湿度', '空气质量指数']) {
    await expect(metricSelect(page).locator(`option:has-text("${label}")`)).toHaveCount(1);
  }
});

test('each new metric reads its own stored column and shows honest recorded counts', async ({ page }) => {
  await seed(page, [
    run({ id: 'old', date: '2026-10-20', startTime: '08:00', ...SAMPLE_WITHOUT_WEATHER }),
    run({ id: 'new', date: '2026-11-02', startTime: '20:58' }),
  ]);
  await page.goto('/');

  // Only the latest run recorded weather, so 1 / 2 is stated quietly in the notes.
  await choose(page, '气温');
  await expect(trends(page).getByText(/该指标 1 \/ 2 次有记录/)).toBeVisible();
  await expect(valueCells(page).nth(0)).toHaveText('未记录');
  await expect(valueCells(page).nth(1)).toHaveText('10');

  await choose(page, '动态消耗');
  await expect(valueCells(page).nth(0)).toHaveText('未记录');
  await expect(valueCells(page).nth(1)).toHaveText('279');

  await choose(page, '总消耗');
  await expect(valueCells(page).nth(1)).toHaveText('324');

  await choose(page, '累计爬升');
  await expect(valueCells(page).nth(1)).toHaveText('9');

  await choose(page, '运动强度');
  await expect(valueCells(page).nth(1)).toHaveText('6');

  await choose(page, '湿度');
  await expect(valueCells(page).nth(1)).toHaveText('60');

  await choose(page, '空气质量指数');
  await expect(valueCells(page).nth(1)).toHaveText('95');
});

test('the change note uses a meaningful unit for effort and humidity', async ({ page }) => {
  await seed(page, [
    run({ id: 'first', date: '2026-10-20', startTime: '08:00', effortLevel: 4, humidityPercent: 60, averagePaceSecondsPerKm: 460 }),
    run({ id: 'last', date: '2026-11-02', startTime: '20:58', effortLevel: 6.5, humidityPercent: 70, averagePaceSecondsPerKm: 400 }),
  ]);
  await page.goto('/');

  await choose(page, '运动强度');
  await expect(trends(page).locator('.trend-difference')).toHaveText('最新较最早有数据的记录 +2.5 分');

  await choose(page, '湿度');
  await expect(trends(page).locator('.trend-difference')).toHaveText('最新较最早有数据的记录 +10 个百分点');

  await choose(page, '平均配速');
  await expect(trends(page).locator('.trend-difference')).toHaveText('最新较最早有数据的记录快 1′00″/公里');
});

test('negative winter temperatures are plotted instead of dropped', async ({ page }) => {
  await seed(page, [
    run({ id: 'cold', date: '2026-01-15', startTime: '07:00', temperatureCelsius: -12.5 }),
    run({ id: 'mild', date: '2026-02-15', startTime: '07:00', temperatureCelsius: 0 }),
    run({ id: 'warm', date: '2026-03-15', startTime: '07:00', temperatureCelsius: 8 }),
  ]);
  await page.goto('/');

  await choose(page, '气温');
  const cells = valueCells(page);
  await expect(dataTable(page).locator('tbody tr')).toHaveCount(3);
  await expect(cells.nth(0)).toHaveText('-12.5'); // kept, not treated as missing
  await expect(cells.nth(1)).toHaveText('0'); // a true zero is a real reading
  await expect(cells.nth(2)).toHaveText('8');

  // The plotted dots exist for all three, and the axis admits negative values.
  await expect(trends(page).locator('svg circle')).toHaveCount(3);
  await expect(trends(page).getByText(/该指标 3 \/ 3 次有记录/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('zero calories, humidity and AQI are real values, not blank', async ({ page }) => {
  await seed(page, [
    run({ id: 'zero', date: '2026-11-01', startTime: '08:00', activeCaloriesKcal: 0, humidityPercent: 0, airQualityIndex: 0, totalCaloriesKcal: 0 }),
    run({ id: 'some', date: '2026-11-02', startTime: '08:00', activeCaloriesKcal: 300, humidityPercent: 60, airQualityIndex: 95, totalCaloriesKcal: 350 }),
  ]);
  await page.goto('/');

  await choose(page, '动态消耗');
  await expect(valueCells(page).nth(0)).toHaveText('0');
  await expect(valueCells(page).nth(0)).not.toHaveText('未记录');

  await choose(page, '湿度');
  await expect(valueCells(page).nth(0)).toHaveText('0');

  await choose(page, '空气质量指数');
  await expect(valueCells(page).nth(0)).toHaveText('0');
});

test('a single run still shows every metric that was recorded', async ({ page }) => {
  await seed(page, [run({ id: 'lonely', date: '2026-11-03', startTime: '18:00' })]);
  await page.goto('/');

  for (const label of ['动态消耗', '总消耗', '累计爬升', '运动强度', '气温', '湿度', '空气质量指数']) {
    await choose(page, label);
    await expect(valueCells(page)).toHaveCount(1);
    await expect(valueCells(page).nth(0)).not.toHaveText('未记录');
  }
  await expect(trends(page).getByText(/该指标 1 \/ 1 次有记录/)).toBeVisible();
});

test('the new metrics fit a 320px viewport without horizontal overflow', async ({ page }) => {
  await seed(page, [
    run({ id: 'a', date: '2026-11-01', startTime: '08:00', temperatureCelsius: -12.5, humidityPercent: 60.5, effortLevel: 6.5 }),
    run({ id: 'b', date: '2026-11-02', startTime: '08:00', temperatureCelsius: 0, humidityPercent: 0, effortLevel: 1 }),
  ]);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');

  await choose(page, '气温');
  await expect(trends(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  const select = metricSelect(page);
  const box = await select.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});
