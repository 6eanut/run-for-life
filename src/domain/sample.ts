import type { RunRecord } from './model';

// User-supplied expected values, NOT an OCR result and never automatically saved.
export const SAMPLE_RECORD: RunRecord = {
  activityType:'outdoor_running',date:'2026-11-02',startTime:'20:58',endTime:'21:29',timezone:'Asia/Shanghai',
  durationSeconds:1812,distanceKm:4.36,averagePaceSecondsPerKm:415,
  averageHeartRateBpm:161,averageCadenceSpm:161,averagePowerWatts:177,
  activeCaloriesKcal:279,totalCaloriesKcal:324,elevationGainMeters:9,
  effortLevel:6,effortDescription:'适中',temperatureCelsius:10,humidityPercent:60,
  airQualityIndex:95,location:'中国北京市',source:'Apple Watch',awards:['首次跑步训练'],
  splits:[
    {index:1,durationSeconds:339,paceSecondsPerKm:339,heartRateBpm:157},
    {index:2,durationSeconds:416,paceSecondsPerKm:416,heartRateBpm:167},
    {index:3,durationSeconds:437,paceSecondsPerKm:437,heartRateBpm:162},
    {index:4,durationSeconds:439,paceSecondsPerKm:439,heartRateBpm:160},
    {index:5,durationSeconds:181,paceSecondsPerKm:492,heartRateBpm:155,isPartialSplit:true},
  ],challenge:{requiredDurationSeconds:1800,completed:true,completedCount:1},
};

// Transcribed fixture for parser tests; does not verify the OCR engine on real pixels.
export const SAMPLE_OVERVIEW_TEXT = `21:36 4G
户外跑步
2026年11月2日
20:58–21:29
运动时间
0:30:12
运动距离
4.36公里
动态千卡
279千卡
总千卡数
324千卡
累计爬升
9米
平均功率
177瓦
平均步频
161步/分
平均配速
6′55″/公里
平均心率
161次/分
耗能 6 适中
地点 中国北京市
记录设备 Apple Watch
首次跑步训练`;

export const SAMPLE_DETAILS_TEXT = `户外跑步
2026年11月2日
20:58–21:29
分段
时间 配速 心率
1 05:39 5′39″/km 157
2 06:56 6′56″/km 167
3 07:17 7′17″/km 162
4 07:19 7′19″/km 160
5 03:01 8′12″/km 155
心率曲线
173
平均心率 161次/分
气温 10°C
湿度 60%
空气质量指数 95`;
