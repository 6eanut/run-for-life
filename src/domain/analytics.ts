import type { RunRecord } from './model';

export type StatsRange = 'all' | '30d' | '90d' | 'year' | 'custom';

export interface DateRange {
  start: string | null;
  end: string | null;
}

const DAY_MS = 86400000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ISO calendar math on UTC coordinates only; never shifts a workout's local date.
export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function requireIsoDate(value: unknown, label: string): string {
  if (!isValidIsoDate(value)) throw new Error(`${label}无效，请使用 yyyy-mm-dd 格式的有效日期`);
  return value;
}

function shiftIsoDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function resolveDateRange(
  preset: StatsRange,
  today: string,
  custom?: { start: string; end: string },
): DateRange {
  const end = requireIsoDate(today, '今天日期');
  switch (preset) {
    case 'all':
      return { start: null, end: null };
    case '30d':
      return { start: shiftIsoDate(end, -29), end };
    case '90d':
      return { start: shiftIsoDate(end, -89), end };
    case 'year':
      return { start: `${end.slice(0, 4)}-01-01`, end };
    case 'custom': {
      if (!custom) throw new Error('自定义日期范围缺少开始或结束日期');
      const start = requireIsoDate(custom.start, '开始日期');
      const finish = requireIsoDate(custom.end, '结束日期');
      if (start > finish) throw new Error('开始日期不能晚于结束日期');
      return { start, end: finish };
    }
    default:
      throw new Error('不支持的时间筛选范围');
  }
}

export function filterRuns(records: readonly RunRecord[], range: DateRange): RunRecord[] {
  return records.filter(record => {
    const date = record.date;
    if (!isValidIsoDate(date)) return false;
    if (range.start !== null && date < range.start) return false;
    if (range.end !== null && date > range.end) return false;
    return true;
  });
}

export interface PeriodSummary {
  runCount: number;
  activeDays: number;
  completedCount: number;
  distanceKm: number | null;
  missingDistanceCount: number;
  durationSeconds: number | null;
  activeCaloriesKcal: number | null;
  elevationGainMeters: number | null;
}

type MetricField = 'distanceKm' | 'durationSeconds' | 'activeCaloriesKcal' | 'elevationGainMeters';

const knownAmount = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const roundSum = (value: number): number => Math.round(value * 1e6) / 1e6;

// Empty bucket -> 0; bucket with runs but no known amounts -> null; otherwise the known sum.
function sumMetric(records: readonly RunRecord[], field: MetricField): number | null {
  if (records.length === 0) return 0;
  const values = records.flatMap(record => knownAmount(record[field]) ? [record[field]] : []);
  if (values.length === 0) return null;
  return roundSum(values.reduce((total, value) => total + value, 0));
}

function completedRuns(record: RunRecord): number {
  return typeof record.durationSeconds === 'number'
    && Number.isFinite(record.durationSeconds) && record.durationSeconds >= 1800 ? 1 : 0;
}

export function summarizePeriod(records: readonly RunRecord[]): PeriodSummary {
  const dates = records.flatMap(record => isValidIsoDate(record.date) ? [record.date] : []);
  return {
    runCount: records.length,
    activeDays: new Set(dates).size,
    completedCount: records.reduce((total, record) => total + completedRuns(record), 0),
    distanceKm: sumMetric(records, 'distanceKm'),
    missingDistanceCount: records.filter(record => !knownAmount(record.distanceKm)).length,
    durationSeconds: sumMetric(records, 'durationSeconds'),
    activeCaloriesKcal: sumMetric(records, 'activeCaloriesKcal'),
    elevationGainMeters: sumMetric(records, 'elevationGainMeters'),
  };
}

export interface CalendarDay {
  date: string;
  count: number;
  distanceKm: number | null;
  missingDistanceCount: number;
  durationSeconds: number | null;
  completedCount: number;
  runIds: string[];
  isFuture: boolean;
}

function emptyDay(date: string, isFuture: boolean): CalendarDay {
  return {
    date,
    count: 0,
    distanceKm: 0,
    missingDistanceCount: 0,
    durationSeconds: 0,
    completedCount: 0,
    runIds: [],
    isFuture,
  };
}

function dayFromRuns(date: string, runs: readonly RunRecord[]): CalendarDay {
  const summary = summarizePeriod(runs);
  return {
    date,
    count: summary.runCount,
    distanceKm: summary.distanceKm,
    missingDistanceCount: summary.missingDistanceCount,
    durationSeconds: summary.durationSeconds,
    completedCount: summary.completedCount,
    runIds: runs.flatMap(run => (typeof run.id === 'string' && run.id ? [run.id] : [])),
    isFuture: false,
  };
}

const DAYS_PER_WEEK = 7;

export function buildActivityCalendar(
  records: readonly RunRecord[],
  endDate: string,
  weeks = 12,
): CalendarDay[] {
  const end = requireIsoDate(endDate, '结束日期');
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 53) throw new Error('周数必须是 1 到 53 之间的整数');

  const byDate = new Map<string, RunRecord[]>();
  for (const record of records) {
    if (!isValidIsoDate(record.date)) continue;
    const bucket = byDate.get(record.date);
    if (bucket) bucket.push(record);
    else byDate.set(record.date, [record]);
  }

  const endMs = Date.parse(`${end}T00:00:00Z`);
  const mondayOffset = (new Date(endMs).getUTCDay() + 6) % DAYS_PER_WEEK;
  const startMs = endMs - mondayOffset * DAY_MS - (weeks - 1) * DAYS_PER_WEEK * DAY_MS;

  return Array.from({ length: weeks * DAYS_PER_WEEK }, (_, index) => {
    const date = new Date(startMs + index * DAY_MS).toISOString().slice(0, 10);
    if (date > end) return emptyDay(date, true);
    const runs = byDate.get(date);
    return runs ? dayFromRuns(date, runs) : emptyDay(date, false);
  });
}
