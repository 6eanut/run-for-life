import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_RECORD } from '../src/domain/sample';
import { MEMORY_CARD_HEIGHT, MEMORY_CARD_WIDTH, memoryCardFilename } from '../src/services/memory-card';

// The souvenir dialog lives behind the review panel's "生成纪念卡" action. It runs
// entirely locally: a PNG is rendered from the record, previewed, and downloaded.
// No private images, network calls or test-only production hooks are involved.

const seed = (page: Page, records: unknown[]) =>
  page.addInitScript(runs => localStorage.setItem('run-for-life:v1', JSON.stringify({ version: 1, records: runs })), records);
const run = (overrides: Record<string, unknown>) => ({ ...SAMPLE_RECORD, ...overrides });

const openReview = (page: Page) => page.getByText('跑步回顾与个人纪录', { exact: true }).click();
const dialog = (page: Page) => page.getByRole('dialog', { name: '跑步纪念卡', exact: true });
const cardButton = (page: Page) => page.getByRole('button', { name: '生成纪念卡', exact: true });
const preview = (page: Page) => page.getByTestId('memory-card-preview');
const saveButton = (page: Page) => page.getByRole('button', { name: '保存 PNG', exact: true });
const locationToggle = (page: Page) => page.getByRole('checkbox', { name: /在卡片上显示地点/ });

// From the stats page: expand the review, ask for a card, and return the dialog.
const openDialog = async (page: Page) => {
  await openReview(page);
  await cardButton(page).click();
  await expect(dialog(page)).toBeVisible();
  return dialog(page);
};

const waitReady = async (page: Page) => {
  await expect(preview(page)).toBeVisible();
  await expect(saveButton(page)).toBeEnabled();
};

// Read the PNG bytes a save produces, without keeping anything on disk.
const saveBytes = async (page: Page): Promise<{ name: string; bytes: Buffer }> => {
  const started = page.waitForEvent('download');
  await saveButton(page).click();
  const download = await started;
  const bytes = await readFile((await download.path())!);
  return { name: download.suggestedFilename(), bytes };
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

test('opening the souvenir dialog renders a real 900x1280 PNG and saves it under the service filename', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openDialog(page);
  await waitReady(page);

  // The <img> is the true PNG, not a placeholder: natural pixels match the design size.
  await expect(preview(page)).toHaveAttribute('alt', /2026-11-02/);
  await expect(preview(page)).toHaveJSProperty('naturalWidth', MEMORY_CARD_WIDTH);
  await expect(preview(page)).toHaveJSProperty('naturalHeight', MEMORY_CARD_HEIGHT);

  const before = await page.evaluate(() => localStorage.getItem('run-for-life:v1'));
  const { name, bytes } = await saveBytes(page);

  // A genuine PNG download with the service filename and the service dimensions.
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(pngSize(bytes)).toEqual({ width: MEMORY_CARD_WIDTH, height: MEMORY_CARD_HEIGHT });
  expect(name).toBe(memoryCardFilename(SAMPLE_RECORD));

  // Generating and saving changes nothing in storage.
  const after = await page.evaluate(() => localStorage.getItem('run-for-life:v1'));
  expect(after).toBe(before);
});

test('the location checkbox starts off and only the currently selected option is downloadable', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openDialog(page);
  await waitReady(page);

  // Default: the real location is present in the record but not on the card.
  await expect(locationToggle(page)).toBeEnabled();
  await expect(locationToggle(page)).not.toBeChecked();
  const withoutLocation = (await saveBytes(page)).bytes;

  await locationToggle(page).check();
  await waitReady(page);
  const withLocation = (await saveBytes(page)).bytes;
  // The two options genuinely produce different cards.
  expect(withLocation.equals(withoutLocation)).toBe(false);

  // Rapid toggling must not let a cancelled result become the downloadable card:
  // after settling back on "with location", the save equals that option's bytes.
  await locationToggle(page).uncheck();
  await locationToggle(page).check();
  await locationToggle(page).uncheck();
  await locationToggle(page).check();
  await waitReady(page);
  const afterRapid = (await saveBytes(page)).bytes;
  expect(afterRapid.equals(withLocation)).toBe(true);
  expect(afterRapid.equals(withoutLocation)).toBe(false);
});

test('a record without a location disables the checkbox and still produces a card', async ({ page }) => {
  await seed(page, [run({ id: 'no-place', location: null })]);
  await page.goto('/');
  await openDialog(page);
  await waitReady(page);

  await expect(locationToggle(page)).not.toBeChecked();
  await expect(locationToggle(page)).toBeDisabled();
  await expect(preview(page)).toBeVisible();
  await expect(saveButton(page)).toBeEnabled();
});

test('a failed conversion shows a Chinese alert, blocks saving, and can be retried', async ({ page }) => {
  // Fail every canvas export until the test lifts the flag, so retry is exercised.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    (window as unknown as { __failMemoryCard: boolean }).__failMemoryCard = true;
    HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, callback: BlobCallback, ...rest: [string?, number?]) {
      if ((window as unknown as { __failMemoryCard: boolean }).__failMemoryCard) {
        window.setTimeout(() => callback(null), 0);
        return;
      }
      return original.call(this, callback, ...rest);
    };
  });
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openDialog(page);

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('纪念卡');
  await expect(preview(page)).toHaveCount(0);
  await expect(saveButton(page)).toBeDisabled();

  // Retrying after the failure clears cannot leave a stale downloadable image.
  await page.evaluate(() => { (window as unknown as { __failMemoryCard: boolean }).__failMemoryCard = false; });
  await page.getByRole('button', { name: '重新生成', exact: true }).click();
  await waitReady(page);
  await expect(alert).toHaveCount(0);
});

test('a failed save alerts without losing the preview, and a later save clears the alert', async ({ page }) => {
  // Fail only the download click the first time; PNG generation is untouched.
  await page.addInitScript(() => {
    const original = HTMLAnchorElement.prototype.click;
    (window as unknown as { __failSaveClick: boolean }).__failSaveClick = false;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      if ((window as unknown as { __failSaveClick: boolean }).__failSaveClick) throw new Error('simulated download failure');
      return original.call(this);
    };
  });
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openDialog(page);
  await waitReady(page);

  let downloads = 0;
  page.on('download', () => { downloads += 1; });

  // Attempt 1: the click throws, so no download starts and a Chinese alert shows.
  await page.evaluate(() => { (window as unknown as { __failSaveClick: boolean }).__failSaveClick = true; });
  await saveButton(page).click();
  const saveAlert = page.getByTestId('memory-card-save-error');
  await expect(saveAlert).toBeVisible();
  await expect(saveAlert).toContainText('保存失败');
  // The preview survives the failure and saving stays possible.
  await expect(preview(page)).toBeVisible();
  await expect(saveButton(page)).toBeEnabled();
  expect(downloads).toBe(0);

  // Attempt 2: the click recovers; the download is real and the stale alert clears.
  await page.evaluate(() => { (window as unknown as { __failSaveClick: boolean }).__failSaveClick = false; });
  const before = await page.evaluate(() => localStorage.getItem('run-for-life:v1'));
  const { name, bytes } = await saveBytes(page);
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(pngSize(bytes)).toEqual({ width: MEMORY_CARD_WIDTH, height: MEMORY_CARD_HEIGHT });
  expect(name).toBe(memoryCardFilename(SAMPLE_RECORD));
  await expect(saveAlert).toHaveCount(0);
  const after = await page.evaluate(() => localStorage.getItem('run-for-life:v1'));
  expect(after).toBe(before);
});

test('closing the dialog promptly during generation raises no page error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openReview(page);
  await cardButton(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toBeHidden();
  await page.waitForTimeout(150);
  expect(errors).toEqual([]);
});

test('the generate button is disabled while OCR is running, so two dialogs never overlap', async ({ page }) => {
  // A worker that never replies keeps the OCR promise pending, so `busy` stays true.
  // This mirrors the real Worker protocol from the mapping suite without any images.
  await page.addInitScript(() => {
    class PendingOcrWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null;
      postMessage() { /* never responds: OCR stays pending */ }
      terminate() {}
    }
    Object.defineProperty(window, 'Worker', { value: PendingOcrWorker });
  });
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');

  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '数据导入', exact: true }).click();
  const png = await page.evaluate(() => document.createElement('canvas').toDataURL('image/png').split(',')[1]);
  await page.getByLabel('上传两张跑步截图').setInputFiles([0, 1].map(index => ({
    name: `${index}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
  })));
  await page.getByRole('button', { name: '开始识别并核对' }).click();

  // While recognition hangs, the review's generate action is unavailable.
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '统计', exact: true }).click();
  await openReview(page);
  await expect(cardButton(page)).toBeDisabled();
  await expect(dialog(page)).toHaveCount(0);
});

test('the dialog stays operable at 320px without horizontal overflow', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  // Short, narrow screen: the preview must shrink inside the frame, never clip.
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await openDialog(page);
  await waitReady(page);

  await expect(saveButton(page)).toBeVisible();
  await expect(page.getByRole('button', { name: '关闭窗口', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  // The frame's inner box (border-box minus padding/border) fully contains the image.
  const contained = await page.evaluate(() => {
    const frame = document.querySelector('.memory-card-frame') as HTMLElement;
    const image = document.querySelector('.memory-card-preview') as HTMLElement;
    if (!frame || !image) return false;
    const innerHeight = frame.clientHeight - (parseFloat(getComputedStyle(frame).paddingTop) * 2);
    return image.getBoundingClientRect().height <= innerHeight + 1;
  });
  expect(contained).toBe(true);

  // The save and close controls stay reachable at this height.
  await expect(saveButton(page)).toBeInViewport();
  await expect(page.getByRole('button', { name: '关闭窗口', exact: true })).toBeInViewport();
});
