import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SAMPLE_RECORD } from '../src/domain/sample';

// Opt-in local acceptance: private screenshots stay in ignored pic/, never in CI artifacts.
test('imports the supplied real screenshots with all reported missing fields', async ({ page }) => {
  test.setTimeout(120_000);
  const files = readdirSync('pic').filter(file => /\.png$/i.test(file)).map(file => resolve('pic', file));
  expect(files).toHaveLength(2);
  await page.goto('/');
  await page.getByLabel('上传两张跑步截图').setInputFiles(files);
  await page.getByLabel('截图气温单位').selectOption('celsius');
  await page.getByRole('button', { name: '开始识别并核对' }).click();
  await expect(page.getByRole('dialog', { name: '核对跑步记录' })).toBeVisible({ timeout: 100_000 });
  await expect(page.getByLabel('跑步距离（公里）', { exact: true })).toHaveValue(String(SAMPLE_RECORD.distanceKm));
  await expect(page.getByLabel('平均心率（次/分）', { exact: true })).toHaveValue(String(SAMPLE_RECORD.averageHeartRateBpm));
  await page.getByText('更多数据与分段记录', { exact: false }).click();
  for (const [label, value] of [
    ['平均功率（瓦）', SAMPLE_RECORD.averagePowerWatts], ['动态消耗（千卡）', SAMPLE_RECORD.activeCaloriesKcal],
    ['总消耗（千卡）', SAMPLE_RECORD.totalCaloriesKcal], ['运动强度（1–10）', SAMPLE_RECORD.effortLevel],
    ['气温（°C）', SAMPLE_RECORD.temperatureCelsius], ['湿度（%）', SAMPLE_RECORD.humidityPercent],
    ['空气质量指数', SAMPLE_RECORD.airQualityIndex], ['强度描述', SAMPLE_RECORD.effortDescription], ['地点', SAMPLE_RECORD.location],
  ] as const) await expect(page.getByLabel(label, { exact: true })).toHaveValue(String(value));
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('run-for-life:v1')!).records);
  expect(saved).toHaveLength(1);
  expect(saved[0].splits).toHaveLength(5);
  expect(saved[0].splits.at(-1).isPartialSplit).toBe(true);
});
