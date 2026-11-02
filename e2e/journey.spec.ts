import { expect, test } from '@playwright/test';

test('preview does not save; confirmation persists; duplicate is blocked; edit and delete update totals', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await page.getByRole('button', { name: '演示数据', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await expect(page.getByLabel('运动时长', { exact: true })).toHaveValue('30:12');
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('completed-count')).toHaveText('1');
  await page.reload();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
  await page.getByRole('button', { name: '演示数据', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByRole('alert')).toContainText('重复');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await page.getByRole('button', { name: /查看或编辑/ }).click();
  await page.getByLabel('运动时长', { exact: true }).fill('29:59');
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await page.getByRole('button', { name: /跑步记录/, exact: false }).first().click();
  await page.getByRole('button', { name: /删除 2026/ }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByText('下一次出发，值得记下来。')).toBeVisible();
});

test('backup is previewed before importing, safely renders text, and reimport is idempotent', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '演示数据', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存' }).click();
  await page.getByRole('button', { name: /设置与备份/ }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出 JSON 备份/ }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await page.getByLabel('导入 JSON 备份文件').setInputFiles(path!);
  await expect(page.getByRole('dialog', { name: '核对备份导入' })).toBeVisible();
  await expect(page.getByTestId('completed-count')).toHaveText('0');
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
  await page.getByLabel('导入 JSON 备份文件').setInputFiles(path!);
  await expect(page.getByText('确定重复：1 条，将自动跳过。')).toBeVisible();
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
});

test('manual record, uncertain duplicate approval, and mobile width', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '手动记录', exact: true }).click();
  await page.getByLabel('运动日期', { exact: true }).fill('2026-11-02');
  await page.getByLabel('运动时长', { exact: true }).fill('30:00');
  await page.getByRole('button', { name: '确认并保存' }).click();
  await expect(page.getByTestId('completed-count')).toHaveText('1');
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
