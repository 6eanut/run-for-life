import { describe, expect, it } from 'vitest';
import { emptyRecord, type RunRecord, type Split } from '../../src/domain/model';
import { SAMPLE_RECORD } from '../../src/domain/sample';
import {
  analyzeSplits,
  coverageFields,
  getMetricCoverage,
  getPersonalBests,
  getRecentRuns,
} from '../../src/domain/run-report';

const run = (changes: Partial<RunRecord>): RunRecord => ({ ...emptyRecord(), ...changes });
const split = (index: number, changes: Partial<Split> = {}): Split => ({
  index,
  durationSeconds: null,
  paceSecondsPerKm: null,
  heartRateBpm: null,
  ...changes,
});

describe('getRecentRuns', () => {
  it('sorts valid training days newest first without mutating the input', () => {
    const records = Object.freeze([
      run({ id: 'old', date: '2026-10-01', startTime: '07:00' }),
      run({ id: 'new', date: '2026-11-02', startTime: '20:58' }),
      run({ id: 'mid', date: '2026-10-15', startTime: '06:30' }),
    ]);
    const result = getRecentRuns(records);
    expect(result.map(record => record.id)).toEqual(['new', 'mid', 'old']);
    expect(result).not.toBe(records);
    expect(records.map(record => record.id)).toEqual(['old', 'new', 'mid']);
  });

  it('orders the same day by start time and keeps equal times stable', () => {
    const records = [
      run({ id: 'late', date: '2026-11-02', startTime: '21:00' }),
      run({ id: 'early', date: '2026-11-02', startTime: '06:00' }),
      run({ id: 'a', date: '2026-11-02', startTime: '12:00' }),
      run({ id: 'b', date: '2026-11-02', startTime: '12:00' }),
    ];
    expect(getRecentRuns(records).map(record => record.id)).toEqual(['late', 'a', 'b', 'early']);
  });

  it('treats missing or malformed times as midnight without a timezone shift', () => {
    const records = [
      run({ id: 'dated', date: '2026-11-02', startTime: null }),
      run({ id: 'noon', date: '2026-11-02', startTime: '12:00' }),
      run({ id: 'bad', date: '2026-11-01', startTime: '25:99' }),
      run({ id: 'prev', date: '2026-11-01', startTime: '23:00' }),
    ];
    expect(getRecentRuns(records).map(record => record.id)).toEqual(['noon', 'dated', 'prev', 'bad']);
  });

  it('drops invalid dates instead of letting the calendar shift them', () => {
    const records = [
      run({ id: 'ok', date: '2026-11-02' }),
      run({ id: 'bad-day', date: '2026-02-30' }),
      run({ id: 'bad-month', date: '2026-13-01' }),
      run({ id: 'loose', date: '2026-1-2' }),
      run({ id: 'none', date: null }),
    ];
    expect(getRecentRuns(records).map(record => record.id)).toEqual(['ok']);
    expect(getRecentRuns([])).toEqual([]);
  });
});

describe('getPersonalBests', () => {
  it('returns every metric in a stable order and reads the sample fields', () => {
    const bests = getPersonalBests([SAMPLE_RECORD]);
    expect(bests.map(best => best.metric)).toEqual(['distance', 'duration', 'pace', 'elevation']);
    const byMetric = new Map(bests.map(best => [best.metric, best]));
    expect(byMetric.get('distance')).toMatchObject({ value: 4.36, tiedCount: 1 });
    expect(byMetric.get('duration')).toMatchObject({ value: 1812, tiedCount: 1 });
    expect(byMetric.get('pace')).toMatchObject({ value: 415, tiedCount: 1 });
    expect(byMetric.get('elevation')).toMatchObject({ value: 9, tiedCount: 1 });
    expect(byMetric.get('distance')!.record).toBe(SAMPLE_RECORD);
  });

  it('omits metrics without a valid record and never invents a best of zero', () => {
    expect(getPersonalBests([
      run({ date: '2026-11-01', distanceKm: 0, durationSeconds: 0, elevationGainMeters: 0 }),
    ])).toEqual([]);
    expect(getPersonalBests([])).toEqual([]);
  });

  it('generalises to a different training day with a negative temperature', () => {
    const cold = [
      run({ date: '2026-01-08', startTime: '05:30', distanceKm: 21.1, durationSeconds: 7200,
        averagePaceSecondsPerKm: 341, elevationGainMeters: 260, temperatureCelsius: -12, averageHeartRateBpm: 148 }),
      run({ date: '2026-01-03', startTime: '18:00', distanceKm: 8, durationSeconds: 2400,
        averagePaceSecondsPerKm: 300, elevationGainMeters: 40, temperatureCelsius: -5 }),
    ];
    const byMetric = new Map(getPersonalBests(cold).map(best => [best.metric, best]));
    expect(byMetric.get('distance')).toMatchObject({ value: 21.1, tiedCount: 1 });
    expect(byMetric.get('distance')!.record.date).toBe('2026-01-08');
    expect(byMetric.get('duration')!.value).toBe(7200);
    expect(byMetric.get('elevation')!.value).toBe(260);
    expect(byMetric.get('pace')!.value).toBe(300);
    expect(byMetric.get('pace')!.record.date).toBe('2026-01-03');
  });

  it('breaks a tie with the earliest date and time and counts the tied runs', () => {
    const distance = getPersonalBests([
      run({ id: 'later', date: '2026-11-04', startTime: '19:00', distanceKm: 5 }),
      run({ id: 'earlier', date: '2026-11-02', startTime: '07:00', distanceKm: 5 }),
      run({ id: 'same-day-later', date: '2026-11-02', startTime: '21:00', distanceKm: 5 }),
    ]).find(best => best.metric === 'distance')!;
    expect(distance.value).toBe(5);
    expect(distance.record.id).toBe('earlier');
    expect(distance.tiedCount).toBe(3);
  });

  it('excludes sub-30-minute efforts from the pace personal best', () => {
    const bests = getPersonalBests([
      run({ id: 'sprint', date: '2026-11-01', durationSeconds: 60, averagePaceSecondsPerKm: 200 }),
      run({ id: 'steady', date: '2026-11-02', durationSeconds: 1800, averagePaceSecondsPerKm: 400 }),
    ]);
    expect(bests.find(best => best.metric === 'pace')).toMatchObject({ value: 400 });
    expect(bests.find(best => best.metric === 'pace')!.record.id).toBe('steady');
    expect(bests.find(best => best.metric === 'duration')!.value).toBe(1800);
  });

  it('omits pace when no effort reaches thirty minutes', () => {
    const bests = getPersonalBests([run({ date: '2026-11-01', durationSeconds: 1799, averagePaceSecondsPerKm: 300 })]);
    expect(bests.some(best => best.metric === 'pace')).toBe(false);
  });

  it('keeps only the smallest positive pace inside the domain range', () => {
    const pace = getPersonalBests([
      run({ date: '2026-11-01', durationSeconds: 1800, averagePaceSecondsPerKm: 0 }),
      run({ date: '2026-11-02', durationSeconds: 1800, averagePaceSecondsPerKm: 7201 }),
      run({ date: '2026-11-03', durationSeconds: 1800, averagePaceSecondsPerKm: 7200 }),
      run({ date: '2026-11-04', durationSeconds: 1800, averagePaceSecondsPerKm: 350 }),
    ]).find(best => best.metric === 'pace')!;
    expect(pace.value).toBe(350);
  });

  it('ignores non-finite, negative, zero and out-of-range values', () => {
    const bests = getPersonalBests([
      run({ date: '2026-11-01', distanceKm: Infinity }),
      run({ date: '2026-11-02', distanceKm: -3 }),
      run({ date: '2026-11-03', distanceKm: 5000 }),
      run({ date: '2026-11-04', distanceKm: 12 }),
      run({ date: '2026-11-05', durationSeconds: NaN, elevationGainMeters: -1 }),
    ]);
    expect(bests.find(best => best.metric === 'distance')).toMatchObject({ value: 12, tiedCount: 1 });
    expect(bests.some(best => best.metric === 'duration')).toBe(false);
    expect(bests.some(best => best.metric === 'pace')).toBe(false);
    expect(bests.some(best => best.metric === 'elevation')).toBe(false);
  });

  it('drops records with invalid dates and never rewards a low heart rate or a challenge flag', () => {
    expect(getPersonalBests([
      run({ date: '2026-02-30', distanceKm: 100 }),
      run({ date: null, durationSeconds: 99999 }),
    ])).toEqual([]);
    expect(getPersonalBests([
      run({ date: '2026-11-01', averageHeartRateBpm: 45, challenge: { requiredDurationSeconds: 1800, completed: true, completedCount: 99 } }),
    ])).toEqual([]);
  });

  it('does not mutate a frozen input array', () => {
    const records = Object.freeze([Object.freeze(run({ id: 'a', date: '2026-11-02', distanceKm: 5 }))]);
    expect(() => getPersonalBests(records)).not.toThrow();
    expect(records[0].distanceKm).toBe(5);
  });
});

describe('analyzeSplits', () => {
  it('summarises the sample splits and keeps the partial last split out of pace comparison', () => {
    const analysis = analyzeSplits(SAMPLE_RECORD);
    expect(Object.keys(analysis).sort()).toEqual([
      'durationDifferenceSeconds', 'excludedPartialCount', 'fastest', 'firstToLastPaceDeltaSeconds',
      'slowest', 'splits', 'totalDurationSeconds',
    ]);
    expect(analysis.splits.map(item => item.index)).toEqual([1, 2, 3, 4, 5]);
    expect(analysis.fastest).toMatchObject({ index: 1, paceSecondsPerKm: 339 });
    expect(analysis.slowest).toMatchObject({ index: 4, paceSecondsPerKm: 439 });
    expect(analysis.firstToLastPaceDeltaSeconds).toBe(100);
    expect(analysis.totalDurationSeconds).toBe(1812);
    expect(analysis.durationDifferenceSeconds).toBe(0);
    expect(analysis.excludedPartialCount).toBe(1);
  });

  it('sorts by index into a new array without mutating the record', () => {
    const splits = Object.freeze([
      split(3, { durationSeconds: 300, paceSecondsPerKm: 420 }),
      split(1, { durationSeconds: 300, paceSecondsPerKm: 400 }),
      split(2, { durationSeconds: 300, paceSecondsPerKm: 410 }),
    ]) as Split[];
    const analysis = analyzeSplits(run({ date: '2026-11-02', durationSeconds: 900, splits }));
    expect(analysis.splits.map(item => item.index)).toEqual([1, 2, 3]);
    expect(analysis.splits).not.toBe(splits);
    expect(splits.map(item => item.index)).toEqual([3, 1, 2]);
    expect(analysis.fastest!.index).toBe(1);
    expect(analysis.slowest!.index).toBe(3);
    expect(analysis.firstToLastPaceDeltaSeconds).toBe(20);
    expect(analysis.totalDurationSeconds).toBe(900);
    expect(analysis.durationDifferenceSeconds).toBe(0);
  });

  it('returns nulls when there are no usable splits', () => {
    expect(analyzeSplits(emptyRecord())).toEqual({
      splits: [], fastest: null, slowest: null, firstToLastPaceDeltaSeconds: null,
      totalDurationSeconds: null, durationDifferenceSeconds: null, excludedPartialCount: 0,
    });
  });

  it('handles a single split without inventing a first-to-last delta', () => {
    const analysis = analyzeSplits(run({
      date: '2026-11-02', durationSeconds: 600,
      splits: [split(1, { durationSeconds: 600, paceSecondsPerKm: 500 })],
    }));
    expect(analysis.fastest).toMatchObject({ index: 1, paceSecondsPerKm: 500 });
    expect(analysis.slowest).toMatchObject({ index: 1, paceSecondsPerKm: 500 });
    expect(analysis.firstToLastPaceDeltaSeconds).toBeNull();
    expect(analysis.totalDurationSeconds).toBe(600);
    expect(analysis.durationDifferenceSeconds).toBe(0);
  });

  it('safely ignores non-objects and invalid indices', () => {
    const analysis = analyzeSplits(run({
      date: '2026-11-02', durationSeconds: 600,
      splits: [
        split(1, { durationSeconds: 300, paceSecondsPerKm: 400 }),
        null as unknown as Split,
        split(0, { durationSeconds: 100, paceSecondsPerKm: 400 }),
        split(2.5, { durationSeconds: 100, paceSecondsPerKm: 400 }),
        split(3000, { durationSeconds: 100, paceSecondsPerKm: 400 }),
      ],
    }));
    expect(analysis.splits.map(item => item.index)).toEqual([1]);
    expect(analysis.totalDurationSeconds).toBe(300);
  });

  it('refuses the split total when any split duration is missing or invalid', () => {
    const analysis = analyzeSplits(run({
      date: '2026-11-02', durationSeconds: 600,
      splits: [
        split(1, { durationSeconds: 300, paceSecondsPerKm: 400 }),
        split(2, { durationSeconds: null, paceSecondsPerKm: 410 }),
      ],
    }));
    expect(analysis.totalDurationSeconds).toBeNull();
    expect(analysis.durationDifferenceSeconds).toBeNull();

    const fractional = analyzeSplits(run({
      date: '2026-11-02', durationSeconds: 600,
      splits: [split(1, { durationSeconds: 300.5, paceSecondsPerKm: 400 })],
    }));
    expect(fractional.totalDurationSeconds).toBeNull();
  });

  it('includes a partial split in the total but not in the pace comparison', () => {
    const analysis = analyzeSplits(run({
      date: '2026-11-02', durationSeconds: 900,
      splits: [
        split(1, { durationSeconds: 600, paceSecondsPerKm: 400 }),
        split(2, { durationSeconds: 300, paceSecondsPerKm: 700, isPartialSplit: true }),
      ],
    }));
    expect(analysis.totalDurationSeconds).toBe(900);
    expect(analysis.durationDifferenceSeconds).toBe(0);
    expect(analysis.excludedPartialCount).toBe(1);
    expect(analysis.fastest).toMatchObject({ index: 1 });
    expect(analysis.slowest).toMatchObject({ index: 1 });
    expect(analysis.firstToLastPaceDeltaSeconds).toBeNull();
  });

  it('breaks a fastest or slowest pace tie with the smallest index', () => {
    const analysis = analyzeSplits(run({
      date: '2026-11-02', durationSeconds: 900,
      splits: [
        split(2, { durationSeconds: 300, paceSecondsPerKm: 400 }),
        split(1, { durationSeconds: 300, paceSecondsPerKm: 400 }),
        split(3, { durationSeconds: 300, paceSecondsPerKm: 500 }),
      ],
    }));
    expect(analysis.fastest!.index).toBe(1);
    expect(analysis.slowest!.index).toBe(3);
    expect(analysis.firstToLastPaceDeltaSeconds).toBe(100);
  });

  it('ignores non-finite and out-of-range paces', () => {
    const analysis = analyzeSplits(run({
      date: '2026-11-02', durationSeconds: 900,
      splits: [
        split(1, { durationSeconds: 300, paceSecondsPerKm: NaN }),
        split(2, { durationSeconds: 300, paceSecondsPerKm: 0 }),
        split(3, { durationSeconds: 300, paceSecondsPerKm: 7201 }),
        split(4, { durationSeconds: 300, paceSecondsPerKm: 450 }),
      ],
    }));
    expect(analysis.fastest).toMatchObject({ index: 4 });
    expect(analysis.slowest).toMatchObject({ index: 4 });
    expect(analysis.firstToLastPaceDeltaSeconds).toBeNull();
  });

  it('refuses every summary when two splits share an index', () => {
    const analysis = analyzeSplits(run({
      date: '2026-11-02', durationSeconds: 900,
      splits: [
        split(1, { durationSeconds: 300, paceSecondsPerKm: 400 }),
        split(1, { durationSeconds: 300, paceSecondsPerKm: 410 }),
        split(2, { durationSeconds: 300, paceSecondsPerKm: 430 }),
      ],
    }));
    expect(analysis.splits.map(item => item.index)).toEqual([1, 1, 2]);
    expect(analysis.fastest).toBeNull();
    expect(analysis.slowest).toBeNull();
    expect(analysis.firstToLastPaceDeltaSeconds).toBeNull();
    expect(analysis.totalDurationSeconds).toBeNull();
    expect(analysis.durationDifferenceSeconds).toBeNull();
  });

  it('only reports a duration difference when both sides are complete and legal', () => {
    const missing = analyzeSplits(run({
      date: '2026-11-02', durationSeconds: null,
      splits: [split(1, { durationSeconds: 300, paceSecondsPerKm: 400 })],
    }));
    expect(missing.totalDurationSeconds).toBe(300);
    expect(missing.durationDifferenceSeconds).toBeNull();

    const infinite = analyzeSplits(run({
      date: '2026-11-02', durationSeconds: Infinity,
      splits: [split(1, { durationSeconds: 300, paceSecondsPerKm: 400 })],
    }));
    expect(infinite.durationDifferenceSeconds).toBeNull();
  });
});

describe('getMetricCoverage', () => {
  it('defines thirteen numeric metrics plus three text fields', () => {
    expect(coverageFields).toHaveLength(16);
    expect(coverageFields.filter(field => field.kind === 'number')).toHaveLength(13);
    expect(coverageFields.filter(field => field.kind === 'text')).toHaveLength(3);
  });

  it('reports a fully recorded sample as complete', () => {
    expect(getMetricCoverage(SAMPLE_RECORD)).toEqual({ known: 16, total: 16, missingLabels: [] });
  });

  it('reports everything missing for an empty record without counting empty arrays', () => {
    const coverage = getMetricCoverage(run({ awards: [], splits: [] }));
    expect(coverage.known).toBe(0);
    expect(coverage.total).toBe(16);
    expect(coverage.missingLabels).toHaveLength(16);
  });

  it('treats zero as known and blank text as missing', () => {
    const coverage = getMetricCoverage(run({
      date: '2026-11-02',
      distanceKm: 0, activeCaloriesKcal: 0, totalCaloriesKcal: 0, elevationGainMeters: 0,
      location: '   ', source: '', effortDescription: null,
    }));
    expect(coverage.known).toBe(4);
    expect(coverage.missingLabels).toContain('地点');
    expect(coverage.missingLabels).toContain('记录设备');
    expect(coverage.missingLabels).toContain('强度描述');
    expect(coverage.missingLabels).not.toContain('运动距离');
  });

  it('accepts negative temperature inside the range and rejects values outside record ranges', () => {
    const inRange = getMetricCoverage(run({ temperatureCelsius: -90, humidityPercent: 0, effortLevel: 1 }));
    expect(inRange.missingLabels).not.toContain('气温');
    expect(inRange.missingLabels).not.toContain('湿度');
    expect(inRange.missingLabels).not.toContain('耗能等级');

    const outOfRange = getMetricCoverage(run({
      temperatureCelsius: -91, averageHeartRateBpm: 900, averageCadenceSpm: 0,
      humidityPercent: 101, averagePaceSecondsPerKm: 0, effortLevel: 11,
    }));
    expect(outOfRange.missingLabels).toContain('气温');
    expect(outOfRange.missingLabels).toContain('平均心率');
    expect(outOfRange.missingLabels).toContain('平均步频');
    expect(outOfRange.missingLabels).toContain('湿度');
    expect(outOfRange.missingLabels).toContain('平均配速');
    expect(outOfRange.missingLabels).toContain('耗能等级');
  });

  it('counts non-finite numbers as missing rather than known', () => {
    const coverage = getMetricCoverage(run({ distanceKm: NaN, averagePowerWatts: Infinity }));
    expect(coverage.missingLabels).toContain('运动距离');
    expect(coverage.missingLabels).toContain('平均功率');
  });
});
