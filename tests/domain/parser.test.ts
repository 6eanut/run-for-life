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
  it('converts explicit Fahrenheit and leaves unsupported imperial metrics unknown',()=>{
    expect(parseWorkoutText('Distance 3.0 mi\nAverage Pace 8:00/mi\nTemperature 50°F\nElevation Gain 30 ft')).toMatchObject({distanceKm:null,averagePaceSecondsPerKm:null,temperatureCelsius:10,elevationGainMeters:null});
  });
  it('preserves units in paired columns and rejects unsupported ones',()=>{
    expect(parseWorkoutText('Distance Average Pace\n3.0 mi 8:00/mi\nTemperature Elevation Gain\n50 °F 30 ft')).toMatchObject({distanceKm:null,averagePaceSecondsPerKm:null,temperatureCelsius:10,elevationGainMeters:null});
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
  it('reads complete stacked headers and values from metric cards',()=>{
    const text=`体能训练时间
总距离
0:30:12
4.36公里
平均心率
平均功率
161次/分
177瓦
动态千卡
总千卡
279千卡
324千卡`;
    expect(parseWorkoutText(text)).toMatchObject({durationSeconds:1812,distanceKm:4.36,averageHeartRateBpm:161,averagePowerWatts:177,activeCaloriesKcal:279,totalCaloriesKcal:324});
  });
  it('reads value-first fields only when units make the association explicit',()=>{
    const text=`4.36公里
跑步距离
161次/分
平均心率
177瓦
平均功率
279千卡
动态千卡
324千卡
总千卡`;
    expect(parseWorkoutText(text)).toMatchObject({distanceKm:4.36,averageHeartRateBpm:161,averagePowerWatts:177,activeCaloriesKcal:279,totalCaloriesKcal:324});
    expect(parseWorkoutText('心率图\n173\n平均心率')).not.toHaveProperty('averageHeartRateBpm');
  });
  it('keeps complete value-first paired columns associated with their labels',()=>{
    expect(parseWorkoutText('161次/分 177瓦\n平均心率 平均功率\n279千卡 324千卡\n动态千卡 总千卡')).toMatchObject({averageHeartRateBpm:161,averagePowerWatts:177,activeCaloriesKcal:279,totalCaloriesKcal:324});
  });
  it('reads explicit units before a label on the same line without guessing unlabelled numbers',()=>{
    expect(parseWorkoutText('4.36公里 跑步距离\n161次/分 平均心率\n177瓦 平均功率')).toMatchObject({distanceKm:4.36,averageHeartRateBpm:161,averagePowerWatts:177});
    expect(parseWorkoutText('173 平均心率')).not.toHaveProperty('averageHeartRateBpm');
  });
  it('joins only known Chinese labels split over OCR lines',()=>{
    expect(parseWorkoutText('平均心\n率\n161次/分\n平均功\n率\n177瓦\n动态卡路里\n279千卡\n总卡路里\n324千卡')).toMatchObject({averageHeartRateBpm:161,averagePowerWatts:177,activeCaloriesKcal:279,totalCaloriesKcal:324});
  });
  it('reads effort descriptions on their own line and weather with explicit units',()=>{
    const text=`努力程度
6
适中
天气
10°C 60%
空气质量
95
中国北京市`;
    expect(parseWorkoutText(text)).toMatchObject({effortLevel:6,effortDescription:'适中',temperatureCelsius:10,humidityPercent:60,airQualityIndex:95,location:'中国北京市'});
    expect(parseWorkoutText('21:36 4G 90%\n心率图\n173')).not.toHaveProperty('humidityPercent');
    expect(parseWorkoutText('天气\n10°C\n21:36 4G 90%')).not.toHaveProperty('humidityPercent');
  });
  it('does not relabel a partial column row or a chart number as an unknown field',()=>{
    const record=parseWorkoutText('平均心率 平均功率\n161次/分\n心率图\n173\n努力程度\n适中');
    expect(record).not.toHaveProperty('averagePowerWatts');
    expect(record).not.toHaveProperty('effortLevel');
    expect(record).not.toHaveProperty('temperatureCelsius');
  });
  it('reads Apple Fitness label variants and effort rows with decorative symbols',()=>{
    const record=parseWorkoutText(`体能训练时长 距离
0:33:45 5.12公里
动态干卡 总干卡数
288千卡 337千卡
总爬升高度 平均功率
12米 181瓦
耗 能 +

7 吃力 p |`);
    expect(record).toMatchObject({durationSeconds:2025,distanceKm:5.12,activeCaloriesKcal:288,totalCaloriesKcal:337,elevationGainMeters:12,averagePowerWatts:181,effortLevel:7,effortDescription:'吃力'});
  });
  it('removes leading location glyph OCR only when an explicit country/city remains',()=>{
    expect(parseWorkoutText('命中 国 上 海 市')).toMatchObject({location:'中国上海市'});
    expect(parseWorkoutText('其他内容\n上海市\n北京市')).not.toHaveProperty('location');
  });
  it('accepts the heart-chart average caption without treating its axis as the average',()=>{
    expect(parseWorkoutText('心率 >\n173\n12:00 12:10\n平均 148 次 /分')).toMatchObject({averageHeartRateBpm:148});
    expect(parseWorkoutText('心率 >\n173')).not.toHaveProperty('averageHeartRateBpm');
    expect(parseWorkoutText('平均 148 次 /分')).not.toHaveProperty('averageHeartRateBpm');
  });
  it('reads 单段 rows with repeated OCR quotes and stray leading heart-rate punctuation',()=>{
    const record=parseWorkoutText(`单 段 >
时间 配速 心率
1 05:42 5'42'"/ 公 里 149 次 /分
2 07:02 7'02'"/ 公 里 ”155 次 /分
3 02:05 8'12'" /公里 146 次 /分
心率 >
173`);
    expect(record.splits).toEqual([
      {index:1,durationSeconds:342,paceSecondsPerKm:342,heartRateBpm:149},
      {index:2,durationSeconds:422,paceSecondsPerKm:422,heartRateBpm:155},
      {index:3,durationSeconds:125,paceSecondsPerKm:492,heartRateBpm:146,isPartialSplit:true},
    ]);
    expect(parsePace(`7'02'"/公里`)).toBe(422);
  });
  it('uses the selected screenshot unit for degree-only Apple weather values',()=>{
    const text='12° 57% 83\n天气 湿度 空气质量';
    expect(parseWorkoutText(text,{temperatureUnit:'celsius'})).toMatchObject({temperatureCelsius:12,humidityPercent:57,airQualityIndex:83});
    expect(parseWorkoutText(text).temperatureCelsius??null).toBeNull();
    expect(parseWorkoutText('50° 57% 83\n天气 湿度 空气质量',{temperatureUnit:'fahrenheit'}).temperatureCelsius).toBe(10);
    expect(parseWorkoutText('12°C 57% 83\n天气 湿度 空气质量',{temperatureUnit:'fahrenheit'}).temperatureCelsius).toBe(12);
  });
  it('does not turn icon-contaminated humidity or an ambiguous AQI row into a valid number',()=>{
    const record=parseWorkoutText('C12° =Z357% 3 83\n天气 湿度 空气质量',{temperatureUnit:'celsius'});
    expect(record.temperatureCelsius).toBe(12);
    expect(record.humidityPercent??null).toBeNull();
    expect(record.airQualityIndex??null).toBeNull();
    expect(parseWorkoutText('21:36 4G 90%\n天气 湿度 空气质量',{temperatureUnit:'celsius'}).humidityPercent??null).toBeNull();
  });
  it('repairs a small set of unit glyphs only after their matching metric labels',()=>{
    const record=parseWorkoutText('动态干卡 总干卡数\n288于下 337干卡\n平均功率\n181凡');
    expect(record).toMatchObject({activeCaloriesKcal:288,totalCaloriesKcal:337,averagePowerWatts:181});
    for(const glyph of ['凤','到','邑']) expect(parseWorkoutText(`平均功率 181${glyph}`).averagePowerWatts).toBe(181);
    expect(parseWorkoutText('动态千卡288kJ\n总千卡337kJ\n平均功率181kW')).toMatchObject({activeCaloriesKcal:null,totalCaloriesKcal:null,averagePowerWatts:null});
    expect(parseWorkoutText('288于下\n181凡')).not.toHaveProperty('activeCaloriesKcal');
  });
  it('repairs a missing split pace separator only when its digits exactly match full-kilometer duration',()=>{
    const record=parseWorkoutText(`单段
1 07:17 717"/公里 148次/分
2 07:19 719'"/公里 149次/分
3 03:01 812"/公里 150次/分`);
    expect(record.splits).toEqual([
      {index:1,durationSeconds:437,paceSecondsPerKm:437,heartRateBpm:148},
      {index:2,durationSeconds:439,paceSecondsPerKm:439,heartRateBpm:149},
      {index:3,durationSeconds:181,paceSecondsPerKm:null,heartRateBpm:150},
    ]);
  });
  it('applies the chosen temperature unit to a labelled degree-only value',()=>{
    const text='天气\n气温 12°\n湿度 57%\n空气质量指数 83';
    expect(parseWorkoutText(text,{temperatureUnit:'celsius'})).toMatchObject({temperatureCelsius:12,humidityPercent:57,airQualityIndex:83});
    expect(parseWorkoutText(text).temperatureCelsius).toBeNull();
    expect(parseWorkoutText('Temperature 50°',{temperatureUnit:'fahrenheit'}).temperatureCelsius).toBe(10);
    expect(parseWorkoutText('Temperature 50°F',{temperatureUnit:'celsius'}).temperatureCelsius).toBe(10);
    expect(parseWorkoutText('气温 12°C',{temperatureUnit:'fahrenheit'}).temperatureCelsius).toBe(12);
  });
});

it('preserves label/value pairs separated by OCR paragraph blank lines', () => {
  expect(parseWorkoutText('Distance\n\n5.28 km\nAverage Pace\n7:14 /km\nActive Calories\n\n282 kcal\n\nTotal Calories\n\n339 kcal')).toMatchObject({
    distanceKm: 5.28, averagePaceSecondsPerKm: 434, activeCaloriesKcal: 282, totalCaloriesKcal: 339,
  });
});
