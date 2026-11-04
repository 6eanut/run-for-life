import type { RunRecord } from './model';

export type TrendMetric = 'distance' | 'pace' | 'heartRate' | 'duration' | 'cadence' | 'power';
export const trendMetrics = [
  { id: 'distance', field: 'distanceKm', label: '跑步距离', unit: '公里', hint: '看看每次出发，跑过了多远。' },
  { id: 'pace', field: 'averagePaceSecondsPerKm', label: '平均配速', unit: '分 / 公里', hint: '越靠上，配速越快。按自己的节奏跑就好。' },
  { id: 'heartRate', field: 'averageHeartRateBpm', label: '平均心率', unit: '次 / 分', hint: '记录每次跑步的心率，结合天气、配速和感受一起看。' },
  { id: 'duration', field: 'durationSeconds', label: '运动时长', unit: '时长', hint: '每次留给跑步的时间，都在这里。' },
  { id: 'cadence', field: 'averageCadenceSpm', label: '平均步频', unit: '步 / 分', hint: '看看脚步的节奏，如何随时间变化。' },
  { id: 'power', field: 'averagePowerWatts', label: '平均功率', unit: '瓦', hint: '把每次跑步的功率，放在同一条时间线上。' },
] as const;

export interface TrendPoint {
  key: string;
  date: string;
  time: string | null;
  timestamp: number;
  value: number | null;
}

function validDate(date: string | null): date is string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

const knownNumber = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;

function localTimestamp(date: string, time: string | null): number {
  const validTime = time && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '00:00';
  // Calendar coordinates, not an instant converted to the browser's timezone.
  return Date.parse(`${date}T${validTime}:00Z`);
}

export function getTrendSeries(records: readonly RunRecord[], metric: TrendMetric) {
  const field = trendMetrics.find(item => item.id === metric)!.field;
  const points: TrendPoint[] = records.flatMap((record, index) => {
    if (!validDate(record.date)) return [];
    const value = record[field];
    return [{ key: record.id ?? `run-${index}`, date: record.date, time: record.startTime,
      timestamp: localTimestamp(record.date, record.startTime), value: knownNumber(value) ? value : null }];
  }).sort((a, b) => a.timestamp - b.timestamp);
  return { points, excludedDateCount: records.length - points.length };
}

export interface ChartPoint extends TrendPoint { x: number; y: number | null }
export function chartGeometry(series: readonly TrendPoint[], fasterUp = false) {
  const values = series.flatMap(point => point.value === null ? [] : [point.value]);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const padding = Math.max((high - low) * 0.18, high * 0.05, 0.5);
  const min = Math.max(0, low - padding);
  const max = high + padding;
  const firstTime = series[0]?.timestamp ?? 0;
  const lastTime = series.at(-1)?.timestamp ?? firstTime;
  const points: ChartPoint[] = series.map(point => {
    const ratio = point.value === null ? null : (point.value - min) / (max - min);
    return { ...point, x: lastTime === firstTime ? 400 : 64 + (point.timestamp - firstTime) / (lastTime - firstTime) * 672,
      y: ratio === null ? null : 22 + (fasterUp ? ratio : 1 - ratio) * 216 };
  });
  const paths = points.map((point, index) => point.y === null ? '|' :
    `${index && points[index - 1].y !== null ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)} `)
    .join('').split('|').filter(path => path.trim().length > 0).map(path => path.trim());
  return { points, paths, min, max };
}

export function formatMetricValue(metric: TrendMetric, value: number | null): string {
  if (value === null) return '未记录';
  if (metric === 'distance') return value.toFixed(2);
  if (metric === 'pace') {
    const seconds = Math.round(value);
    return `${Math.floor(seconds / 60)}′${String(seconds % 60).padStart(2, '0')}″`;
  }
  if (metric === 'duration') {
    const seconds = Math.round(value);
    const hours = Math.floor(seconds / 3600);
    return `${hours ? `${hours}:` : ''}${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return String(Math.round(value));
}

export interface MonthlyActivity {
  month: string;
  count: number;
  distanceKm: number | null;
  missingDistanceCount: number;
}

export function getMonthlyActivity(records: readonly RunRecord[]): MonthlyActivity[] {
  const dated = records.filter(record => validDate(record.date));
  const months = dated.map(record => record.date!.slice(0, 7)).sort();
  if (!months.length) return [];
  const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
  const last = monthIndex(months.at(-1)!);
  const first = Math.max(monthIndex(months[0]), last - 11);
  return Array.from({ length: last - first + 1 }, (_, offset) => {
    const index = first + offset;
    const month = `${String(Math.floor(index / 12)).padStart(4, '0')}-${String(index % 12 + 1).padStart(2, '0')}`;
    const runs = dated.filter(record => record.date!.startsWith(month));
    const distances = runs.flatMap(record => knownNumber(record.distanceKm) ? [record.distanceKm] : []);
    return { month, count: runs.length,
      distanceKm: runs.length && !distances.length ? null : distances.reduce((total, value) => total + value, 0),
      missingDistanceCount: runs.length - distances.length };
  });
}
