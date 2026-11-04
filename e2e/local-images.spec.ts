import { expect, test } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SAMPLE_RECORD } from '../src/domain/sample';

test('recovers pace and effort from image pixels when the initial text is unreadable', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class NoisyFirstPassWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        let handler: ((event: MessageEvent) => void) | null = null;
        let corrupted = false;
        Object.defineProperty(this, 'onmessage', { get: () => handler, set: callback => { handler = callback; } });
        this.addEventListener('message', event => {
          let message = event;
          if (event.data?.status === 'resolve' && event.data?.action === 'recognize') {
            document.documentElement.dataset.ocrCalls = String(Number(document.documentElement.dataset.ocrCalls ?? 0) + 1);
          }
          if (!corrupted && event.data?.status === 'resolve' && event.data?.action === 'recognize' && /平\s*均\s*配\s*[速束]/.test(event.data.data.text)) {
            corrupted = true;
            document.documentElement.dataset.paceMasked = 'yes';
            let text = event.data.data.text.replace(/\d{1,3}['′’]\d{2}['"″”]*\s*\/\s*(?:公\s*里|km)/g, '5 人');
            const withoutEffort = text.replace(/(耗\s*能[^\n]*\n)[\s\S]*?(?=单\s*段|$)/, '$1[无法辨认]\n');
            if (withoutEffort !== text) document.documentElement.dataset.effortMasked = 'yes';
            text = withoutEffort;
            message = new MessageEvent('message', { data: { ...event.data, data: { ...event.data.data, text } } });
          }
          handler?.(message);
        });
      }
    }
    window.Worker = NoisyFirstPassWorker;
  });
  const files = readdirSync('pic').filter(file => /\.png$/i.test(file)).map(file => resolve('pic', file));
  await page.goto('/');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '数据导入', exact: true }).click();
  await page.getByLabel('上传两张跑步截图').setInputFiles(files);
  await page.getByRole('button', { name: '开始识别并核对' }).click();
  await expect(page.getByRole('dialog', { name: '核对跑步记录' })).toBeVisible({ timeout: 100_000 });
  await expect(page.getByLabel('平均配速（分/公里）', { exact: true })).toHaveValue('6′55″');
  await expect(page.locator('html')).toHaveAttribute('data-pace-masked', 'yes');
  await expect(page.locator('html')).toHaveAttribute('data-effort-masked', 'yes');
  await page.getByText('更多数据与分段记录', { exact: false }).click();
  await expect(page.getByLabel('运动强度（1–10）', { exact: true })).toHaveValue(String(SAMPLE_RECORD.effortLevel));
  await expect(page.getByLabel('强度描述', { exact: true })).toHaveValue(SAMPLE_RECORD.effortDescription!);
  await page.getByText('查看识别文字', { exact: true }).click();
  const recoveredPrefixes = (await page.locator('.ocr-source pre').allTextContents()).map(text => text.split('\n\n')[0].replace(/\s/g, ''));
  expect(recoveredPrefixes.some(text => text.includes(`运动强度${SAMPLE_RECORD.effortLevel}${SAMPLE_RECORD.effortDescription}`))).toBe(true);
  expect(Number(await page.locator('html').getAttribute('data-ocr-calls'))).toBeGreaterThanOrEqual(4);
});

// Opt-in local acceptance: private screenshots stay in ignored pic/, never in CI artifacts.
test('fills every form field and every split from the supplied real screenshots', async ({ page }) => {
  test.setTimeout(120_000);
  const files = readdirSync('pic').filter(file => /\.png$/i.test(file)).map(file => resolve('pic', file));
  expect(files).toHaveLength(2);
  await page.goto('/');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '数据导入', exact: true }).click();
  await page.getByLabel('上传两张跑步截图').setInputFiles(files);
  await page.getByLabel('截图气温单位').selectOption('celsius');
  await page.getByRole('button', { name: '开始识别并核对' }).click();
  await expect(page.getByRole('dialog', { name: '核对跑步记录' })).toBeVisible({ timeout: 100_000 });
  await expect(page.getByLabel('运动日期', { exact: true })).toHaveValue(SAMPLE_RECORD.date!);
  await expect(page.getByRole('combobox', { name: '运动类型', exact: true })).toHaveValue(SAMPLE_RECORD.activityType!);
  await expect(page.getByLabel('运动时长', { exact: true })).toHaveValue('30:12');
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue(SAMPLE_RECORD.startTime!);
  await expect(page.getByLabel('结束时间', { exact: true })).toHaveValue(SAMPLE_RECORD.endTime!);
  await expect(page.getByLabel('平均配速（分/公里）', { exact: true })).toHaveValue('6′55″');
  await expect(page.getByLabel('平均步频（步/分）', { exact: true })).toHaveValue(String(SAMPLE_RECORD.averageCadenceSpm));
  await expect(page.getByLabel('时区', { exact: true })).toHaveValue('Asia/Shanghai');
  await expect(page.getByText('截图未注明时区，已按你的设置填入', { exact: false })).toBeVisible();
  await expect(page.getByLabel('跑步距离（公里）', { exact: true })).toHaveValue(String(SAMPLE_RECORD.distanceKm));
  await expect(page.getByLabel('平均心率（次/分）', { exact: true })).toHaveValue(String(SAMPLE_RECORD.averageHeartRateBpm));
  await page.getByText('更多数据与分段记录', { exact: false }).click();
  for (const [label, value] of [
    ['平均功率（瓦）', SAMPLE_RECORD.averagePowerWatts], ['动态消耗（千卡）', SAMPLE_RECORD.activeCaloriesKcal],
    ['总消耗（千卡）', SAMPLE_RECORD.totalCaloriesKcal], ['运动强度（1–10）', SAMPLE_RECORD.effortLevel],
    ['累计爬升（米）', SAMPLE_RECORD.elevationGainMeters],
    ['气温（°C）', SAMPLE_RECORD.temperatureCelsius], ['湿度（%）', SAMPLE_RECORD.humidityPercent],
    ['空气质量指数', SAMPLE_RECORD.airQualityIndex], ['强度描述', SAMPLE_RECORD.effortDescription], ['地点', SAMPLE_RECORD.location],
  ] as const) await expect(page.getByLabel(label, { exact: true })).toHaveValue(String(value));
  await expect(page.getByLabel('记录设备', { exact: true })).toHaveValue(SAMPLE_RECORD.source!);
  await expect(page.getByRole('textbox', { name: '获得奖章（每行一个）', exact: true })).toHaveValue(SAMPLE_RECORD.awards.join('\n'));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('run-for-life:v1') ?? '{"records":[]}').records.length)).toBe(0);
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('run-for-life:v1')!).records);
  expect(saved).toHaveLength(1);
  expect(saved[0].splits).toHaveLength(5);
  expect(saved[0].splits.at(-1).isPartialSplit).toBe(true);
  expect(saved[0]).toMatchObject(SAMPLE_RECORD);
});
