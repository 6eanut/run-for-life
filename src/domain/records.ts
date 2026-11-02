import type { RunRecord } from './model';

export function withChallenge(record: RunRecord): RunRecord {
  const completed=typeof record.durationSeconds==='number' && Number.isFinite(record.durationSeconds) && record.durationSeconds>=1800;
  return {...record,challenge:{requiredDurationSeconds:1800,completed,completedCount:completed?1:0}};
}

const NUMERIC_RANGES: Partial<Record<keyof RunRecord,[number,number]>> = {
  durationSeconds:[0,604800],distanceKm:[0,2000],averagePaceSecondsPerKm:[1,7200],
  averageHeartRateBpm:[20,250],averageCadenceSpm:[1,300],averagePowerWatts:[0,3000],
  activeCaloriesKcal:[0,100000],totalCaloriesKcal:[0,100000],elevationGainMeters:[0,50000],
  effortLevel:[1,10],temperatureCelsius:[-90,70],humidityPercent:[0,100],airQualityIndex:[0,1000],
};

export function validateRecord(record: RunRecord): string[] {
  const errors:string[]=[];
  const timestamp=typeof record.date==='string'?Date.parse(`${record.date}T12:00:00Z`):NaN;
  if(typeof record.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(record.date)||!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==record.date) errors.push('请填写有效的运动日期');
  if(record.durationSeconds===null||record.durationSeconds===undefined) errors.push('请填写明确的运动时长');
  for(const [field,range] of Object.entries(NUMERIC_RANGES)) {
    const value=record[field as keyof RunRecord];
    if(value!==null&&value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1])) errors.push(`${field} 数值超出有效范围`);
  }
  for(const field of ['startTime','endTime'] as const) {
    if(record[field]!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(record[field]??'')) errors.push(`${field} 时间无效`);
  }
  if(record.timezone!==null) {
    try { new Intl.DateTimeFormat('en',{timeZone:record.timezone}).format(); }
    catch { errors.push('时区无效'); }
  }
  for(const field of ['activityType','effortDescription','location','source'] as const) {
    if(record[field]!==null&&(typeof record[field]!=='string'||record[field].length>500)) errors.push(`${field} 文本无效`);
  }
  if(record.durationSeconds!==null&&!Number.isInteger(record.durationSeconds)) errors.push('运动时长必须为整数秒');
  if(!Array.isArray(record.awards)||record.awards.some(award=>typeof award!=='string'||award.length>500)) errors.push('奖章数据无效');
  if(!Array.isArray(record.splits)) errors.push('分段数据无效');
  else for(const split of record.splits) {
    if(!split||typeof split!=='object') {errors.push('分段数据无效');continue;}
    if(!Number.isInteger(split.index)||split.index<1||split.index>2000) errors.push('分段编号无效');
    for(const [field,min,max] of [['durationSeconds',0,86400],['paceSecondsPerKm',1,7200],['heartRateBpm',20,250]] as const) {
      const value=split[field];
      if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)) errors.push(`分段 ${split.index} ${field} 数值无效`);
    }
    if(split.isPartialSplit!==undefined&&typeof split.isPartialSplit!=='boolean') errors.push('末段标记无效');
    if(split.durationSeconds!==null&&!Number.isInteger(split.durationSeconds)) errors.push('分段时间必须为整数秒');
  }
  if(Array.isArray(record.splits)&&new Set(record.splits.map(split=>split?.index)).size!==record.splits.length) errors.push('分段编号不能重复');
  return errors;
}

export function duplicateMatch(a: RunRecord,b: RunRecord): 'exact'|'possible'|'none' {
  if(!a.date||!b.date||a.date!==b.date) return 'none';
  if(a.activityType&&b.activityType&&a.activityType!==b.activityType) return 'none';
  if(a.startTime&&b.startTime&&a.startTime!==b.startTime) return 'none';
  const sameDuration=a.durationSeconds!==null&&b.durationSeconds!==null&&a.durationSeconds===b.durationSeconds;
  const sameDistance=a.distanceKm!==null&&b.distanceKm!==null&&Math.abs(a.distanceKm-b.distanceKm)<0.00001;
  if(a.startTime&&b.startTime&&sameDuration&&sameDistance&&a.activityType&&a.activityType===b.activityType) return 'exact';
  if((a.startTime&&a.startTime===b.startTime)||sameDuration||sameDistance) return 'possible';
  return 'none';
}

export function getStats(records: RunRecord[]) {
  return records.reduce((total,record)=>({
    completedCount:total.completedCount+withChallenge(record).challenge.completedCount,
    distanceKm:Math.round((total.distanceKm+(record.distanceKm??0))*100000)/100000,
    durationSeconds:total.durationSeconds+(record.durationSeconds??0),
  }),{completedCount:0,distanceKm:0,durationSeconds:0});
}
