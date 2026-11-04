import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { SAMPLE_RECORD } from '../src/domain/sample';

// Minimal RFC-4180 reader so tests assert on parsed cells, not raw substrings.
function parseCsv(text: string): string[][] {
  const body = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && body[i + 1] === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; i += 1; }
    else if (ch === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const asObject = (rows: string[][], index = 1): Record<string, string> =>
  Object.fromEntries(rows[0].map((header, column) => [header, rows[index]?.[column]]));

const seed = (page: Page, records: unknown[]) =>
  page.addInitScript(runs => localStorage.setItem('run-for-life:v1', JSON.stringify({ version: 1, records: runs })), records);
const run = (overrides: Record<string, unknown>) => ({ ...SAMPLE_RECORD, ...overrides });

const openBackup = async (page: Page) => {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '数据导入', exact: true }).click();
  await page.getByText(/备份与使用说明/).click();
};
const downloadText = async (download: Download) => {
  const path = await download.path();
  return readFile(path!, 'utf8');
};
const grab = async (page: Page, name: string) => {
  const started = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  return downloadText(await started);
};

test('runs CSV downloads with a single BOM, CRLF, Chinese headers and the sample figures', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openBackup(page);
  const text = await grab(page, '导出训练 CSV');

  // Envelope: exactly one BOM at the very start, CRLF row endings.
  expect(text.startsWith('\uFEFF')).toBe(true);
  expect(text.indexOf('\uFEFF', 1)).toBe(-1);
  expect(text.endsWith('\r\n')).toBe(true);
  expect(text.split('\r\n').length).toBeGreaterThan(1);

  const row = asObject(parseCsv(text));
  expect(row['记录ID']).toBe('');
  expect(row['日期']).toBe('2026-11-02');
  expect(row['运动类型']).toBe('户外跑步');
  expect(row['运动时长（秒）']).toBe('1812'); // explicit duration, never derived
  expect(row['平均配速（秒/公里）']).toBe('415');
  expect(row['动态千卡']).toBe('279');
  expect(row['总千卡']).toBe('324');
  expect(row['气温（°C）']).toBe('10');
  expect(row['奖章']).toBe('首次跑步训练');
  expect(row['30分钟挑战是否完成']).toBe('是');
});

test('splits CSV writes one row per split with the partial last segment intact', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openBackup(page);
  const text = await grab(page, '导出分段 CSV');
  const rows = parseCsv(text);

  expect(rows).toHaveLength(1 + SAMPLE_RECORD.splits.length);
  const last = asObject(rows, 5);
  expect(last['分段序号']).toBe('5');
  expect(last['分段时长（秒）']).toBe('181');
  expect(last['分段配速（秒/公里）']).toBe('492');
  expect(last['分段心率（次/分）']).toBe('155');
  expect(last['是否不足1公里末段']).toBe('是');
});

test('keeps a negative temperature numeric and neutralizes formula-like text', async ({ page }) => {
  await seed(page, [run({
    id: 'edge', temperatureCelsius: -12, location: '=SUM(A1)',
    source: '  @cmd', effortDescription: '第一行,第二行\n带"引号"',
  })]);
  await page.goto('/');
  await openBackup(page);
  const text = await grab(page, '导出训练 CSV');
  const row = asObject(parseCsv(text));

  expect(row['气温（°C）']).toBe('-12'); // a real number is never quoted-escaped
  expect(row['地点']).toBe("'=SUM(A1)");
  expect(row['设备']).toBe("'  @cmd");
  // Commas, quotes and newlines survive an exact round trip.
  expect(row['强度描述']).toBe('第一行,第二行\n带"引号"');
  expect(text).toContain('"第一行,第二行\n带""引号"""');
});

test('exporting CSV leaves localStorage untouched', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openBackup(page);
  const before = await page.evaluate(() => localStorage.getItem('run-for-life:v1'));
  await grab(page, '导出训练 CSV');
  await grab(page, '导出分段 CSV');
  const after = await page.evaluate(() => localStorage.getItem('run-for-life:v1'));
  expect(after).toBe(before);
});

test('CSV buttons are disabled without records and without any splits', async ({ page }) => {
  await seed(page, []);
  await page.goto('/');
  await openBackup(page);
  await expect(page.getByRole('button', { name: '导出训练 CSV', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '导出分段 CSV', exact: true })).toBeDisabled();

  await seed(page, [run({ id: 'no-splits', splits: [] })]);
  await page.reload();
  await openBackup(page);
  await expect(page.getByRole('button', { name: '导出训练 CSV', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '导出分段 CSV', exact: true })).toBeDisabled();
});

test('an already loaded page still exports CSV while offline', async ({ page, context }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openBackup(page);
  await context.setOffline(true);
  const text = await grab(page, '导出分段 CSV');
  await context.setOffline(false);
  expect(text.startsWith('\uFEFF')).toBe(true);
  expect(parseCsv(text)).toHaveLength(6);
});

test('the CSV actions fit a 320px viewport without horizontal overflow', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await openBackup(page);
  await expect(page.getByRole('button', { name: '导出训练 CSV', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出分段 CSV', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
