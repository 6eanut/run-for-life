import type { RunRecord } from './model';

export type TrendMetric = 'distance' | 'pace' | 'heartRate' | 'duration' | 'cadence' | 'power'
  | 'activeCalories' | 'totalCalories' | 'elevation' | 'effort' | 'temperature' | 'humidity' | 'airQuality';

export const trendMetricGroupOrder = ['训练表现', '消耗与爬升', '强度与环境'] as const;
export type TrendMetricGroup = typeof trendMetricGroupOrder[number];

export const trendMetrics = [
  { id: 'distance', field: 'distanceKm', label: '跑步距离', unit: '公里', hint: '看看每次出发，跑过了多远。', group: '训练表现' },
  { id: 'pace', field: 'averagePaceSecondsPerKm', label: '平均配速', unit: '分 / 公里', hint: '越靠上，配速越快。按自己的节奏跑就好。', group: '训练表现' },
  { id: 'heartRate', field: 'averageHeartRateBpm', label: '平均心率', unit: '次 / 分', hint: '记录每次跑步的心率，结合天气、配速和感受一起看。', group: '训练表现' },
  { id: 'duration', field: 'durationSeconds', label: '运动时长', unit: '时长', hint: '每次留给跑步的时间，都在这里。', group: '训练表现' },
  { id: 'cadence', field: 'averageCadenceSpm', label: '平均步频', unit: '步 / 分', hint: '看看脚步的节奏，如何随时间变化。', group: '训练表现' },
  { id: 'power', field: 'averagePowerWatts', label: '平均功率', unit: '瓦', hint: '把每次跑步的功率，放在同一条时间线上。', group: '训练表现' },
  { id: 'activeCalories', field: 'activeCaloriesKcal', label: '动态消耗', unit: '千卡', hint: '每次跑步的活动能量消耗。', group: '消耗与爬升' },
  { id: 'totalCalories', field: 'totalCaloriesKcal', label: '总消耗', unit: '千卡', hint: '每次跑步记录的总能量消耗。', group: '消耗与爬升' },
  { id: 'elevation', field: 'elevationGainMeters', label: '累计爬升', unit: '米', hint: '对比每次跑步记录的爬升高度。', group: '消耗与爬升' },
  { id: 'effort', field: 'effortLevel', label: '运动强度', unit: '1–10', hint: '记录每次跑步的强度，结合配速和感受一起看。', group: '强度与环境' },
  { id: 'temperature', field: 'temperatureCelsius', label: '气温', unit: '°C', hint: '气温可以和配速、感受一起回顾。', group: '强度与环境' },
  { id: 'humidity', field: 'humidityPercent', label: '湿度', unit: '%', hint: '湿度也记录在案，和当天感受一起看。', group: '强度与环境' },
  { id: 'airQuality', field: 'airQualityIndex', label: '空气质量指数', unit: 'AQI', hint: '把每次跑步的空气质量指数放在同一条时间线上。', group: '强度与环境' },
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

// Mirrors the stored-field ranges in records.ts; temperature alone may be negative.
const FIELD_RANGES: Partial<Record<keyof RunRecord, [number, number]>> = {
  durationSeconds: [0, 604800], distanceKm: [0, 2000], averagePaceSecondsPerKm: [1, 7200],
  averageHeartRateBpm: [20, 250], averageCadenceSpm: [1, 300], averagePowerWatts: [0, 3000],
  activeCaloriesKcal: [0, 100000], totalCaloriesKcal: [0, 100000], elevationGainMeters: [0, 50000],
  effortLevel: [1, 10], temperatureCelsius: [-90, 70], humidityPercent: [0, 100], airQualityIndex: [0, 1000],
};

function validNumber(field: keyof RunRecord, value: number | null): value is number {
  if (value === null || !Number.isFinite(value)) return false;
  const range = FIELD_RANGES[field];
  if (!range) return true;
  return value >= range[0] && value <= range[1];
}

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
      timestamp: localTimestamp(record.date, record.startTime), value: validNumber(field, value) ? value : null }];
  }).sort((a, b) => a.timestamp - b.timestamp);
  return { points, excludedDateCount: records.length - points.length };
}

export interface ChartOptions { signed?: boolean; bounds?: [number, number] | null }
export interface ChartPoint extends TrendPoint { x: number; y: number | null }
export function chartGeometry(series: readonly TrendPoint[], fasterUp = false, options: ChartOptions = {}) {
  const values = series.flatMap(point => point.value === null ? [] : [point.value]);
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const padding = Math.max((high - low) * 0.18, high * 0.05, 0.5);
  // Signed axes keep negative values (temperature); others stay above zero as before.
  let min = options.signed ? low - padding : Math.max(0, low - padding);
  let max = high + padding;
  if (options.bounds) { min = Math.max(options.bounds[0], min); max = Math.min(options.bounds[1], max); }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) { min = Math.min(min, high - 0.5); max = min + 1; }
  const span = max - min;
  const firstTime = series[0]?.timestamp ?? 0;
  const lastTime = series.at(-1)?.timestamp ?? firstTime;
  const points: ChartPoint[] = series.map(point => {
    const ratio = point.value === null ? null : (point.value - min) / span;
    return { ...point, x: lastTime === firstTime ? 400 : 64 + (point.timestamp - firstTime) / (lastTime - firstTime) * 672,
      y: ratio === null ? null : 22 + (fasterUp ? ratio : 1 - ratio) * 216 };
  });
  const paths = points.map((point, index) => point.y === null ? '|' :
    `${index && points[index - 1].y !== null ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)} `)
    .join('').split('|').filter(path => path.trim().length > 0).map(path => path.trim());
  return { points, paths, min, max };
}

export function chartOptionsForMetric(metric: TrendMetric): ChartOptions {
  if (metric === 'temperature') return { signed: true, bounds: null };
  if (metric === 'effort') return { signed: false, bounds: [1, 10] };
  if (metric === 'humidity') return { signed: false, bounds: [0, 100] };
  return { signed: false, bounds: null };
}

function trimmedDecimal(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits));
  return String(Object.is(rounded, -0) ? 0 : rounded);
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
  if (metric === 'temperature' || metric === 'humidity' || metric === 'effort') return trimmedDecimal(value, 1);
  if (metric === 'elevation') return trimmedDecimal(value, 2);
  if (metric === 'activeCalories' || metric === 'totalCalories' || metric === 'airQuality') return trimmedDecimal(value, 1);
  return String(Math.round(value));
}

export function formatAxisLabel(metric: TrendMetric, value: number): string {
  // Axis ticks keep meaningful decimals so a single point never renders duplicate readings.
  if (metric === 'distance') return value < 10 ? value.toFixed(1) : String(Math.round(value));
  return formatMetricValue(metric, value);
}

// The change note uses a unit that reads naturally, not the display range shown beside the value.
const DIFFERENCE_UNITS: Partial<Record<TrendMetric, string>> = { effort: '分', humidity: '个百分点' };
function differenceUnit(metric: TrendMetric): string {
  if (metric === 'duration') return '';
  return ` ${DIFFERENCE_UNITS[metric] ?? trendMetrics.find(item => item.id === metric)!.unit}`;
}

export function formatMetricDifference(metric: TrendMetric, difference: number): string {
  const formatted = formatMetricValue(metric, Math.abs(difference));
  if (metric === 'pace') return `最新较最早有数据的记录${difference < 0 ? '快' : '慢'} ${formatted}/公里`;
  return `最新较最早有数据的记录 ${difference > 0 ? '+' : '−'}${formatted}${differenceUnit(metric)}`;
}

// Monthly distance totals only ever include non-negative recorded kilometres.
const knownNumber = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;

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
