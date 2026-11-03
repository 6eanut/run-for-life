import { expect, test } from '@playwright/test';

test('fills form numbers from phone OCR with a damaged detail unit', async ({ page }) => {
  const text = '户外 跑步\n5.24 公 里\n2026 年 11 月 3 日 20:58-21:31\n体能 训练 时 间 距离\n0:32:10 5.24 nE\n动态 干 卡 总 干 卡 数\n301 干 卡 369 和 干 卡\n平均 心率\n163 闪 /分\n平均 配速\n5 人';
  await page.addInitScript(({ texts }) => {
    let index = 0;
    class PhoneOcrWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage(message: { action: string; workerId: string; jobId: string }) {
        const data = message.action === 'recognize' ? { text: texts[index++] ?? '', blocks: [] } : {};
        queueMicrotask(() => this.onmessage?.({ data: { ...message, status: 'resolve', data } }));
      }
      terminate() {}
    }
    Object.defineProperty(window, 'Worker', { value: PhoneOcrWorker });
  }, { texts: [text, ''] });
  await page.goto('/');
  const png = await page.evaluate(() => document.createElement('canvas').toDataURL('image/png').split(',')[1]);
  await page.getByLabel('上传两张跑步截图').setInputFiles([0, 1].map(index => ({ name: `${index}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
  await page.getByRole('button', { name: '开始识别并核对' }).click();
  await expect(page.getByRole('dialog', { name: '核对跑步记录' })).toBeVisible();
  await expect(page.getByLabel('跑步距离（公里）', { exact: true })).toHaveValue('5.24');
  await expect(page.getByLabel('平均心率（次/分）', { exact: true })).toHaveValue('163');
  await expect(page.getByLabel('平均配速（分/公里）', { exact: true })).toBeEmpty();
  await page.getByText('更多数据与分段记录', { exact: false }).click();
  await expect(page.getByLabel('动态消耗（千卡）', { exact: true })).toHaveValue('301');
  await expect(page.getByLabel('总消耗（千卡）', { exact: true })).toHaveValue('369');
});
