import { describe, expect, it } from 'vitest';
import { emptyRecord, type RunRecord } from '../../src/domain/model';
import { chartGeometry, formatMetricValue, getMonthlyActivity, getTrendSeries, trendMetrics } from '../../src/domain/trends';

const run = (changes: Partial<RunRecord>): RunRecord => ({ ...emptyRecord(), ...changes });

describe('running trends', () => {
  it('sorts on the local workout date and time without mutating records', () => {
    const records = Object.freeze([
      run({ id: 'late', date: '2026-11-04', startTime: '19:00', distanceKm: 5 }),
      run({ id: 'early', date: '2026-11-02', startTime: '07:00', distanceKm: 3 }),
      run({ id: 'morning', date: '2026-11-04', startTime: '06:00', distanceKm: 4 }),
    ]);
    const result = getTrendSeries(records, 'distance');
    expect(result.points.map(point => point.key)).toEqual(['early', 'morning', 'late']);
    expect(records[0].id).toBe('late');
  });

  it('excludes missing and impossible dates rather than assigning today', () => {
    const result = getTrendSeries([
      run({ date: null }), run({ date: '2026-02-30' }), run({ date: '2026-1-2' }),
      run({ date: '2026-11-02', distanceKm: 4.36 }),
    ], 'distance');
    expect(result.excludedDateCount).toBe(3);
    expect(result.points).toHaveLength(1);
  });

  it('accepts leap days and keeps records with unknown time', () => {
    const result = getTrendSeries([run({ date: '2024-02-29', startTime: null })], 'distance');
    expect(result.points[0]).toMatchObject({ date: '2024-02-29', time: null });
    expect(Number.isFinite(result.points[0].timestamp)).toBe(true);
  });

  it('keeps unknown metrics as gaps and does not invent zero measurements', () => {
    const result = getTrendSeries([
      run({ date: '2026-11-01', averageHeartRateBpm: 150 }),
      run({ date: '2026-11-02', averageHeartRateBpm: null }),
      run({ date: '2026-11-03', averageHeartRateBpm: 145 }),
    ], 'heartRate');
    expect(result.points.map(point => point.value)).toEqual([150, null, 145]);
    expect(chartGeometry(result.points).paths).toHaveLength(2);
  });

  it('treats nonfinite or negative measurements as unknown', () => {
    const result = getTrendSeries([
      run({ date: '2026-11-01', distanceKm: Infinity }),
      run({ date: '2026-11-02', distanceKm: -1 }),
      run({ date: '2026-11-03', distanceKm: 0 }),
    ], 'distance');
    expect(result.points.map(point => point.value)).toEqual([null, null, 0]);
  });

  it('uses elapsed calendar time for horizontal spacing', () => {
    const result = getTrendSeries([
      run({ date: '2026-11-01', distanceKm: 1 }),
      run({ date: '2026-11-02', distanceKm: 2 }),
      run({ date: '2026-11-11', distanceKm: 3 }),
    ], 'distance');
    const geometry = chartGeometry(result.points);
    const [first, second, third] = geometry.points;
    expect((second.x - first.x) / (third.x - first.x)).toBeCloseTo(0.1);
  });

  it('places same-day runs at their actual time positions', () => {
    const result = getTrendSeries([
      run({ date: '2026-11-01', startTime: '08:00', distanceKm: 1 }),
      run({ date: '2026-11-01', startTime: '12:00', distanceKm: 2 }),
      run({ date: '2026-11-01', startTime: '20:00', distanceKm: 3 }),
    ], 'distance');
    const [first, second, third] = chartGeometry(result.points).points;
    expect((second.x - first.x) / (third.x - first.x)).toBeCloseTo(1 / 3);
  });

  it('centers a single measurement with a finite vertical domain', () => {
    const geometry = chartGeometry(getTrendSeries([run({ date: '2026-11-01', distanceKm: 4 })], 'distance').points);
    expect(geometry.points[0].x).toBe(400);
    expect(geometry.points[0].y).toBe(130);
    expect(geometry.min).toBeLessThan(4);
    expect(geometry.max).toBeGreaterThan(4);
  });

  it('handles zero, all-null and empty histories without invalid coordinates', () => {
    const zero = chartGeometry(getTrendSeries([run({ date: '2026-11-01', distanceKm: 0 })], 'distance').points);
    expect(Number.isFinite(zero.points[0].y)).toBe(true);
    expect(zero.min).toBe(0);
    const missing = chartGeometry(getTrendSeries([run({ date: '2026-11-01' })], 'distance').points);
    expect(missing.points[0].y).toBeNull();
    expect(missing.paths).toEqual([]);
    expect(chartGeometry([]).points).toEqual([]);
  });

  it('can show faster pace higher while ordinary metric values rise upwards', () => {
    const points = getTrendSeries([
      run({ date: '2026-11-01', averagePaceSecondsPerKm: 400 }),
      run({ date: '2026-11-02', averagePaceSecondsPerKm: 360 }),
    ], 'pace').points;
    expect(chartGeometry(points, true).points[1].y).toBeLessThan(chartGeometry(points, true).points[0].y!);
    expect(chartGeometry(points).points[0].y).toBeLessThan(chartGeometry(points).points[1].y!);
  });

  it.each(trendMetrics)('reads the $id metric from its own field', metric => {
    const record = run({ date: '2026-11-01', distanceKm: 4, durationSeconds: 1800, averagePaceSecondsPerKm: 450, averageHeartRateBpm: 155, averageCadenceSpm: 160, averagePowerWatts: 175 });
    expect(getTrendSeries([record], metric.id).points[0].value).toBe(record[metric.field]);
  });

  it('formats metric values with correct pace rounding and missing values', () => {
    expect(formatMetricValue('pace', 419.9)).toBe('7′00″');
    expect(formatMetricValue('distance', 4.36)).toBe('4.36');
    expect(formatMetricValue('duration', 1812)).toBe('30:12');
    expect(formatMetricValue('heartRate', 161)).toBe('161');
    expect(formatMetricValue('distance', null)).toBe('未记录');
  });
});

describe('monthly running activity', () => {
  it('aggregates both runs on one day and fills calendar months with no runs', () => {
    const result = getMonthlyActivity([
      run({ date: '2026-09-01', distanceKm: 4, challenge: { requiredDurationSeconds: 1800, completed: true, completedCount: 1 } }),
      run({ date: '2026-09-01', distanceKm: 3 }),
      run({ date: '2026-11-02', distanceKm: 5 }),
    ]);
    expect(result).toEqual([
      { month: '2026-09', count: 2, distanceKm: 7, missingDistanceCount: 0 },
      { month: '2026-10', count: 0, distanceKm: 0, missingDistanceCount: 0 },
      { month: '2026-11', count: 1, distanceKm: 5, missingDistanceCount: 0 },
    ]);
  });

  it('distinguishes all-missing distances from a true empty month', () => {
    const result = getMonthlyActivity([
      run({ date: '2026-09-01', distanceKm: null }),
      run({ date: '2026-11-01', distanceKm: 2 }), run({ date: '2026-11-02', distanceKm: null }),
    ]);
    expect(result[0]).toMatchObject({ count: 1, distanceKm: null, missingDistanceCount: 1 });
    expect(result[1]).toMatchObject({ count: 0, distanceKm: 0, missingDistanceCount: 0 });
    expect(result[2]).toMatchObject({ count: 2, distanceKm: 2, missingDistanceCount: 1 });
  });

  it('limits a lifetime history to the latest twelve calendar months across years', () => {
    const result = getMonthlyActivity([run({ date: '2020-01-01' }), run({ date: '2026-02-01', distanceKm: 5 })]);
    expect(result).toHaveLength(12);
    expect(result[0].month).toBe('2025-03');
    expect(result[11].month).toBe('2026-02');
  });

  it('returns no activity for absent or invalid dates', () => {
    expect(getMonthlyActivity([])).toEqual([]);
    expect(getMonthlyActivity([run({ date: '2026-02-30' }), run({ date: null })])).toEqual([]);
  });
});
