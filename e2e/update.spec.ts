import { expect, test } from '@playwright/test';

test('shows the application version and only applies an update after editing ends', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-version')).toHaveText('v0.1.1');
  await page.evaluate(() => window.dispatchEvent(new Event('app-update-ready')));
  const update = page.getByRole('button', { name: '更新并刷新', exact: true });
  await expect(update).toBeEnabled();
  await page.getByRole('button', { name: '手动记录', exact: true }).click();
  await expect(update).toBeDisabled();
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(update).toBeEnabled();
  await page.evaluate(() => window.addEventListener('app-apply-update', () => {
    document.documentElement.dataset.updateRequested = 'yes';
  }));
  await update.click();
  await expect(page.locator('html')).toHaveAttribute('data-update-requested', 'yes');
});
