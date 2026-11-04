import { describe, expect, it } from 'vitest';
import { emptyRecord, type RunRecord } from '../../src/domain/model';
import {
  buildActivityCalendar,
  filterRuns,
  resolveDateRange,
  summarizePeriod,
} from '../../src/domain/analytics';

const run = (changes: Partial<RunRecord>): RunRecord => ({ ...emptyRecord(), ...changes });

describe('resolveDateRange', () => {
  it('includes today and counts back 29 days for the 30d preset', () => {
    expect(resolveDateRange('30d', '2026-11-04')).toEqual({ start: '2026-10-06', end: '2026-11-04' });
  });

  it('includes today and counts back 89 days for the 90d preset', () => {
    expect(resolveDateRange('90d', '2026-11-04')).toEqual({ start: '2026-08-07', end: '2026-11-04' });
  });

  it('crosses a leap day without timezone drift', () => {
    expect(resolveDateRange('30d', '2024-03-01')).toEqual({ start: '2024-02-01', end: '2024-03-01' });
  });

  it('starts the year preset at January first', () => {
    expect(resolveDateRange('year', '2026-11-04')).toEqual({ start: '2026-01-01', end: '2026-11-04' });
  });

  it('keeps the all preset open ended', () => {
    expect(resolveDateRange('all', '2026-11-04')).toEqual({ start: null, end: null });
  });

  it('returns the custom range verbatim when it is valid', () => {
    expect(resolveDateRange('custom', '2026-11-04', { start: '2026-03-01', end: '2026-03-20' }))
      .toEqual({ start: '2026-03-01', end: '2026-03-20' });
  });

  it('rejects an invalid today', () => {
    expect(() => resolveDateRange('30d', '2026-02-30')).toThrow(/日期/);
    expect(() => resolveDateRange('30d', '2026-1-2')).toThrow(/日期/);
    expect(() => resolveDateRange('30d', '')).toThrow(/日期/);
  });

  it('rejects a custom range with missing, invalid or reversed bounds', () => {
    expect(() => resolveDateRange('custom', '2026-11-04')).toThrow(/日期/);
    expect(() => resolveDateRange('custom', '2026-11-04', { start: '2026-13-01', end: '2026-11-04' })).toThrow(/日期/);
    expect(() => resolveDateRange('custom', '2026-11-04', { start: '2026-12-01', end: '2026-11-04' })).toThrow(/日期/);
  });
});

describe('filterRuns', () => {
  const records = Object.freeze([
    run({ id: 'a', date: '2026-11-01' }),
    run({ id: 'b', date: '2026-11-04' }),
    run({ id: 'c', date: '2026-11-05' }),
    run({ id: 'bad', date: '2026-02-30' }),
    run({ id: 'none', date: null }),
  ]);

  it('includes both endpoints and drops invalid dates without mutating input', () => {
    const result = filterRuns(records, { start: '2026-11-01', end: '2026-11-04' });
    expect(result.map(record => record.id)).toEqual(['a', 'b']);
    expect(result).not.toBe(records);
    expect(records).toHaveLength(5);
    expect(records[0].id).toBe('a');
  });

  it('treats an open range as unbounded on that side', () => {
    expect(filterRuns(records, { start: null, end: '2026-11-01' }).map(r => r.id)).toEqual(['a']);
    expect(filterRuns(records, { start: '2026-11-05', end: null }).map(r => r.id)).toEqual(['c']);
  });

  it('keeps every valid date for the all range', () => {
    expect(filterRuns(records, { start: null, end: null }).map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('summarizePeriod', () => {
  it('reports zeros for an empty period', () => {
    expect(summarizePeriod([])).toEqual({
      runCount: 0,
      activeDays: 0,
      completedCount: 0,
      distanceKm: 0,
      missingDistanceCount: 0,
      durationSeconds: 0,
      activeCaloriesKcal: 0,
      elevationGainMeters: 0,
    });
  });

  it('counts runs, dedupes active days and recomputes challenges from duration', () => {
    const summary = summarizePeriod([
      run({ date: '2026-11-01', durationSeconds: 3600, challenge: { requiredDurationSeconds: 1800, completed: false, completedCount: 0 } }),
      run({ date: '2026-11-01', durationSeconds: 1799, challenge: { requiredDurationSeconds: 1800, completed: true, completedCount: 5 } }),
      run({ date: '2026-11-02', durationSeconds: 1800 }),
    ]);
    expect(summary.runCount).toBe(3);
    expect(summary.activeDays).toBe(2);
    expect(summary.completedCount).toBe(2);
    expect(summary.durationSeconds).toBe(7199);
  });

  it('sums only known values and reports missing distances', () => {
    const summary = summarizePeriod([
      run({ date: '2026-11-01', distanceKm: 5, activeCaloriesKcal: 300, elevationGainMeters: 40 }),
      run({ date: '2026-11-02', distanceKm: null, activeCaloriesKcal: null, elevationGainMeters: null }),
      run({ date: '2026-11-03', distanceKm: 3.5, activeCaloriesKcal: 200, elevationGainMeters: 10 }),
    ]);
    expect(summary.distanceKm).toBe(8.5);
    expect(summary.missingDistanceCount).toBe(1);
    expect(summary.activeCaloriesKcal).toBe(500);
    expect(summary.elevationGainMeters).toBe(50);
  });

  it('returns null metrics when every value is unknown but records exist', () => {
    const summary = summarizePeriod([run({ date: '2026-11-01' }), run({ date: '2026-11-02' })]);
    expect(summary.runCount).toBe(2);
    expect(summary.distanceKm).toBeNull();
    expect(summary.durationSeconds).toBeNull();
    expect(summary.activeCaloriesKcal).toBeNull();
    expect(summary.elevationGainMeters).toBeNull();
    expect(summary.missingDistanceCount).toBe(2);
  });

  it('ignores invalid, nonfinite and negative numbers instead of inventing zero', () => {
    const summary = summarizePeriod([
      run({ date: '2026-11-01', distanceKm: Infinity }),
      run({ date: '2026-11-02', distanceKm: -1 }),
      run({ date: '2026-11-03', distanceKm: NaN }),
      run({ date: '2026-11-04', distanceKm: 0 }),
    ]);
    expect(summary.distanceKm).toBe(0);
    expect(summary.missingDistanceCount).toBe(3);
  });

  it('keeps fractional sums stable against floating point noise', () => {
    const summary = summarizePeriod([
      run({ date: '2026-11-01', distanceKm: 0.1 }),
      run({ date: '2026-11-02', distanceKm: 0.2 }),
    ]);
    expect(summary.distanceKm).toBe(0.3);
  });

  it('counts invalid dates in runCount but not as active days', () => {
    const summary = summarizePeriod([run({ date: '2026-02-30' }), run({ date: null })]);
    expect(summary.runCount).toBe(2);
    expect(summary.activeDays).toBe(0);
  });
});

describe('buildActivityCalendar', () => {
  const records = Object.freeze([
    run({ id: 'a', date: '2026-11-02', distanceKm: 5, durationSeconds: 1800 }),
    run({ id: 'b', date: '2026-11-02', distanceKm: null, durationSeconds: 900 }),
    run({ id: 'c', date: '2026-11-04', distanceKm: 3 }),
    run({ id: 'future', date: '2026-11-06', distanceKm: 9 }),
    run({ id: 'bad', date: '2026-02-30', distanceKm: 9 }),
  ]);

  it('returns exactly weeks*7 ascending days starting on a Monday', () => {
    const calendar = buildActivityCalendar([], '2026-11-04', 12);
    expect(calendar).toHaveLength(84);
    expect(calendar[0].date).toBe('2026-08-17');
    expect(calendar[0].date && new Date(`${calendar[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(calendar.at(-1)!.date).toBe('2026-11-08');
    expect(calendar.map(day => day.date)).toEqual([...calendar.map(day => day.date)].sort());
  });

  it('marks days after the end date as future and excludes their records', () => {
    const calendar = buildActivityCalendar(records, '2026-11-04', 12);
    const byDate = new Map(calendar.map(day => [day.date, day]));
    expect(byDate.get('2026-11-06')).toMatchObject({ isFuture: true, count: 0, distanceKm: 0, runIds: [] });
    expect(byDate.get('2026-11-04')).toMatchObject({ isFuture: false, count: 1 });
    expect(byDate.get('2026-11-05')).toMatchObject({ isFuture: true, count: 0 });
    expect(byDate.get('2026-11-08')).toMatchObject({ isFuture: true });
  });

  it('aggregates multiple runs on one day, keeps known ids and follows summary rules', () => {
    const calendar = buildActivityCalendar(records, '2026-11-04', 12);
    const byDate = new Map(calendar.map(day => [day.date, day]));
    expect(byDate.get('2026-11-02')).toMatchObject({
      count: 2, distanceKm: 5, missingDistanceCount: 1, durationSeconds: 2700, completedCount: 1,
      runIds: ['a', 'b'], isFuture: false,
    });
    expect(byDate.get('2026-11-03')).toMatchObject({
      count: 0, distanceKm: 0, missingDistanceCount: 0, durationSeconds: 0, completedCount: 0, runIds: [],
    });
  });

  it('reports null distance for a day whose runs are all unknown but keeps the count', () => {
    const calendar = buildActivityCalendar([run({ id: 'x', date: '2026-11-04', distanceKm: null })], '2026-11-04', 1);
    const day = calendar.find(cell => cell.date === '2026-11-04')!;
    expect(day).toMatchObject({ count: 1, distanceKm: null, missingDistanceCount: 1, runIds: ['x'] });
  });

  it('omits runIds for records without an id and ignores invalid dates', () => {
    const calendar = buildActivityCalendar([run({ date: '2026-11-04' }), run({ id: '', date: '2026-11-04' })], '2026-11-04', 1);
    const day = calendar.find(cell => cell.date === '2026-11-04')!;
    expect(day.count).toBe(2);
    expect(day.runIds).toEqual([]);
  });

  it('supports a one week window and crosses years and leap days', () => {
    const week = buildActivityCalendar([], '2026-11-04', 1);
    expect(week).toHaveLength(7);
    expect(week[0].date).toBe('2026-11-02');
    expect(week.at(-1)!.date).toBe('2026-11-08');

    const crossYear = buildActivityCalendar([], '2026-01-05', 2);
    expect(crossYear[0].date).toBe('2025-12-29');
    expect(crossYear.at(-1)!.date).toBe('2026-01-11');

    const leap = buildActivityCalendar([], '2024-03-01', 2);
    expect(leap.map(day => day.date)).toContain('2024-02-29');
    expect(leap.find(day => day.date === '2024-02-29')).toMatchObject({ isFuture: false });
  });

  it('rejects invalid end dates and week counts', () => {
    expect(() => buildActivityCalendar([], '2026-02-30', 12)).toThrow(/日期/);
    expect(() => buildActivityCalendar([], '2026-11-04', 0)).toThrow(/周/);
    expect(() => buildActivityCalendar([], '2026-11-04', 54)).toThrow(/周/);
    expect(() => buildActivityCalendar([], '2026-11-04', 1.5)).toThrow(/周/);
  });
});
