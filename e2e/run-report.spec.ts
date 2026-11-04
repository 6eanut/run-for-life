import { expect, test, type Page } from '@playwright/test';
import { SAMPLE_RECORD } from '../src/domain/sample';

// The statistics page hides the review behind a collapsed details entry, so every
// flow opens it first. RunReport is mounted with the same filtered records the rest
// of the page uses, so a range change quietly updates the props underneath.
const TODAY = new Date(2026, 10, 4, 12, 0, 0); // 2026-11-04, browser local time
const seed = (page: Page, records: unknown[]) =>
  page.addInitScript(runs => localStorage.setItem('run-for-life:v1', JSON.stringify({ version: 1, records: runs })), records);

const run = (overrides: Record<string, unknown>) => ({ ...SAMPLE_RECORD, ...overrides });

const review = (page: Page) => page.getByRole('region', { name: '跑步回顾', exact: true });
const bests = (page: Page) => page.getByRole('region', { name: '这段时间的个人纪录', exact: true });
const picker = (page: Page) => page.getByRole('combobox', { name: '回顾哪次跑步', exact: true });
const disclosure = (page: Page) => page.getByText('跑步回顾与个人纪录', { exact: true });
const openReview = (page: Page) => disclosure(page).click();

test.beforeEach(async ({ page }) => { await page.clock.setFixedTime(TODAY); });

test('the review shows the latest run with clear figures and honest weather', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openReview(page);
  const card = review(page);

  // Heading carries the identity of the run, taken from the record as recorded.
  await expect(card).toContainText('2026年11月2日');
  await expect(card).toContainText('20:58');
  await expect(card).toContainText('中国北京市');
  await expect(card).toContainText('Apple Watch');
  await expect(card).toContainText('户外跑步');
  await expect(card).toContainText('首次跑步训练');

  // The intensity tag shows the real 6/10 and its own description, never a derived one.
  await expect(card.getByTestId('run-report-effort')).toContainText('6/10');
  await expect(card.getByTestId('run-report-effort')).toContainText('适中');

  // First glance: distance, explicit duration, average pace, average heart rate.
  await expect(card.getByTestId('run-report-distance')).toHaveText('4.36');
  await expect(card.getByTestId('run-report-duration')).toHaveText('30:12');
  await expect(card.getByTestId('run-report-pace')).toHaveText('6′55″');
  await expect(card.getByTestId('run-report-hr')).toHaveText('161');

  // Weather strip: raw values only, no health colour or advice.
  await expect(card.getByTestId('run-report-temperature')).toHaveText('10°C');
  await expect(card.getByTestId('run-report-humidity')).toHaveText('60%');
  await expect(card.getByTestId('run-report-air')).toHaveText('95');

  // Completeness is a recording statement, not a score.
  await expect(card.getByTestId('run-report-coverage')).toContainText('16 / 16');
  await expect(card).toContainText('未知可以留空，记录仍然有效');
});

test('expanding reveals every metric and honest split bars with the partial last segment marked', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.goto('/');
  await openReview(page);
  const card = review(page);

  await card.getByText('更多指标与分段', { exact: true }).click();
  await expect(card.getByTestId('run-report-split')).toHaveCount(5);

  const last = card.getByTestId('run-report-split').nth(4);
  await expect(last).toContainText('末段 · 不足1公里');
  await expect(last.getByTestId('run-report-split-duration')).toHaveText('03:01');
  await expect(last.getByTestId('run-report-split-pace')).toContainText('8′12″');
  await expect(last.getByTestId('run-report-split-hr')).toContainText('155');

  // The recorded split durations already add up: no reconciliation prompt.
  await expect(card.getByTestId('run-report-split-check')).toHaveCount(0);
  // Comparable segments: last compares against first, sample got slower.
  await expect(card.getByTestId('run-report-split-delta')).toContainText('慢');

  // Remaining metrics live in the same expansion.
  await expect(card).toContainText('平均步频');
  await expect(card).toContainText('177');
  await expect(card).toContainText('累计爬升');
});

test('choosing an earlier run reviews that run instead of the latest', async ({ page }) => {
  await seed(page, [
    run({ id: 'a', date: '2026-11-01', startTime: '07:00', distanceKm: 3 }),
    run({ id: 'b', date: '2026-11-03', startTime: '18:00', distanceKm: 6 }),
  ]);
  await page.goto('/');
  await openReview(page);
  const card = review(page);

  // Defaults to the most recent run.
  await expect(card.getByTestId('run-report-distance')).toHaveText('6.00');
  await picker(page).selectOption({ label: '2026.11.01 07:00 · 3.00 公里' });
  await expect(card.getByTestId('run-report-distance')).toHaveText('3.00');
});

test('a selected run without an id survives narrowing the range that drops a newer run', async ({ page }) => {
  // Three id-less records: C (newest), B (middle, the one the user reviews), A (oldest).
  await seed(page, [
    run({ id: undefined, date: '2026-11-01', startTime: '08:00', distanceKm: 3, durationSeconds: 1200 }),
    run({ id: undefined, date: '2026-10-01', startTime: '08:00', distanceKm: 5, durationSeconds: 2400 }),
    run({ id: undefined, date: '2026-09-01', startTime: '08:00', distanceKm: 7, durationSeconds: 3000 }),
  ]);
  await page.goto('/');
  await openReview(page);
  const card = review(page);

  await picker(page).selectOption({ label: '2026.10.01 08:00 · 5.00 公里' });
  await expect(card.getByTestId('run-report-distance')).toHaveText('5.00');
  await expect(card).toContainText('2026年10月1日');

  // Narrow to 09-01..10-15: C is filtered out, B and A remain. B must still be reviewed.
  await page.getByRole('combobox', { name: '统计时间范围', exact: true }).selectOption('custom');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-09-01');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-15');
  await page.getByRole('button', { name: '应用时间范围', exact: true }).click();

  await expect(card.getByTestId('run-report-distance')).toHaveText('5.00');
  await expect(card).toContainText('2026年10月1日');
});

test('a short sprint never takes the fastest-average-pace record', async ({ page }) => {
  await seed(page, [
    run({ id: 'sprint', date: '2026-11-01', startTime: '07:00', durationSeconds: 600, distanceKm: 2, averagePaceSecondsPerKm: 300 }),
    run({ id: 'steady', date: '2026-11-02', startTime: '07:00', durationSeconds: 2400, distanceKm: 8, averagePaceSecondsPerKm: 400 }),
  ]);
  await page.goto('/');
  await openReview(page);

  const pace = bests(page).getByTestId('run-report-best-pace');
  await expect(pace).toContainText('6′40″'); // 400 s/km from the 40-minute effort
  await expect(pace).toContainText('2026.11.02');
  await expect(bests(page).getByTestId('run-report-best-distance')).toContainText('8.00');
});

test('negative temperature stays negative, zero humidity stays zero and missing readings show a dash', async ({ page }) => {
  await seed(page, [run({
    id: 'cold', date: '2026-01-08', startTime: '05:30',
    temperatureCelsius: -12, humidityPercent: 0, airQualityIndex: null, averageHeartRateBpm: null,
  })]);
  await page.goto('/');
  await openReview(page);
  const card = review(page);

  // 0 is a recorded value, unlike a missing reading.
  await expect(card.getByTestId('run-report-temperature')).toHaveText('-12°C');
  await expect(card.getByTestId('run-report-humidity')).toHaveText('0%');
  // Unrecorded weather and heart rate stay blank, never faked or colour-coded.
  await expect(card.getByTestId('run-report-air')).toHaveText('—');
  await expect(card.getByTestId('run-report-hr')).toHaveText('—');
});

test('an empty range shows a light empty state without inventing a run', async ({ page }) => {
  await seed(page, []);
  await page.goto('/');
  await openReview(page);

  await expect(review(page).getByTestId('run-report-empty')).toBeVisible();
  await expect(page.getByTestId('run-report-distance')).toHaveCount(0);
  // Nothing to compare in an empty range, so no personal-best panel is rendered.
  await expect(bests(page)).toHaveCount(0);
});

test('the review fits a 320px viewport without horizontal overflow', async ({ page }) => {
  await seed(page, [SAMPLE_RECORD]);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await openReview(page);

  const card = review(page);
  await expect(card).toBeVisible();
  await card.getByText('更多指标与分段', { exact: true }).click();
  await expect(card.getByTestId('run-report-split')).toHaveCount(5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
