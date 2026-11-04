import { expect, test } from '@playwright/test';

test('real browser OCR extracts synthetic screenshots then waits for confirmation', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '数据导入', exact: true }).click();
  const screenshots = await page.evaluate(async () => {
    const texts = [
      ['Outdoor Running', '2026-11-02', '20:58 - 21:29', 'Workout Time', '0:30:12', 'Distance', '4.36 km', 'Average Pace', '6:55 /km'],
      ['Average Heart Rate', '161 bpm', 'Average Cadence', '161 spm', 'Active Calories', '279 kcal', 'Total Calories', '324 kcal'],
    ];
    return texts.map(lines => {
      const canvas = document.createElement('canvas');
      canvas.width = 900; canvas.height = 1200;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#101010'; context.fillRect(0, 0, 900, 1200);
      context.fillStyle = '#fff'; context.font = '40px Arial';
      lines.forEach((line, index) => context.fillText(line, 55, 80 + index * 100));
      return canvas.toDataURL('image/png').split(',')[1];
    });
  });
  await page.getByLabel('上传两张跑步截图').setInputFiles(screenshots.map((image, index) => ({ name: `synthetic-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(image, 'base64') })));
  await page.getByRole('button', { name: '开始识别并核对' }).click();
  await expect(page.getByRole('dialog', { name: '核对跑步记录' })).toBeVisible({ timeout: 100_000 });
  await expect(page.getByLabel('运动时长', { exact: true })).toHaveValue('30:12');
  await expect(page.getByLabel('跑步距离（公里）', { exact: true })).toHaveValue('4.36');
  await expect(page.getByLabel('平均心率（次/分）', { exact: true })).toHaveValue('161');
  await expect(page.getByLabel('平均步频（步/分）', { exact: true })).toHaveValue('161');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('run-for-life:v1') ?? '{"records":[]}').records.length)).toBe(0);
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
});
