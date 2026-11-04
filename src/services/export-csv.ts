import type { RunRecord, Split } from '../domain/model';

const BOM = '\uFEFF';
const CRLF = '\r\n';

// A dangerous spreadsheet formula starts with one of these once leading
// whitespace (space, tab, CR, LF, BOM, ...) is ignored.
const FORMULA_PREFIX = /^[=+\-@]/;

// Text import is user editable, so neutralize formula injection while keeping
// the original content intact by prefixing a single quote.
function textCell(value: unknown): string {
  if (typeof value !== 'string') return '';
  const stripped = value.replace(/^\s+/, '');
  return FORMULA_PREFIX.test(stripped) ? `'${value}` : value;
}

// A real number is never a formula; unknown values stay empty instead of 0.
function numberCell(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return String(value);
}

// Recompute the 30-minute challenge from the explicit duration, never the flag.
function challengeCell(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return value >= 1800 ? '是' : '否';
}

function activityTypeCell(value: unknown): string {
  if (typeof value !== 'string') return '';
  switch (value) {
    case 'outdoor_running': return '户外跑步';
    case 'indoor_running': return '室内跑步';
    case 'running': return '跑步';
    default: return textCell(value);
  }
}

function awardsCell(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return textCell(value.filter((award): award is string => typeof award === 'string').join('；'));
}

function partialSplitCell(value: unknown): string {
  if (value === true) return '是';
  if (value === false) return '否';
  return '';
}

export interface CsvColumn<T> {
  header: string;
  cell: (input: T) => string;
}

export const RUNS_CSV_COLUMNS: readonly CsvColumn<RunRecord>[] = [
  { header: '记录ID', cell: record => textCell(record.id) },
  { header: '日期', cell: record => textCell(record.date) },
  { header: '开始时间', cell: record => textCell(record.startTime) },
  { header: '结束时间', cell: record => textCell(record.endTime) },
  { header: '运动类型', cell: record => activityTypeCell(record.activityType) },
  { header: '时区', cell: record => textCell(record.timezone) },
  { header: '运动时长（秒）', cell: record => numberCell(record.durationSeconds) },
  { header: '距离（公里）', cell: record => numberCell(record.distanceKm) },
  { header: '平均配速（秒/公里）', cell: record => numberCell(record.averagePaceSecondsPerKm) },
  { header: '平均心率（次/分）', cell: record => numberCell(record.averageHeartRateBpm) },
  { header: '平均步频（步/分）', cell: record => numberCell(record.averageCadenceSpm) },
  { header: '平均功率（瓦）', cell: record => numberCell(record.averagePowerWatts) },
  { header: '动态千卡', cell: record => numberCell(record.activeCaloriesKcal) },
  { header: '总千卡', cell: record => numberCell(record.totalCaloriesKcal) },
  { header: '爬升（米）', cell: record => numberCell(record.elevationGainMeters) },
  { header: '运动强度（1–10）', cell: record => numberCell(record.effortLevel) },
  { header: '强度描述', cell: record => textCell(record.effortDescription) },
  { header: '气温（°C）', cell: record => numberCell(record.temperatureCelsius) },
  { header: '湿度（%）', cell: record => numberCell(record.humidityPercent) },
  { header: 'AQI', cell: record => numberCell(record.airQualityIndex) },
  { header: '地点', cell: record => textCell(record.location) },
  { header: '设备', cell: record => textCell(record.source) },
  { header: '奖章', cell: record => awardsCell(record.awards) },
  { header: '30分钟挑战是否完成', cell: record => challengeCell(record.durationSeconds) },
];

export interface SplitRow {
  record: RunRecord;
  split: Split;
}

export const SPLITS_CSV_COLUMNS: readonly CsvColumn<SplitRow>[] = [
  { header: '训练ID', cell: ({ record }) => textCell(record.id) },
  { header: '日期', cell: ({ record }) => textCell(record.date) },
  { header: '开始时间', cell: ({ record }) => textCell(record.startTime) },
  { header: '分段序号', cell: ({ split }) => numberCell(split.index) },
  { header: '分段时长（秒）', cell: ({ split }) => numberCell(split.durationSeconds) },
  { header: '分段配速（秒/公里）', cell: ({ split }) => numberCell(split.paceSecondsPerKm) },
  { header: '分段心率（次/分）', cell: ({ split }) => numberCell(split.heartRateBpm) },
  { header: '是否不足1公里末段', cell: ({ split }) => partialSplitCell(split.isPartialSplit) },
];

// Strict RFC-4180 quoting: wrap when the value contains a comma, quote or line break.
function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function serialize<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map(column => escapeCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map(column => escapeCell(column.cell(row))).join(','));
  }
  return `${BOM}${lines.join(CRLF)}${CRLF}`;
}

export function exportRunsCsv(records: readonly RunRecord[]): string {
  return serialize(RUNS_CSV_COLUMNS, records);
}

export function exportSplitsCsv(records: readonly RunRecord[]): string {
  const rows: SplitRow[] = [];
  for (const record of records) {
    if (!Array.isArray(record.splits)) continue;
    for (const split of record.splits) {
      if (split && typeof split === 'object') rows.push({ record, split });
    }
  }
  return serialize(SPLITS_CSV_COLUMNS, rows);
}
