import type { RunRecord, Split } from './model';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Calendar coordinates on UTC only; never shifts a workout's local date.
export function isValidRunDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

// Missing or malformed start times sort as midnight rather than an instant.
function timeKey(value: string | null): string {
  return typeof value === 'string' && HHMM.test(value) ? value : '00:00';
}

function dayTimeKey(date: string, time: string | null): string {
  return `${date}T${timeKey(time)}`;
}

export function getRecentRuns(records: readonly RunRecord[]): RunRecord[] {
  return records
    .filter(record => isValidRunDate(record.date))
    .sort((a, b) => {
      const left = dayTimeKey(a.date!, a.startTime);
      const right = dayTimeKey(b.date!, b.startTime);
      if (left < right) return 1;
      if (left > right) return -1;
      return 0;
    });
}

export type BestMetric = 'distance' | 'duration' | 'pace' | 'elevation';

export interface PersonalBest {
  metric: BestMetric;
  value: number;
  record: RunRecord;
  tiedCount: number;
}

interface MetricSpec {
  metric: BestMetric;
  field: 'distanceKm' | 'durationSeconds' | 'averagePaceSecondsPerKm' | 'elevationGainMeters';
  min: number;
  max: number;
  excludeZero: boolean;
}

const BEST_METRICS: MetricSpec[] = [
  { metric: 'distance', field: 'distanceKm', min: 0, max: 2000, excludeZero: true },
  { metric: 'duration', field: 'durationSeconds', min: 0, max: 604800, excludeZero: true },
  { metric: 'pace', field: 'averagePaceSecondsPerKm', min: 1, max: 7200, excludeZero: true },
  { metric: 'elevation', field: 'elevationGainMeters', min: 0, max: 50000, excludeZero: true },
];

const MIN_PACE_DURATION_SECONDS = 1800;

function validAmount(value: unknown, spec: MetricSpec): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max) return false;
  return spec.excludeZero ? value > 0 : true;
}

// A pace is only comparable between sustained efforts, never a one-minute sprint.
function paceEligible(record: RunRecord, value: number): boolean {
  const duration = record.durationSeconds;
  return typeof duration === 'number' && Number.isFinite(duration) && duration >= MIN_PACE_DURATION_SECONDS;
}

export function getPersonalBests(records: readonly RunRecord[]): PersonalBest[] {
  const bests: PersonalBest[] = [];
  for (const spec of BEST_METRICS) {
    const candidates: { record: RunRecord; value: number }[] = [];
    for (const record of records) {
      if (!isValidRunDate(record.date)) continue;
      const value = record[spec.field];
      if (!validAmount(value, spec)) continue;
      if (spec.metric === 'pace' && !paceEligible(record, value)) continue;
      candidates.push({ record, value });
    }
    if (candidates.length === 0) continue;

    const isPace = spec.metric === 'pace';
    const extreme = isPace
      ? Math.min(...candidates.map(candidate => candidate.value))
      : Math.max(...candidates.map(candidate => candidate.value));
    const tied = candidates.filter(candidate => candidate.value === extreme);
    // Earliest date then time wins; identical day-time keeps the original input order.
    tied.sort((a, b) => {
      const left = dayTimeKey(a.record.date!, a.record.startTime);
      const right = dayTimeKey(b.record.date!, b.record.startTime);
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
    bests.push({ metric: spec.metric, value: extreme, record: tied[0].record, tiedCount: tied.length });
  }
  return bests;
}

export interface SplitAnalysis {
  splits: Split[];
  fastest: Split | null;
  slowest: Split | null;
  firstToLastPaceDeltaSeconds: number | null;
  totalDurationSeconds: number | null;
  durationDifferenceSeconds: number | null;
  excludedPartialCount: number;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validSplitIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2000;
}

function validPace(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 7200;
}

function validSplitDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 86400;
}

function validTotalDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 604800;
}

const emptyAnalysis = (): SplitAnalysis => ({
  splits: [],
  fastest: null,
  slowest: null,
  firstToLastPaceDeltaSeconds: null,
  totalDurationSeconds: null,
  durationDifferenceSeconds: null,
  excludedPartialCount: 0,
});

export function analyzeSplits(record: RunRecord): SplitAnalysis {
  const raw = Array.isArray(record.splits) ? record.splits : [];
  const splits = raw
    .filter((split): split is Split => isRecordObject(split) && validSplitIndex(split.index))
    .slice()
    .sort((a, b) => a.index - b.index);
  if (splits.length === 0) return emptyAnalysis();

  const excludedPartialCount = splits.filter(split => split.isPartialSplit === true).length;
  const duplicateIndex = new Set(splits.map(split => split.index)).size !== splits.length;

  // A duplicate index means the order is ambiguous; report the splits, refuse the summary.
  if (duplicateIndex) {
    return {
      splits,
      fastest: null,
      slowest: null,
      firstToLastPaceDeltaSeconds: null,
      totalDurationSeconds: null,
      durationDifferenceSeconds: null,
      excludedPartialCount,
    };
  }

  const paceSplits = splits.filter(split => split.isPartialSplit !== true && validPace(split.paceSecondsPerKm));
  let fastest: Split | null = null;
  let slowest: Split | null = null;
  for (const split of paceSplits) {
    if (fastest === null || (split.paceSecondsPerKm as number) < (fastest.paceSecondsPerKm as number)) fastest = split;
    if (slowest === null || (split.paceSecondsPerKm as number) > (slowest.paceSecondsPerKm as number)) slowest = split;
  }

  const firstToLastPaceDeltaSeconds = paceSplits.length >= 2
    ? (paceSplits.at(-1)!.paceSecondsPerKm as number) - (paceSplits[0].paceSecondsPerKm as number)
    : null;

  const allDurationsKnown = splits.every(split => validSplitDuration(split.durationSeconds));
  const totalDurationSeconds = allDurationsKnown
    ? splits.reduce((total, split) => total + (split.durationSeconds as number), 0)
    : null;

  const durationDifferenceSeconds = totalDurationSeconds !== null && validTotalDuration(record.durationSeconds)
    ? totalDurationSeconds - record.durationSeconds
    : null;

  return {
    splits,
    fastest,
    slowest,
    firstToLastPaceDeltaSeconds,
    totalDurationSeconds,
    durationDifferenceSeconds,
    excludedPartialCount,
  };
}

export interface CoverageField {
  id: string;
  field: keyof RunRecord;
  label: string;
  kind: 'number' | 'text';
}

// Every optional numeric metric plus the descriptive text fields. Date, start/end
// time and timezone are not run metrics, so they are left out on purpose.
export const coverageFields: CoverageField[] = [
  { id: 'duration', field: 'durationSeconds', label: '运动时长', kind: 'number' },
  { id: 'distance', field: 'distanceKm', label: '运动距离', kind: 'number' },
  { id: 'pace', field: 'averagePaceSecondsPerKm', label: '平均配速', kind: 'number' },
  { id: 'heartRate', field: 'averageHeartRateBpm', label: '平均心率', kind: 'number' },
  { id: 'cadence', field: 'averageCadenceSpm', label: '平均步频', kind: 'number' },
  { id: 'power', field: 'averagePowerWatts', label: '平均功率', kind: 'number' },
  { id: 'activeCalories', field: 'activeCaloriesKcal', label: '动态千卡', kind: 'number' },
  { id: 'totalCalories', field: 'totalCaloriesKcal', label: '总千卡数', kind: 'number' },
  { id: 'elevation', field: 'elevationGainMeters', label: '累计爬升', kind: 'number' },
  { id: 'effort', field: 'effortLevel', label: '耗能等级', kind: 'number' },
  { id: 'temperature', field: 'temperatureCelsius', label: '气温', kind: 'number' },
  { id: 'humidity', field: 'humidityPercent', label: '湿度', kind: 'number' },
  { id: 'airQuality', field: 'airQualityIndex', label: '空气质量指数', kind: 'number' },
  { id: 'location', field: 'location', label: '地点', kind: 'text' },
  { id: 'source', field: 'source', label: '记录设备', kind: 'text' },
  { id: 'effortDescription', field: 'effortDescription', label: '强度描述', kind: 'text' },
];

// Mirrors the record validation ranges exactly; 0 is a known value where allowed.
const COVERAGE_RANGES: Partial<Record<keyof RunRecord, [number, number]>> = {
  durationSeconds: [0, 604800],
  distanceKm: [0, 2000],
  averagePaceSecondsPerKm: [1, 7200],
  averageHeartRateBpm: [20, 250],
  averageCadenceSpm: [1, 300],
  averagePowerWatts: [0, 3000],
  activeCaloriesKcal: [0, 100000],
  totalCaloriesKcal: [0, 100000],
  elevationGainMeters: [0, 50000],
  effortLevel: [1, 10],
  temperatureCelsius: [-90, 70],
  humidityPercent: [0, 100],
  airQualityIndex: [0, 1000],
};

export interface MetricCoverage {
  known: number;
  total: number;
  missingLabels: string[];
}

function isKnown(field: CoverageField, record: RunRecord): boolean {
  const value = record[field.field];
  if (field.kind === 'text') return typeof value === 'string' && value.trim().length > 0;
  const range = COVERAGE_RANGES[field.field];
  if (!range) return false;
  return typeof value === 'number' && Number.isFinite(value) && value >= range[0] && value <= range[1];
}

// This is how completely a run was recorded, not a score of how good the run was.
export function getMetricCoverage(record: RunRecord): MetricCoverage {
  const missingLabels = coverageFields.filter(field => !isKnown(field, record)).map(field => field.label);
  return {
    known: coverageFields.length - missingLabels.length,
    total: coverageFields.length,
    missingLabels,
  };
}
