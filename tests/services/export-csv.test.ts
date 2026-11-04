import { describe, expect, it } from 'vitest';
import { SAMPLE_RECORD } from '../../src/domain/sample';
import { emptyRecord, type RunRecord } from '../../src/domain/model';
import {
  exportRunsCsv,
  exportSplitsCsv,
  RUNS_CSV_COLUMNS,
  SPLITS_CSV_COLUMNS,
} from '../../src/services/export-csv';

// Minimal RFC-4180 reader (quotes, doubled quotes, embedded CRLF) so tests can
// assert on parsed cells instead of brittle substring matches.
function parseCsv(csv: string): string[][] {
  const body = csv.startsWith('\uFEFF') ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') { cell += '"'; i += 1; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\r' && body[i + 1] === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; i += 1; }
    else if (ch === '\n') { row.push(cell); cell = ''; rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function runsObject(csv: string): Record<string, string> {
  const rows = parseCsv(csv);
  const headers = rows[0];
  return Object.fromEntries(headers.map((header, index) => [header, rows[1][index]]));
}

const partial = (overrides: Partial<RunRecord>): RunRecord => ({ ...emptyRecord(), ...overrides });

describe('CSV envelope', () => {
  it('starts with a UTF-8 BOM and uses CRLF row endings', () => {
    const csv = exportRunsCsv([SAMPLE_RECORD]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.split('\r\n').length).toBeGreaterThan(1);
  });

  it('emits BOM + header + CRLF for an empty record list', () => {
    const csv = exportRunsCsv([]);
    expect(csv).toBe(`\uFEFF${RUNS_CSV_COLUMNS.map(column => column.header).join(',')}\r\n`);
    expect(parseCsv(csv)).toHaveLength(1);
  });

  it('emits splits header only when there are no splits', () => {
    const csv = exportSplitsCsv([]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(parseCsv(csv)).toHaveLength(1);
    expect(parseCsv(csv)[0]).toEqual(SPLITS_CSV_COLUMNS.map(column => column.header));
  });

  it('emits splits header only for a record with an empty split list', () => {
    const csv = exportSplitsCsv([partial({ splits: [] })]);
    expect(parseCsv(csv)).toHaveLength(1);
  });
});

describe('runs CSV values', () => {
  it('writes every key sample field with units in the headers', () => {
    const row = runsObject(exportRunsCsv([SAMPLE_RECORD]));
    expect(row['日期']).toBe('2026-11-02');
    expect(row['开始时间']).toBe('20:58');
    expect(row['结束时间']).toBe('21:29');
    expect(row['运动类型']).toBe('户外跑步');
    expect(row['时区']).toBe('Asia/Shanghai');
    expect(row['运动时长（秒）']).toBe('1812');
    expect(row['距离（公里）']).toBe('4.36');
    expect(row['平均配速（秒/公里）']).toBe('415');
    expect(row['平均心率（次/分）']).toBe('161');
    expect(row['平均步频（步/分）']).toBe('161');
    expect(row['平均功率（瓦）']).toBe('177');
    expect(row['动态千卡']).toBe('279');
    expect(row['总千卡']).toBe('324');
    expect(row['爬升（米）']).toBe('9');
    expect(row['运动强度（1–10）']).toBe('6');
    expect(row['强度描述']).toBe('适中');
    expect(row['气温（°C）']).toBe('10');
    expect(row['湿度（%）']).toBe('60');
    expect(row['AQI']).toBe('95');
    expect(row['地点']).toBe('中国北京市');
    expect(row['设备']).toBe('Apple Watch');
    expect(row['奖章']).toBe('首次跑步训练');
    expect(row['30分钟挑战是否完成']).toBe('是');
  });

  it('maps known activity types to Chinese and passes unknown ones through', () => {
    expect(runsObject(exportRunsCsv([partial({ activityType: 'outdoor_running' })]))['运动类型']).toBe('户外跑步');
    expect(runsObject(exportRunsCsv([partial({ activityType: 'indoor_running' })]))['运动类型']).toBe('室内跑步');
    expect(runsObject(exportRunsCsv([partial({ activityType: 'running' })]))['运动类型']).toBe('跑步');
    expect(runsObject(exportRunsCsv([partial({ activityType: 'trail_running' })]))['运动类型']).toBe('trail_running');
    expect(runsObject(exportRunsCsv([partial({ activityType: null })]))['运动类型']).toBe('');
  });

  it('distinguishes unknown null from a real zero', () => {
    const row = runsObject(exportRunsCsv([partial({ distanceKm: 0, elevationGainMeters: 0, averagePaceSecondsPerKm: null })]));
    expect(row['距离（公里）']).toBe('0');
    expect(row['爬升（米）']).toBe('0');
    expect(row['平均配速（秒/公里）']).toBe('');
  });

  it('keeps negative temperatures and other real numbers unchanged', () => {
    const row = runsObject(exportRunsCsv([partial({ temperatureCelsius: -12, averageHeartRateBpm: 0 })]));
    expect(row['气温（°C）']).toBe('-12');
    expect(row['平均心率（次/分）']).toBe('0');
  });

  it('never emits NaN or Infinity for a numeric field', () => {
    const row = runsObject(exportRunsCsv([partial({ distanceKm: Number.NaN, averagePowerWatts: Number.POSITIVE_INFINITY })]));
    expect(row['距离（公里）']).toBe('');
    expect(row['平均功率（瓦）']).toBe('');
  });

  it('uses the explicit duration and never derives it from start/end times', () => {
    const explicit = partial({ startTime: '20:58', endTime: '21:29', durationSeconds: 1812 });
    expect(runsObject(exportRunsCsv([explicit]))['运动时长（秒）']).toBe('1812');
    const derived = partial({ startTime: '20:58', endTime: '21:29', durationSeconds: null });
    expect(runsObject(exportRunsCsv([derived]))['运动时长（秒）']).toBe('');
  });

  it('does not derive a missing pace from distance and duration', () => {
    const row = runsObject(exportRunsCsv([partial({ distanceKm: 4.36, durationSeconds: 1812, averagePaceSecondsPerKm: null })]));
    expect(row['平均配速（秒/公里）']).toBe('');
  });

  it('recomputes the 30-minute challenge instead of trusting the stored flag', () => {
    const fakeDone = partial({ durationSeconds: 100, challenge: { requiredDurationSeconds: 1800, completed: true, completedCount: 1 } });
    expect(runsObject(exportRunsCsv([fakeDone]))['30分钟挑战是否完成']).toBe('否');
    const fakeUndone = partial({ durationSeconds: 3600, challenge: { requiredDurationSeconds: 1800, completed: false, completedCount: 0 } });
    expect(runsObject(exportRunsCsv([fakeUndone]))['30分钟挑战是否完成']).toBe('是');
    const unknown = partial({ durationSeconds: null });
    expect(runsObject(exportRunsCsv([unknown]))['30分钟挑战是否完成']).toBe('');
  });

  it('joins awards with a Chinese semicolon', () => {
    const row = runsObject(exportRunsCsv([partial({ awards: ['首次跑步训练', '最长距离'] })]));
    expect(row['奖章']).toBe('首次跑步训练；最长距离');
    expect(runsObject(exportRunsCsv([partial({ awards: [] })]))['奖章']).toBe('');
  });
});

describe('CSV quoting and formula-injection safety', () => {
  it('quotes text that contains a comma, quote or newline', () => {
    const csv = exportRunsCsv([partial({ location: '中国,北京', source: 'a"b', effortDescription: '第一行\n第二行' })]);
    const row = runsObject(csv);
    expect(row['地点']).toBe('中国,北京');
    expect(row['设备']).toBe('a"b');
    expect(row['强度描述']).toBe('第一行\n第二行');
    expect(csv).toContain('"中国,北京"');
    expect(csv).toContain('"a""b"');
    expect(csv).toContain('"第一行\n第二行"');
  });

  it('prefixes leading = + - @ (after whitespace) with a single quote without deleting content', () => {
    expect(runsObject(exportRunsCsv([partial({ source: '=1+1' })]))['设备']).toBe("'=1+1");
    expect(runsObject(exportRunsCsv([partial({ source: '+cmd' })]))['设备']).toBe("'+cmd");
    expect(runsObject(exportRunsCsv([partial({ source: '-cmd' })]))['设备']).toBe("'-cmd");
    expect(runsObject(exportRunsCsv([partial({ source: '@cmd' })]))['设备']).toBe("'@cmd");
    expect(runsObject(exportRunsCsv([partial({ location: '  =HYPERLINK("x")' })]))['地点']).toBe(`'  =HYPERLINK("x")`);
    expect(runsObject(exportRunsCsv([partial({ source: '\t=2' })]))['设备']).toBe("'\t=2");
  });

  it('also neutralizes injection in id and awards text', () => {
    const row = runsObject(exportRunsCsv([partial({ id: '=ID', awards: ['=AWARD'] })]));
    expect(row['记录ID']).toBe("'=ID");
    expect(row['奖章']).toBe("'=AWARD");
  });

  it('leaves ordinary text and real numbers untouched', () => {
    const row = runsObject(exportRunsCsv([partial({ location: '北京市', source: 'Apple Watch', temperatureCelsius: -12 })]));
    expect(row['地点']).toBe('北京市');
    expect(row['设备']).toBe('Apple Watch');
    expect(row['气温（°C）']).toBe('-12');
  });
});

describe('splits CSV', () => {
  it('writes one row per real split and keeps the last partial split values independent', () => {
    const rows = parseCsv(exportSplitsCsv([SAMPLE_RECORD]));
    expect(rows).toHaveLength(1 + SAMPLE_RECORD.splits.length);
    const last = rows.at(-1)!;
    const headers = rows[0];
    const row = Object.fromEntries(headers.map((header, index) => [header, last[index]]));
    expect(row['训练ID']).toBe('');
    expect(row['日期']).toBe('2026-11-02');
    expect(row['开始时间']).toBe('20:58');
    expect(row['分段序号']).toBe('5');
    expect(row['分段时长（秒）']).toBe('181');
    expect(row['分段配速（秒/公里）']).toBe('492');
    expect(row['分段心率（次/分）']).toBe('155');
    expect(row['是否不足1公里末段']).toBe('是');
  });

  it('does not treat a split duration as a pace', () => {
    const split = { index: 1, durationSeconds: 339, paceSecondsPerKm: null, heartRateBpm: null };
    const row = Object.fromEntries(
      SPLITS_CSV_COLUMNS.map((column, index) => [column.header, parseCsv(exportSplitsCsv([partial({ splits: [split] })]))[1][index]]),
    );
    expect(row['分段时长（秒）']).toBe('339');
    expect(row['分段配速（秒/公里）']).toBe('');
  });

  it('writes yes/no/empty for the partial split marker', () => {
    const splits = [
      { index: 1, durationSeconds: 300, paceSecondsPerKm: 300, heartRateBpm: 150, isPartialSplit: true },
      { index: 2, durationSeconds: 300, paceSecondsPerKm: 300, heartRateBpm: 150, isPartialSplit: false },
      { index: 3, durationSeconds: 300, paceSecondsPerKm: 300, heartRateBpm: 150 },
    ];
    const rows = parseCsv(exportSplitsCsv([partial({ splits })]));
    const headerIndex = SPLITS_CSV_COLUMNS.findIndex(column => column.header === '是否不足1公里末段');
    expect(rows[1][headerIndex]).toBe('是');
    expect(rows[2][headerIndex]).toBe('否');
    expect(rows[3][headerIndex]).toBe('');
  });

  it('reports a missing split id, date and start time as empty', () => {
    const rows = parseCsv(exportSplitsCsv([partial({ date: null, startTime: null, splits: [{ index: 1, durationSeconds: 300, paceSecondsPerKm: 300, heartRateBpm: 150 }] })]));
    expect(rows[1][0]).toBe('');
    expect(rows[1][1]).toBe('');
    expect(rows[1][2]).toBe('');
  });

  it('does not mutate or reorder frozen input records', () => {
    const record = partial({ id: 'r1', splits: [
      { index: 2, durationSeconds: 416, paceSecondsPerKm: 416, heartRateBpm: 167 },
      { index: 1, durationSeconds: 339, paceSecondsPerKm: 339, heartRateBpm: 157 },
    ] });
    Object.freeze(record);
    Object.freeze(record.splits);
    record.splits.forEach(split => Object.freeze(split));
    const before = JSON.stringify(record);
    const runs = exportRunsCsv([record]);
    const splits = exportSplitsCsv([record]);
    expect(JSON.stringify(record)).toBe(before);
    expect(runs).toContain('记录ID');
    // Input order is preserved, not sorted by index.
    const rows = parseCsv(splits);
    expect(rows[1][3]).toBe('2');
    expect(rows[2][3]).toBe('1');
  });

  it('preserves the input record order across multiple records', () => {
    const first = partial({ id: 'first' });
    const second = partial({ id: 'second' });
    const rows = parseCsv(exportRunsCsv([second, first]));
    expect(rows[1][0]).toBe('second');
    expect(rows[2][0]).toBe('first');
  });
});
