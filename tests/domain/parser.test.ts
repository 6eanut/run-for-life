import { describe, it, expect } from 'vitest';
import { parseDuration, parsePace, parseWorkoutText, mergeWorkoutResults } from '../../src/domain/parser';
import { SAMPLE_RECORD, SAMPLE_OVERVIEW_TEXT, SAMPLE_DETAILS_TEXT } from '../../src/domain/sample';

describe('time conversion', () => {
  it.each([['0:30:12',1812], ['00:30:12',1812], ['05:39',339], ['30分12秒',1812], ['O:3O:12',1812]])('duration %s', (text,value) => expect(parseDuration(text)).toBe(value));
  it.each(['31:99','1:60:00','abc','', '-30:00'])('rejects invalid %s', text => expect(parseDuration(text)).toBeNull());
  it.each([[`6'55"/公里`,415], ['6′55″/km',415], ['8:12',492]])('pace %s', (text,value) => expect(parsePace(text)).toBe(value));
});

describe('label aware workout extraction', () => {
  it('merges the two supplied transcripts into one full record', () => {
    const result = mergeWorkoutResults([parseWorkoutText(SAMPLE_OVERVIEW_TEXT),parseWorkoutText(SAMPLE_DETAILS_TEXT)]);
    expect(result.conflicts).toEqual([]);
    expect(result.record).toEqual({...SAMPLE_RECORD, timezone:null});
  });
  it('uses explicit duration and ignores status bar or chart axes', () => {
    const record = parseWorkoutText('21:36 4G 90%\n20:58–21:29\n平均心率\n161次/分\n心率曲线\n173\n运动时间\n0:30:12');
    expect(record.durationSeconds).toBe(1812);
    expect(record.averageHeartRateBpm).toBe(161);
    expect(record).not.toHaveProperty('maximumHeartRateBpm');
    expect(parseWorkoutText('20:58–21:29')).not.toHaveProperty('durationSeconds');
  });
  it('separates cadence, heart rate, calories and effort', () => {
    expect(parseWorkoutText('平均步频 161步/分\n平均心率 161次/分\n动态千卡 279千卡\n总千卡数 324千卡\n耗能 6 适中')).toMatchObject({averageCadenceSpm:161,averageHeartRateBpm:161,activeCaloriesKcal:279,totalCaloriesKcal:324,effortLevel:6,effortDescription:'适中'});
  });
  it('leaves unavailable fields null and never guesses geographic timezone', () => {
    const {record} = mergeWorkoutResults([parseWorkoutText('地点 中国北京市')]);
    expect(record.timezone).toBeNull();
    expect(record.durationSeconds).toBeNull();
    expect(record.source).toBeNull();
    expect(record.challenge.completed).toBe(false);
  });
  it('keeps split duration and pace distinct and does not derive distance', () => {
    const record=parseWorkoutText('分段\n1 05:39 5′39″/km 157\n2 03:01 8′12″/km 155');
    expect(record.splits?.[1]).toEqual({index:2,durationSeconds:181,paceSecondsPerKm:492,heartRateBpm:155,isPartialSplit:true});
    expect(record.splits?.[1]).not.toHaveProperty('distanceKm');
  });
  it('reports conflicting scalar and split values instead of silently choosing', () => {
    const result=mergeWorkoutResults([{distanceKm:4.36,awards:['首次跑步训练']},{distanceKm:5,awards:['首次跑步训练']}]);
    expect(result.record.distanceKm).toBeNull();
    expect(result.conflicts).toEqual([{field:'distanceKm',values:[4.36,5]}]);
    expect(result.record.awards).toEqual(['首次跑步训练']);
  });
  it('does not leak global regex state between repeated records', () => {
    expect(parseWorkoutText(SAMPLE_OVERVIEW_TEXT)).toEqual(parseWorkoutText(SAMPLE_OVERVIEW_TEXT));
  });
  it('supports English labels and explicit timezone without geographic inference',()=>{
    expect(parseWorkoutText('Indoor Running\n2026/1/2\n08:01-08:31\nDuration 30:00\nAverage Pace 6:00/km\nDistance 5.0 km\nTemperature -2°C\nTimezone Asia/Shanghai\nLocation Beijing\nEffort 3 easy')).toMatchObject({activityType:'indoor_running',date:'2026-01-02',startTime:'08:01',endTime:'08:31',durationSeconds:1800,averagePaceSecondsPerKm:360,distanceKm:5,temperatureCelsius:-2,timezone:'Asia/Shanghai',location:'Beijing',effortLevel:3,effortDescription:'easy'});
  });
  it('preserves absent split values when merging complementary data',()=>{
    const result=mergeWorkoutResults([{splits:[{index:1,durationSeconds:339,paceSecondsPerKm:null,heartRateBpm:null}]},{splits:[{index:1,durationSeconds:339,paceSecondsPerKm:339,heartRateBpm:157}]}]);
    expect(result.record.splits).toEqual([{index:1,durationSeconds:339,paceSecondsPerKm:339,heartRateBpm:157}]);
    expect(result.conflicts).toEqual([]);
  });
  it('reports conflicting split data and leaves the conflicting field null',()=>{
    const result=mergeWorkoutResults([{splits:[{index:1,durationSeconds:339,paceSecondsPerKm:339,heartRateBpm:157}]},{splits:[{index:1,durationSeconds:340,paceSecondsPerKm:339,heartRateBpm:157}]}]);
    expect(result.conflicts).toEqual([{field:'splits.1.durationSeconds',values:[339,340]}]);
    expect(result.record.splits[0].durationSeconds).toBeNull();
  });
  it('recognizes a full and a deliberately marked partial split',()=>{
    expect(parseWorkoutText('Splits\n1 06:00 6:00/km 150\n2 02:00 6:00/km 152 partial').splits).toEqual([{index:1,durationSeconds:360,paceSecondsPerKm:360,heartRateBpm:150},{index:2,durationSeconds:120,paceSecondsPerKm:360,heartRateBpm:152,isPartialSplit:true}]);
  });
  it('reads paired labels above values without fixed pixel positions',()=>{
    const text=`运动时间 运动距离
0:30:12 4.36公里
平均配速 平均心率
6′55″/公里 161次/分
动态千卡 总千卡数
279千卡 324千卡
平 均 步 频 平 均 功 率
161步/分 177瓦`;
    expect(parseWorkoutText(text)).toMatchObject({durationSeconds:1812,distanceKm:4.36,averagePaceSecondsPerKm:415,averageHeartRateBpm:161,activeCaloriesKcal:279,totalCaloriesKcal:324,averageCadenceSpm:161,averagePowerWatts:177});
  });
  it('does not guess paired values when one value is absent',()=>{
    expect(parseWorkoutText('平均配速 平均心率\n161次/分')).not.toHaveProperty('averagePaceSecondsPerKm');
  });
  it('keeps multiple labeled values on the same OCR line',()=>{
    expect(parseWorkoutText('平均心率161次/分 平均步频161步/分')).toMatchObject({averageHeartRateBpm:161,averageCadenceSpm:161});
  });
  it('does not infer a partial kilometer from a one-second rounding difference',()=>{
    expect(parseWorkoutText('分段\n1 05:59 6′00″/km 150').splits?.[0].isPartialSplit).toBeUndefined();
  });
  it('rejects imperial units instead of silently treating them as metric',()=>{
    expect(parseWorkoutText('Distance 3.0 mi\nAverage Pace 8:00/mi\nTemperature 50°F\nElevation Gain 30 ft')).toMatchObject({distanceKm:null,averagePaceSecondsPerKm:null,temperatureCelsius:null,elevationGainMeters:null});
  });
  it('preserves units in paired columns and rejects unsupported ones',()=>{
    expect(parseWorkoutText('Distance Average Pace\n3.0 mi 8:00/mi\nTemperature Elevation Gain\n50 °F 30 ft')).toMatchObject({distanceKm:null,averagePaceSecondsPerKm:null,temperatureCelsius:null,elevationGainMeters:null});
  });
  it('supports explicit metric units and distinct calorie fields',()=>{
    expect(parseWorkoutText('Distance 4.36 km\nAverage Pace 6:55 min/km\nTemperature 10°C\nElevation Gain 9 meters\nActive Calories 279 kcal\nTotal Calories 324 kcal')).toMatchObject({distanceKm:4.36,averagePaceSecondsPerKm:415,temperatureCelsius:10,elevationGainMeters:9,activeCaloriesKcal:279,totalCaloriesKcal:324});
  });
  it('leaves non-running activities and unlabeled chart maxima unknown',()=>{
    const result=mergeWorkoutResults([parseWorkoutText('Outdoor Walk\nDuration 30:12\nHeart Rate Chart\n173')]).record;
    expect(result.activityType).toBeNull();
    expect(result.averageHeartRateBpm).toBeNull();
    expect(result).not.toHaveProperty('maximumHeartRateBpm');
  });
});
