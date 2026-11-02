import { expect, test } from '@playwright/test';

test('production app installs under a subpath and opens offline', async ({ page, context }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('每一次出发，都算数。');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)).toContain('/running/');
  await page.getByRole('button', { name: '演示数据', exact: true }).click();
  await page.getByRole('button', { name: '确认并保存' }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('每一次出发，都算数。');
  await expect(page.getByTestId('completed-count')).toHaveText('1');
});
