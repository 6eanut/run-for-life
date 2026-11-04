import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_RECORD } from '../src/domain/sample';

const openImport = (page: Page) => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '数据导入', exact: true }).click();
const openStats = (page: Page) => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '统计', exact: true }).click();
const savedCount = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('run-for-life:v1') ?? '{"records":[]}').records.length);

test('switching from a long import journal returns statistics to the top', async ({ page }) => {
  const records = Array.from({ length: 12 }, (_, index) => ({ ...SAMPLE_RECORD, id: `scroll-${index}`, date: `2026-11-${String(index + 1).padStart(2, '0')}` }));
  await page.addInitScript(runs => localStorage.setItem('run-for-life:v1', JSON.stringify({ version: 1, records: runs })), records);
  await page.goto('/');
  await openImport(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await openStats(page);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByTestId('total-runs')).toBeInViewport();
});

// This is the public workflow: statistics and import are the only two destinations.
test('two-panel navigation separates statistics from importing and keeps an empty journey honest', async ({ page }) => {
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(navigation.getByRole('button')).toHaveCount(2);
  await expect(navigation.getByRole('button', { name: '统计', exact: true })).toBeVisible();
  await expect(navigation.getByRole('button', { name: '数据导入', exact: true })).toBeVisible();
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await expect(page.getByRole('button', { name: /选择两张跑步截图/ })).toHaveCount(0);
  await openImport(page);
  await expect(page.getByRole('button', { name: /选择两张跑步截图/ })).toBeVisible();
  await expect(page.getByRole('region', { name: '单次跑步趋势', exact: true })).toHaveCount(0);
  await openStats(page);
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  expect(await savedCount(page)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('preview does not save; confirmation persists; duplicate is blocked; edit and delete update totals', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await openImport(page);
  await page.getByRole('button', { name: '演示数据', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await savedCount(page)).toBe(0);
  await expect(page.getByLabel('运动时长', { exact: true })).toHaveValue('30:12');
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('completed-count')).toHaveText('1');
  await page.reload();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
  await openImport(page);
  await page.getByRole('button', { name: '演示数据', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByRole('alert')).toContainText('重复');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('button', { name: /查看或编辑/ }).click();
  await page.getByLabel('运动时长', { exact: true }).fill('29:59');
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await openImport(page);
  await page.getByRole('button', { name: /删除 2026/ }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  expect(await savedCount(page)).toBe(0);
  await openStats(page);
  await expect(page.getByTestId('completed-count')).toHaveText('0');
});

test('backup is previewed before importing and reimport is idempotent', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByRole('button', { name: '演示数据', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存' }).click();
  await openImport(page);
  await page.getByText(/备份与使用说明/).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出 JSON 备份/ }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await openImport(page);
  await page.getByLabel('导入 JSON 备份文件').setInputFiles(path!);
  await expect(page.getByRole('dialog', { name: '核对备份导入' })).toBeVisible();
  expect(await savedCount(page)).toBe(0);
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
  await openImport(page);
  await page.getByLabel('导入 JSON 备份文件').setInputFiles(path!);
  await expect(page.getByText('确定重复：1 条，将自动跳过。')).toBeVisible();
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
});

test('manual record, uncertain duplicate approval, and mobile width', async ({ page }) => {
  await page.goto('/');
  await openImport(page);
  await page.getByRole('button', { name: '手动记录', exact: true }).click();
  await page.getByLabel('运动日期', { exact: true }).fill('2026-11-02');
  await page.getByLabel('运动时长', { exact: true }).fill('30:00');
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
  await openImport(page);
  await page.getByRole('button', { name: '手动记录', exact: true }).click();
  await page.getByLabel('运动日期', { exact: true }).fill('2026-11-02');
  await page.getByLabel('运动时长', { exact: true }).fill('30:00');
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByRole('alert')).toContainText('相似');
  await page.getByRole('checkbox', { name: /另一场训练/ }).check();
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('dated trends keep chronology, support metric changes and leave absent measurements blank', async ({ page }) => {
  const records = [
    { ...SAMPLE_RECORD, id: 'latest', date: '2026-11-10', startTime: '18:00', distanceKm: 5.5, averagePaceSecondsPerKm: 390, averageHeartRateBpm: 155 },
    { ...SAMPLE_RECORD, id: 'first', date: '2026-10-01', startTime: '08:00', distanceKm: 3.2, averagePaceSecondsPerKm: 450, averageHeartRateBpm: 165 },
    { ...SAMPLE_RECORD, id: 'middle', date: '2026-11-02', startTime: '20:58', distanceKm: 4.36, averageHeartRateBpm: null },
  ];
  await page.addInitScript(runs => localStorage.setItem('run-for-life:v1', JSON.stringify({ version: 1, records: runs })), records);
  await page.goto('/');
  await expect(page.getByTestId('completed-count')).toHaveText('3');
  await expect(page.getByTestId('total-runs')).toHaveText('3');
  await expect(page.getByTestId('total-distance')).toHaveText('13.06');
  const trends = page.getByRole('region', { name: '单次跑步趋势', exact: true });
  await expect(trends).toBeVisible();
  await trends.getByRole('combobox', { name: '趋势指标', exact: true }).selectOption({ label: '平均心率' });
  await trends.getByText('查看图表数据', { exact: true }).click();
  const table = page.getByRole('table', { name: '单次跑步趋势数据', exact: true });
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('2026-10-01');
  await expect(rows.nth(1)).toContainText('2026-11-02');
  await expect(rows.nth(1)).toContainText('未记录');
  await expect(rows.nth(2)).toContainText('2026-11-10');
  const selector = trends.getByRole('slider', { name: '选择跑步记录', exact: true });
  await selector.focus();
  await selector.press('End');
  await expect(trends.getByRole('status')).toContainText('155');
  await trends.getByRole('button', { name: '上一次跑步', exact: true }).click();
  await expect(trends.getByRole('status')).toContainText('未记录');
  await trends.getByRole('button', { name: '上一次跑步', exact: true }).click();
  await expect(trends.getByRole('status')).toContainText('165');
  await trends.getByRole('combobox', { name: '趋势指标', exact: true }).selectOption({ label: '平均配速' });
  await expect(rows.nth(0)).toContainText('7′30″');
  await expect(rows.nth(2)).toContainText('6′30″');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
