import { emptyRecord, type RunRecord, type Split } from './model';
import { withChallenge } from './records';

const DIGITS='[0-9OoIl|]';
const NUMBER=`${DIGITS}+(?:[.．]${DIGITS}+)?`;
const TIME=`${DIGITS}{1,3}\\s*[:：]\\s*${DIGITS}{2}(?:\\s*[:：]\\s*${DIGITS}{2})?`;
const PACE=`${DIGITS}{1,3}\\s*['′’:]\\s*${DIGITS}{2}\\s*["″”]?`;
const numericText=(text:string)=>text.replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/．/g,'.');

export function parseDuration(text: string): number|null {
  const normalized=numericText(text.trim()).replace(/：/g,':').replace(/\s/g,'');
  if(/^\d+分\d{1,2}秒$/.test(normalized)) {
    const [minutes,seconds]=normalized.match(/\d+/g)!.map(Number);
    return seconds<60?minutes*60+seconds:null;
  }
  if(!/^\d{1,3}:\d{2}(:\d{2})?$/.test(normalized)) return null;
  const values=normalized.split(':').map(Number);
  if(values.slice(1).some(value=>value>59)) return null;
  return values.length===3?values[0]*3600+values[1]*60+values[2]:values[0]*60+values[1];
}

export function parsePace(text: string): number|null {
  return parseDuration(text.replace(/\s*(?:min(?:utes?)?\s*)?\/\s*(?:公里|km)\s*$/i,'').replace(/[′’']/g,':').replace(/[″”"]/g,'').trim());
}

function captured(text:string,labels:string,value:string):string|null {
  return text.match(new RegExp(`(?:${labels})[\\s:：]*(${value})`,'i'))?.[1]??null;
}

const COLUMN_LABELS=[
  '实际运动时长','运动时间','训练时间','训练时长','运动时长','总时间',
  '运动距离','总距离','距离','平均配速','平均心率','平均步频','平均功率',
  '动态千卡','动态消耗','活动千卡','总千卡数','总千卡','总消耗',
  '累计爬升','爬升高度','运动强度','耗能','气温','温度','湿度','空气质量指数',
  'Workout Time','Duration','Distance','Average Pace','Average Heart Rate','Average Cadence',
  'Average Power','Active Calories','Total Calories','Elevation Gain','Effort','Temperature','Humidity','AQI',
].sort((a,b)=>b.length-a.length);

const METRIC_UNITS:Partial<Record<keyof RunRecord,RegExp>>={
  distanceKm:/^(?:km\b|公里)/i,
  averagePaceSecondsPerKm:/^(?:min(?:utes?)?\s*)?\/\s*(?:km\b|公里)/i,
  averageHeartRateBpm:/^(?:bpm\b|次\s*\/\s*(?:分钟|分))/i,
  averageCadenceSpm:/^(?:spm\b|步\s*\/\s*(?:分钟|分))/i,
  averagePowerWatts:/^(?:w(?:atts?)?\b|瓦)/i,
  activeCaloriesKcal:/^(?:kcal\b|千卡|大卡)/i,
  totalCaloriesKcal:/^(?:kcal\b|千卡|大卡)/i,
  elevationGainMeters:/^(?:m(?:eters?|etres?)?\b|米)/i,
  temperatureCelsius:/^(?:°?\s*c\b|摄氏度)/i,
  humidityPercent:/^%/,
  effortLevel:/^(?:\/\s*10|[（(]?\s*(?:适中|轻松|吃力|困难|moderate|easy|hard))/i,
};

function unitAllowed(field:keyof RunRecord,suffix:string):boolean {
  const unit=suffix.trim().replace(/^[,，;；]+\s*/,'');
  if(!unit||COLUMN_LABELS.some(label=>unit.toLowerCase().startsWith(label.toLowerCase()))) return true;
  return METRIC_UNITS[field]?.test(unit)??false;
}

function labeledValue(text:string,labels:string,value:string):{raw:string;suffix:string}|null {
  const match=text.match(new RegExp(`(?:${labels})[\\s:：]*(${value})([^\\n]*)`,'i'));
  return match?{raw:match[1],suffix:match[2]}:null;
}

function expandColumns(text:string):string {
  const lines=text.split('\n');
  return lines.map((line,index)=>{
    const labels=[...line.matchAll(new RegExp(COLUMN_LABELS.join('|'),'gi'))].map(match=>match[0]);
    if(labels.length<2||/[0-9]/.test(line)) return line;
    const valuePattern=new RegExp(`(?:^|\\s)(-?(?:${TIME}|${PACE}|${NUMBER}))`,'g');
    const valueLine=lines[index+1]??'';
    const matches=[...valueLine.matchAll(valuePattern)].filter(match=>/\d/.test(match[1]));
    // Keep each value's unit, including unsupported units that must remain unparsed.
    const values=matches.map((match,column)=>valueLine.slice(match.index!+match[0].length-match[1].length,matches[column+1]?.index??valueLine.length).trim());
    // Never associate the last header with the first value from an incomplete column row.
    if(values.length!==labels.length) return '';
    return labels.map((label,column)=>`${label} ${values[column]}`).join('\n');
  }).join('\n');
}

function parseSplits(text:string):Split[] {
  const section=text.split(/分段|splits/i)[1];
  if(!section) return [];
  const row=new RegExp(`(?:^|\\n)\\s*(\\d{1,3})[.、]?\\s+(${TIME})\\s+(${PACE})(?:\\s*\\/(?:km|公里))?\\s+(${DIGITS}{2,3})(?:\\s*(?:次\\/分|bpm))?([^\\n]*)`,'gi');
  const matches=[...section.matchAll(row)];
  return matches.map((match,rowIndex)=>{
    const durationSeconds=parseDuration(match[2]);
    const paceSecondsPerKm=parsePace(match[3]);
    const partial=/不足|剩余|partial/i.test(match[5])||(rowIndex===matches.length-1&&durationSeconds!==null&&paceSecondsPerKm!==null&&durationSeconds<paceSecondsPerKm-2);
    return {index:Number(match[1]),durationSeconds,paceSecondsPerKm,heartRateBpm:Number(numericText(match[4])),...(partial?{isPartialSplit:true}:{})};
  });
}

export function parseWorkoutText(input:string):Partial<RunRecord> {
  const normalized=input.replace(/[″”]/g,'"').replace(/[′’]/g,"'").normalize('NFKC').replace(/\r/g,'').replace(/[\u200B-\u200D]/g,'').replace(/(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g,'');
  const text=expandColumns(normalized);
  let record:Partial<RunRecord>={};
  if(/户外跑步|outdoor run(?:ning)?/i.test(text)) record={...record,activityType:'outdoor_running'};
  else if(/室内跑步|indoor run(?:ning)?/i.test(text)) record={...record,activityType:'indoor_running'};
  const date=text.match(/\b(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
  if(date) record={...record,date:`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`};
  const times=text.match(/\b([012]?\d:[0-5]\d)\s*[–—~至-]\s*([012]?\d:[0-5]\d)\b/);
  if(times) record={...record,startTime:times[1].padStart(5,'0'),endTime:times[2].padStart(5,'0')};
  const duration=captured(text,'实际运动时长|运动时间|训练时间|训练时长|运动时长|总时间|Workout Time|Duration',`${TIME}|${DIGITS}+\\s*分\\s*${DIGITS}{1,2}\\s*秒`);
  if(duration) record={...record,durationSeconds:parseDuration(duration)};
  const pace=labeledValue(text,'平均配速|Average Pace',PACE);
  if(pace) record={...record,averagePaceSecondsPerKm:unitAllowed('averagePaceSecondsPerKm',pace.suffix)?parsePace(pace.raw):null};
  const specs:[keyof RunRecord,string][]=[
    ['distanceKm','运动距离|总距离|距离|Distance'],
    ['averageHeartRateBpm','平均心率|Average Heart Rate|Avg[.]? Heart Rate'],
    ['averageCadenceSpm','平均步频|Average Cadence|Avg[.]? Cadence'],
    ['averagePowerWatts','平均功率|Average Power|Avg[.]? Power'],
    ['activeCaloriesKcal','动态千卡|动态消耗|活动千卡|Active Calories'],
    ['totalCaloriesKcal','总千卡数|总千卡|总消耗|Total Calories'],
    ['elevationGainMeters','累计爬升|爬升高度|Elevation Gain'],
    ['effortLevel','运动强度|耗能|Effort'],
    ['temperatureCelsius','气温|温度|Temperature'],
    ['humidityPercent','湿度|Humidity'],
    ['airQualityIndex','空气质量指数|AQI'],
  ];
  for(const [field,label] of specs) {
    const value=labeledValue(text,label,`${field==='temperatureCelsius'?'-?':''}${NUMBER}`);
    if(value!==null) record={...record,[field]:unitAllowed(field,value.suffix)?Number(numericText(value.raw)):null};
  }
  const effort=captured(text,'运动强度|耗能|Effort',`${NUMBER}\\s*(?:/\\s*10)?\\s*[（(]?\\s*(?:适中|轻松|吃力|困难|moderate|easy|hard)`);
  if(effort) record={...record,effortDescription:effort.match(/适中|轻松|吃力|困难|moderate|easy|hard/i)?.[0]??null};
  const location=captured(text,'地点|Location','[^\\n]{1,100}');
  if(location) record={...record,location:location.trim()};
  const timezone=captured(text,'时区|Timezone','[A-Za-z_]+/[A-Za-z_/]+');
  if(timezone) record={...record,timezone};
  if(/Apple\s*Watch/i.test(text)) record={...record,source:'Apple Watch'};
  if(/首次跑步训练/.test(text)) record={...record,awards:['首次跑步训练']};
  const splits=parseSplits(text);
  if(splits.length) record={...record,splits};
  return record;
}

export interface FieldConflict {field:string;values:unknown[]}

export function mergeWorkoutResults(parts:Partial<RunRecord>[]):{record:RunRecord;conflicts:FieldConflict[]} {
  const initial=emptyRecord();
  const conflicts:FieldConflict[]=[];
  const scalars=Object.keys(initial).filter(key=>!['awards','splits','challenge'].includes(key)) as (keyof RunRecord)[];
  const fields=Object.fromEntries(scalars.map(field=>{
    const values=[...new Set(parts.map(part=>part[field]).filter(value=>value!==null&&value!==undefined&&value!==''))];
    if(values.length>1) conflicts.push({field,values});
    return [field,values.length===1?values[0]:null];
  }));
  const awards=[...new Set(parts.flatMap(part=>part.awards??[]))];
  const indices=[...new Set(parts.flatMap(part=>(part.splits??[]).map(split=>split.index)))].sort((a,b)=>a-b);
  const splits=indices.map(index=>{
    const matches=parts.flatMap(part=>(part.splits??[]).filter(split=>split.index===index));
    const splitFields=Object.fromEntries((['durationSeconds','paceSecondsPerKm','heartRateBpm','isPartialSplit'] as const).map(field=>{
      const values=[...new Set(matches.map(split=>split[field]).filter(value=>value!==null&&value!==undefined))];
      if(values.length>1) conflicts.push({field:`splits.${index}.${field}`,values});
      return [field,values.length===1?values[0]:null];
    }));
    const split={index,durationSeconds:splitFields.durationSeconds as number|null,paceSecondsPerKm:splitFields.paceSecondsPerKm as number|null,heartRateBpm:splitFields.heartRateBpm as number|null};
    return splitFields.isPartialSplit===null?split:{...split,isPartialSplit:splitFields.isPartialSplit as boolean};
  });
  return {record:withChallenge({...initial,...fields,awards,splits}),conflicts};
}
