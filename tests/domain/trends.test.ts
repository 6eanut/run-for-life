import { describe, expect, it } from 'vitest';
import { emptyRecord, type RunRecord } from '../../src/domain/model';
import { chartGeometry, chartOptionsForMetric, formatAxisLabel, formatMetricDifference, formatMetricValue, getMonthlyActivity, getTrendSeries, trendMetrics, type TrendMetric } from '../../src/domain/trends';

const run = (changes: Partial<RunRecord>): RunRecord => ({ ...emptyRecord(), ...changes });

// One distinct in-range value per stored numeric field so each metric reads its own column.
const ALL_FIELDS: Partial<RunRecord> = {
  distanceKm: 4.36, durationSeconds: 1812, averagePaceSecondsPerKm: 415,
  averageHeartRateBpm: 161, averageCadenceSpm: 161, averagePowerWatts: 177,
  activeCaloriesKcal: 279, totalCaloriesKcal: 324, elevationGainMeters: 9,
  effortLevel: 6, temperatureCelsius: 10, humidityPercent: 60, airQualityIndex: 95,
};

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
    const record = run({ date: '2026-11-01', ...ALL_FIELDS });
    expect(getTrendSeries([record], metric.id).points[0].value).toBe(record[metric.field]);
  });

  it('exposes every model numeric metric with a stable id, label and unit', () => {
    expect(trendMetrics.map(metric => metric.id)).toEqual([
      'distance', 'pace', 'heartRate', 'duration', 'cadence', 'power',
      'activeCalories', 'totalCalories', 'elevation', 'effort', 'temperature', 'humidity', 'airQuality',
    ]);
    const byId = Object.fromEntries(trendMetrics.map(metric => [metric.id, metric]));
    expect(byId.activeCalories).toMatchObject({ field: 'activeCaloriesKcal', label: '动态消耗', unit: '千卡' });
    expect(byId.totalCalories).toMatchObject({ field: 'totalCaloriesKcal', label: '总消耗', unit: '千卡' });
    expect(byId.elevation).toMatchObject({ field: 'elevationGainMeters', label: '累计爬升', unit: '米' });
    expect(byId.effort).toMatchObject({ field: 'effortLevel', label: '运动强度', unit: '1–10' });
    expect(byId.temperature).toMatchObject({ field: 'temperatureCelsius', label: '气温', unit: '°C' });
    expect(byId.humidity).toMatchObject({ field: 'humidityPercent', label: '湿度', unit: '%' });
    expect(byId.airQuality).toMatchObject({ field: 'airQualityIndex', label: '空气质量指数', unit: 'AQI' });
    // The original six keep their wording so existing flows keep matching.
    expect(byId.distance).toMatchObject({ field: 'distanceKm', label: '跑步距离', unit: '公里' });
    expect(byId.pace).toMatchObject({ field: 'averagePaceSecondsPerKm', label: '平均配速', unit: '分 / 公里' });
    expect(byId.heartRate).toMatchObject({ field: 'averageHeartRateBpm', label: '平均心率', unit: '次 / 分' });
    expect(byId.duration).toMatchObject({ field: 'durationSeconds', label: '运动时长', unit: '时长' });
    expect(byId.cadence).toMatchObject({ field: 'averageCadenceSpm', label: '平均步频', unit: '步 / 分' });
    expect(byId.power).toMatchObject({ field: 'averagePowerWatts', label: '平均功率', unit: '瓦' });
  });

  it('keeps legitimate negative temperatures instead of dropping them', () => {
    const result = getTrendSeries([
      run({ date: '2026-01-01', temperatureCelsius: -12.5 }),
      run({ date: '2026-01-02', temperatureCelsius: -3 }),
      run({ date: '2026-01-03', temperatureCelsius: 0 }),
    ], 'temperature');
    expect(result.points.map(point => point.value)).toEqual([-12.5, -3, 0]);
  });

  it('still blanks nonfinite or out-of-range numbers, but keeps true zero readings', () => {
    const temperature = getTrendSeries([
      run({ date: '2026-01-01', temperatureCelsius: NaN }),
      run({ date: '2026-01-02', temperatureCelsius: Infinity }),
      run({ date: '2026-01-03', temperatureCelsius: -91 }),
      run({ date: '2026-01-04', temperatureCelsius: 71 }),
      run({ date: '2026-01-05', temperatureCelsius: -90 }),
      run({ date: '2026-01-06', temperatureCelsius: 70 }),
    ], 'temperature');
    expect(temperature.points.map(point => point.value)).toEqual([null, null, null, null, -90, 70]);
    const calories = getTrendSeries([
      run({ date: '2026-01-01', activeCaloriesKcal: -1 }),
      run({ date: '2026-01-02', activeCaloriesKcal: 0 }),
      run({ date: '2026-01-03', activeCaloriesKcal: 100001 }),
    ], 'activeCalories');
    expect(calories.points.map(point => point.value)).toEqual([null, 0, null]);
    const humidity = getTrendSeries([
      run({ date: '2026-01-01', humidityPercent: 0 }),
      run({ date: '2026-01-02', humidityPercent: 100 }),
      run({ date: '2026-01-03', humidityPercent: 101 }),
    ], 'humidity');
    expect(humidity.points.map(point => point.value)).toEqual([0, 100, null]);
    const air = getTrendSeries([
      run({ date: '2026-01-01', airQualityIndex: 0 }),
      run({ date: '2026-01-02', airQualityIndex: 1000 }),
      run({ date: '2026-01-03', airQualityIndex: 1001 }),
    ], 'airQuality');
    expect(air.points.map(point => point.value)).toEqual([0, 1000, null]);
    const effort = getTrendSeries([
      run({ date: '2026-01-01', effortLevel: 0 }),
      run({ date: '2026-01-02', effortLevel: 1 }),
      run({ date: '2026-01-03', effortLevel: 10 }),
      run({ date: '2026-01-04', effortLevel: 11 }),
    ], 'effort');
    expect(effort.points.map(point => point.value)).toEqual([null, 1, 10, null]);
  });

  it('gives the temperature axis a signed domain that survives all-negative and cross-zero data', () => {
    const allNegative = chartGeometry(getTrendSeries([
      run({ date: '2026-01-01', temperatureCelsius: -20 }),
      run({ date: '2026-01-02', temperatureCelsius: -5 }),
    ], 'temperature').points, false, { signed: true });
    expect(Number.isFinite(allNegative.points[0].y)).toBe(true);
    expect(allNegative.min).toBeLessThan(-20);
    expect(allNegative.max).toBeGreaterThan(-5);
    expect(allNegative.points.every(point => point.y !== null && point.y >= 22 && point.y <= 238)).toBe(true);

    const crossing = chartGeometry(getTrendSeries([
      run({ date: '2026-01-01', temperatureCelsius: -10 }),
      run({ date: '2026-01-02', temperatureCelsius: 10 }),
    ], 'temperature').points, false, { signed: true });
    expect(crossing.min).toBeLessThan(-10);
    expect(crossing.max).toBeGreaterThan(10);

    const singleNegative = chartGeometry(getTrendSeries([
      run({ date: '2026-01-01', temperatureCelsius: -8 }),
    ], 'temperature').points, false, { signed: true });
    expect(Number.isFinite(singleNegative.points[0].y)).toBe(true);
    expect(singleNegative.min).toBeLessThan(-8);
    expect(singleNegative.max).toBeGreaterThan(-8);

    const zeroDegrees = chartGeometry(getTrendSeries([
      run({ date: '2026-01-01', temperatureCelsius: 0 }),
    ], 'temperature').points, false, { signed: true });
    expect(Number.isFinite(zeroDegrees.points[0].y)).toBe(true);
    expect(zeroDegrees.points[0].y).toBe(130);
  });

  it('clamps the effort and humidity axes to their physical bounds', () => {
    const effort = chartGeometry(getTrendSeries([
      run({ date: '2026-01-01', effortLevel: 1 }),
      run({ date: '2026-01-02', effortLevel: 10 }),
    ], 'effort').points, false, { bounds: [1, 10] });
    expect(effort.min).toBeGreaterThanOrEqual(1);
    expect(effort.max).toBeLessThanOrEqual(10);
    expect(effort.points.every(point => point.y !== null && point.y >= 22 && point.y <= 238)).toBe(true);
    const humidity = chartGeometry(getTrendSeries([
      run({ date: '2026-01-01', humidityPercent: 0 }),
      run({ date: '2026-01-02', humidityPercent: 100 }),
    ], 'humidity').points, false, { bounds: [0, 100] });
    expect(humidity.min).toBeGreaterThanOrEqual(0);
    expect(humidity.max).toBeLessThanOrEqual(100);
  });

  it('keeps the original pace axis direction and the plain two-argument call', () => {
    const points = getTrendSeries([
      run({ date: '2026-11-01', averagePaceSecondsPerKm: 400 }),
      run({ date: '2026-11-02', averagePaceSecondsPerKm: 360 }),
    ], 'pace').points;
    expect(chartGeometry(points, true).min).toBe(chartGeometry(points, true, { signed: false, bounds: null }).min);
    expect(chartGeometry(points).points[0].y).toBeLessThan(chartGeometry(points).points[1].y!);
    expect(chartGeometry(points, true).points[1].y).toBeLessThan(chartGeometry(points, true).points[0].y!);
  });

  it('wires each metric to the right chart options for signed axes and physical bounds', () => {
    expect(chartOptionsForMetric('temperature')).toMatchObject({ signed: true, bounds: null });
    expect(chartOptionsForMetric('effort')).toMatchObject({ bounds: [1, 10] });
    expect(chartOptionsForMetric('humidity')).toMatchObject({ bounds: [0, 100] });
    expect(chartOptionsForMetric('airQuality')).toMatchObject({ signed: false });
  });

  it('formats metric values with correct precision and missing values', () => {
    expect(formatMetricValue('pace', 419.9)).toBe('7′00″');
    expect(formatMetricValue('distance', 4.36)).toBe('4.36');
    expect(formatMetricValue('duration', 1812)).toBe('30:12');
    expect(formatMetricValue('heartRate', 161)).toBe('161');
    expect(formatMetricValue('distance', null)).toBe('未记录');
    // Meaningful decimals are kept; no fake precision and no whole-number truncation.
    expect(formatMetricValue('temperature', -12.5)).toBe('-12.5');
    expect(formatMetricValue('temperature', 10)).toBe('10');
    expect(formatMetricValue('humidity', 60.5)).toBe('60.5');
    expect(formatMetricValue('humidity', 60)).toBe('60');
    expect(formatMetricValue('effort', 6.5)).toBe('6.5');
    expect(formatMetricValue('effort', 6)).toBe('6');
    expect(formatMetricValue('activeCalories', 279)).toBe('279');
    expect(formatMetricValue('totalCalories', 324.4)).toBe('324.4');
    expect(formatMetricValue('elevation', 9.25)).toBe('9.25');
    expect(formatMetricValue('airQuality', 95)).toBe('95');
    expect(formatMetricValue('temperature', null)).toBe('未记录');
  });

  it('formats axis labels without the fake precision of a long decimal', () => {
    expect(formatAxisLabel('distance', 4.36)).toBe('4.4');
    expect(formatAxisLabel('temperature', -12.5)).toBe('-12.5');
    expect(formatAxisLabel('temperature', 0)).toBe('0');
    expect(formatAxisLabel('humidity', 60.5)).toBe('60.5');
    expect(formatAxisLabel('effort', 6.5)).toBe('6.5');
    expect(formatAxisLabel('activeCalories', 279.62)).toBe('279.6');
    expect(formatAxisLabel('elevation', 9.25)).toBe('9.25');
    expect(formatAxisLabel('pace', 415)).toBe('6′55″');
  });

  it('keeps the three axis ticks distinguishable for a single zero reading', () => {
    const ticks = (metric: TrendMetric, record: Partial<RunRecord>) => {
      const geometry = chartGeometry(getTrendSeries([run({ date: '2026-11-01', ...record })], metric).points);
      return [geometry.max, (geometry.min + geometry.max) / 2, geometry.min].map(value => formatAxisLabel(metric, value));
    };
    const zeroCalories = ticks('activeCalories', { activeCaloriesKcal: 0 });
    expect(new Set(zeroCalories).size).toBe(3);
    expect(ticks('airQuality', { airQualityIndex: 0 })).toHaveLength(3);
    expect(new Set(ticks('airQuality', { airQualityIndex: 0 })).size).toBe(3);
    expect(new Set(ticks('elevation', { elevationGainMeters: 0 })).size).toBe(3);
  });

  it('labels a nine-metre climb axis as 9.5 / 9 / 8.5 instead of repeating 9', () => {
    const geometry = chartGeometry(getTrendSeries([run({ date: '2026-11-01', elevationGainMeters: 9 })], 'elevation').points);
    const labels = [geometry.max, (geometry.min + geometry.max) / 2, geometry.min].map(value => formatAxisLabel('elevation', value));
    expect(labels).toEqual(['9.5', '9', '8.5']);
  });

  it('keeps distance axis ticks distinguishable above ten kilometres', () => {
    const axisTicks = (metric: TrendMetric, record: Partial<RunRecord>) => {
      const geometry = chartGeometry(getTrendSeries([run({ date: '2026-11-01', ...record })], metric).points);
      const labels = [geometry.max, (geometry.min + geometry.max) / 2, geometry.min].map(value => formatAxisLabel(metric, value));
      expect(labels).toHaveLength(3);
      expect(new Set(labels).size).toBe(3);
      return labels;
    };
    // A single 12.4 km run used to render 13 / 12 / 12.
    expect(axisTicks('distance', { distanceKm: 12.4 })).toEqual(['13', '12.4', '11.8']);
    const twoRuns = chartGeometry(getTrendSeries([
      run({ date: '2026-11-01', distanceKm: 12.4 }),
      run({ date: '2026-11-02', distanceKm: 12.6 }),
    ], 'distance').points);
    const labels = [twoRuns.max, (twoRuns.min + twoRuns.max) / 2, twoRuns.min].map(value => formatAxisLabel('distance', value));
    expect(new Set(labels).size).toBe(3);
  });

  it('keeps ordinary non-time numeric axis ticks distinguishable too', () => {
    const axisTicks = (metric: TrendMetric, record: Partial<RunRecord>) => {
      const geometry = chartGeometry(getTrendSeries([run({ date: '2026-11-01', ...record })], metric).points);
      const labels = [geometry.max, (geometry.min + geometry.max) / 2, geometry.min].map(value => formatAxisLabel(metric, value));
      expect(new Set(labels).size).toBe(3);
    };
    // A legitimate 0 W reading used to render 1 / 1 / 0.
    axisTicks('power', { averagePowerWatts: 0 });
    // A minimal cadence of 1 used to collapse toward whole numbers.
    axisTicks('cadence', { averageCadenceSpm: 1 });
    // Heart rate and calories above their ranges behave the same way.
    axisTicks('heartRate', { averageHeartRateBpm: 20 });
  });

  it('describes a change with the unit that matches the metric', () => {
    expect(formatMetricDifference('distance', 1.2)).toBe('最新较最早有数据的记录 +1.20 公里');
    expect(formatMetricDifference('pace', -60)).toBe('最新较最早有数据的记录快 1′00″/公里');
    expect(formatMetricDifference('pace', 30)).toBe('最新较最早有数据的记录慢 0′30″/公里');
    expect(formatMetricDifference('duration', 1812)).toBe('最新较最早有数据的记录 +30:12');
    expect(formatMetricDifference('effort', 0.5)).toBe('最新较最早有数据的记录 +0.5 分');
    expect(formatMetricDifference('humidity', -10)).toBe('最新较最早有数据的记录 −10 个百分点');
    expect(formatMetricDifference('temperature', -5)).toBe('最新较最早有数据的记录 −5 °C');
    expect(formatMetricDifference('activeCalories', 21)).toBe('最新较最早有数据的记录 +21 千卡');
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
