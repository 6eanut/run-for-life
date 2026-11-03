import { emptyRecord, type RunRecord, type Split } from './model';
import { withChallenge } from './records';

const DIGITS='[0-9OoIl|]';
const NUMBER=`${DIGITS}+(?:[.．]${DIGITS}+)?`;
const TIME=`${DIGITS}{1,3}\\s*[:：]\\s*${DIGITS}{2}(?:\\s*[:：]\\s*${DIGITS}{2})?`;
const PACE=`${DIGITS}{1,3}\\s*['′’:]\\s*${DIGITS}{2}\\s*['′’"″”]*`;
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
  const value=text.replace(/\s*(?:min(?:utes?)?\s*)?\/\s*(?:公里|km)\s*$/i,'').replace(/[′’]/g,"'").replace(/[″”]/g,'"').trim().replace(/['"]+\s*$/,'');
  return parseDuration(value.replace(/'/g,':'));
}

function captured(text:string,labels:string,value:string):string|null {
  return text.match(new RegExp(`(?:${labels})[\\s:：]*(${value})`,'i'))?.[1]??null;
}

const COLUMN_LABELS=[
  '实际运动时长','体能训练时间','体能训练时长','运动时间','训练时间','训练时长','运动时长','总时间',
  '跑步距离','运动距离','总距离','距离','平均配速','平均心率','平均步频','平均功率',
  '动态千卡','动态消耗','活动千卡','动态卡路里','总千卡数','总千卡','总消耗','总卡路里',
  '累计爬升','总爬升高度','爬升高度','运动强度','努力程度','耗能','气温','温度','湿度','空气质量指数','空气质量',
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
  if((field==='activeCaloriesKcal'||field==='totalCaloriesKcal')&&/^(?:干卡|于卡|于下)[,.，。]?$/.test(unit)) return true;
  if(field==='totalCaloriesKcal'&&/^和干卡[,.，。]?$/.test(unit)) return true;
  if(field==='averageHeartRateBpm'&&/^[闪从]\s*\/\s*(?:分钟|分)[,.，。]?$/.test(unit)) return true;
  if(field==='averagePowerWatts'&&/^[凡凤到邑][,.，。]?$/.test(unit)) return true;
  return METRIC_UNITS[field]?.test(unit)??false;
}

function labeledValue(text:string,labels:string,value:string):{raw:string;suffix:string}|null {
  const match=text.match(new RegExp(`(?:${labels})[\\s:：]*(${value})([^\\n]*)`,'i'));
  return match?{raw:match[1],suffix:match[2]}:null;
}

const DISTANCE_NUMBER=`-?${DIGITS}+(?:[ \\t]*[.,．][ \\t]*${DIGITS}+)?`;
const distanceNumber=(raw:string)=>Number(numericText(raw).replace(/\s/g,'').replace(',','.'));
const workoutBody=(text:string)=>text.split(/(?:^|\n)\s*(?:分段|单段|splits)[^\n]*/i)[0];

function headingDistances(text:string):number[] {
  const lines=workoutBody(text).split('\n').map(line=>line.trim()).filter(Boolean);
  const heading=/^(?:户外跑步|室内跑步|Outdoor Run(?:ning)?|Indoor Run(?:ning)?)(.*)$/i;
  const metric=new RegExp(`^(${DISTANCE_NUMBER})\\s*(?:公里|km)\\s*$`,'i');
  return lines.flatMap((line,index)=>{
    const title=line.match(heading);
    if(!title)return [];
    // A summary value must touch the activity heading, not cross a map/section label.
    const candidate=title[1].trim()||lines[index+1]||'';
    const distance=candidate.match(metric);
    return distance?[distanceNumber(distance[1])]:[];
  });
}

function workoutDistance(text:string,source:string):number|null|undefined {
  const body=workoutBody(text);
  const pattern=new RegExp(`(?=(?:跑步距离|运动距离|总距离|距离|Distance)[\\s:：]*(${DISTANCE_NUMBER})([^\\n]*))`,'gi');
  const labeled=[...body.matchAll(pattern)];
  const candidates=[
    ...labeled.filter(match=>unitAllowed('distanceKm',match[2])).map(match=>distanceNumber(match[1])),
    ...headingDistances(source),
  ].filter(value=>Number.isFinite(value)&&value>=0&&value<=2000);
  const unique=[...new Set(candidates)];
  if(unique.length===1)return unique[0];
  return labeled.length||candidates.length?null:undefined;
}

function columnValues(line:string):string[] {
  const valuePattern=new RegExp(`(?:^|\\s)(-?(?:${TIME}|${PACE}|${NUMBER}))`,'g');
  const matches=[...line.matchAll(valuePattern)].filter(match=>/\d/.test(match[1])&&!/\/\s*$/.test(line.slice(0,match.index!)));
  return matches.map((match,column)=>line.slice(match.index!+match[0].length-match[1].length,matches[column+1]?.index??line.length).trim());
}

function headerLabels(line:string):string[] {
  const pattern=new RegExp(COLUMN_LABELS.join('|'),'gi');
  const labels=[...line.matchAll(pattern)].map(match=>match[0]);
  return labels.length&&!line.replace(pattern,'').replace(/[\s:：|,，]/g,'')?labels:[];
}

function hasExplicitUnit(value:string):boolean {
  return /(?:公里|\bkm\b|\/\s*km|[°℃℉]|摄氏|千卡|大卡|kcal|bpm|spm|次\s*\/|步\s*\/|瓦|watts?|%|米|meters?|\bft\b|\bmi\b)/i.test(value);
}

function expandColumns(text:string):string {
  const lines=text.split('\n').filter(line=>line.trim()).map(line=>{
    const reverse=line.match(new RegExp(`^\\s*(-?${DIGITS}.*?)\\s*(${COLUMN_LABELS.join('|')})\\s*$`,'i'));
    return reverse&&columnValues(reverse[1]).length===1&&hasExplicitUnit(reverse[1])?`${reverse[2]} ${reverse[1]}`:line;
  });
  const output=[...lines];
  const consumed=new Set<number>();
  for(let index=0;index<lines.length;index+=1) {
    if(consumed.has(index)) continue;
    const labels=headerLabels(lines[index]);
    if(!labels.length) continue;
    const previous=index>0&&!consumed.has(index-1)?columnValues(lines[index-1]):[];
    if(previous.length===labels.length&&previous.every(hasExplicitUnit)) {
      output[index-1]='';
      output[index]=labels.map((label,column)=>`${label} ${previous[column]}`).join('\n');
      continue;
    }
    let next=index+1;
    while(next<lines.length&&headerLabels(lines[next]).length) {
      labels.push(...headerLabels(lines[next]));
      output[next]='';consumed.add(next);next+=1;
    }
    const values:string[]=[];
    const valueLines:number[]=[];
    while(next<lines.length&&!headerLabels(lines[next]).length&&values.length<labels.length) {
      const row=columnValues(lines[next]);
      if(!row.length||!new RegExp(`^\\s*-?${DIGITS}`).test(lines[next])) break;
      values.push(...row);valueLines.push(next);consumed.add(next);next+=1;
    }
    // Require a complete block; never assign the first surviving value to its last header.
    output[index]=values.length===labels.length?labels.map((label,column)=>`${label} ${values[column]}`).join('\n'):'';
    if(values.length===labels.length) valueLines.forEach(line=>{output[line]='';});
  }
  return output.join('\n');
}

function parseSplits(text:string):Split[] {
  const section=text.split(/分段|单段|splits/i)[1];
  if(!section) return [];
  const paceToken=`(?:${PACE}|${DIGITS}{3,4}\\s*['′’"″”]+)`;
  const row=new RegExp(`(?:^|\\n)\\s*(\\d{1,3})[.、]?\\s+(${TIME})\\s+(${paceToken})(?:\\s*\\/\\s*(?:km|公里))?\\s*["”‘’]*\\s*(${DIGITS}{2,3})(?:\\s*(?:次\\s*\\/\\s*分|bpm))?([^\\n]*)`,'gi');
  const matches=[...section.matchAll(row)];
  return matches.map((match,rowIndex)=>{
    const durationSeconds=parseDuration(match[2]);
    const parsedPace=parsePace(match[3]);
    const paceEnd=match[0].indexOf(match[3],match[0].indexOf(match[2])+match[2].length)+match[3].length;
    const explicitUnit=/^\s*\/\s*(?:km|公里)/i.test(match[0].slice(paceEnd));
    const joinedDuration=durationSeconds===null?'':`${Math.floor(durationSeconds/60)}${String(durationSeconds%60).padStart(2,'0')}`;
    const joinedPace=numericText(match[3]).replace(/['"\s]/g,'');
    // Restore an omitted minute separator only with an explicit /km unit and
    // an exact full-kilometer duration match. Other unreadable paces stay null.
    const paceSecondsPerKm=parsedPace??(explicitUnit&&joinedPace===joinedDuration?durationSeconds:null);
    const partial=/不足|剩余|partial/i.test(match[5])||(rowIndex===matches.length-1&&durationSeconds!==null&&paceSecondsPerKm!==null&&durationSeconds<paceSecondsPerKm-2);
    return {index:Number(match[1]),durationSeconds,paceSecondsPerKm,heartRateBpm:Number(numericText(match[4])),...(partial?{isPartialSplit:true}:{})};
  });
}

export interface WorkoutParseOptions {temperatureUnit?:'celsius'|'fahrenheit'}

function temperatureValue(raw:string,suffix:string,options:WorkoutParseOptions):number|null {
  const value=Number(numericText(raw));
  const unit=suffix.trim();
  if(/^(?:°?\s*C\b|摄氏度)/i.test(unit)) return value;
  if(/^°?\s*F\b/i.test(unit)) return Math.round((value-32)*5/9*100)/100;
  if(/^°(?:\s|$)/.test(unit)||!unit) {
    if(options.temperatureUnit==='celsius') return value;
    if(options.temperatureUnit==='fahrenheit') return Math.round((value-32)*5/9*100)/100;
  }
  return null;
}

function appleWeather(text:string,options:WorkoutParseOptions):Partial<RunRecord> {
  const lines=text.split('\n');
  const header=lines.findIndex(line=>/^(?:天气|气温|温度)\s*湿度\s*空气质量(?:指数)?\s*$/.test(line.trim()));
  if(header<1) return {};
  const row=lines[header-1];
  const temperature=row.match(/(?:^|[^\d])(-?\d+(?:\.\d+)?)\s*°\s*([CF])?/i);
  if(!temperature) return {};
  const humidity=row.match(/(\d+(?:\.\d+)?)\s*%/);
  let fields:Partial<RunRecord>={};
  if(temperature) {
    const value=Number(temperature[1]);
    const unit=temperature[2]?.toUpperCase()??(options.temperatureUnit==='celsius'?'C':options.temperatureUnit==='fahrenheit'?'F':null);
    if(unit) fields={...fields,temperatureCelsius:unit==='F'?Math.round((value-32)*5/9*100)/100:value};
  }
  if(humidity) {
    const value=Number(humidity[1]);
    if(value>=0&&value<=100) fields={...fields,humidityPercent:value};
    const tail=row.slice(humidity.index!+humidity[0].length).trim();
    const aqi=tail.match(/^[|:;,·.\s]*(\d{1,3})[|:;,·.\s]*$/);
    if(aqi) fields={...fields,airQualityIndex:Number(aqi[1])};
  }
  return fields;
}

export function parseWorkoutText(input:string,options:WorkoutParseOptions={}):Partial<RunRecord> {
  const base=input.replace(/[″”]/g,'"').replace(/[′’]/g,"'").normalize('NFKC').replace(/\r/g,'').replace(/[\u200B-\u200D]/g,'').replace(/(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g,'');
  const labels=COLUMN_LABELS.filter(label=>/^[\u4e00-\u9fff]+$/.test(label)).reduce((text,label)=>text.replace(new RegExp([...label].join('[ \\t\\n]*'),'g'),label),base);
  // Correct a recurring OCR glyph only inside explicit calorie labels.
  const normalized=labels.replace(/(动态|总)[干于]卡/g,'$1千卡').replace(/(耗能|运动强度|努力程度)\s*[+±]+\s*/g,'$1\n');
  const text=expandColumns(normalized);
  let record:Partial<RunRecord>=appleWeather(normalized,options);
  if(/户外跑步|outdoor run(?:ning)?/i.test(text)) record={...record,activityType:'outdoor_running'};
  else if(/室内跑步|indoor run(?:ning)?/i.test(text)) record={...record,activityType:'indoor_running'};
  const date=text.match(/\b(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
  if(date) record={...record,date:`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`};
  const times=text.match(/\b([012]?\d:[0-5]\d)\s*[–—~至-]\s*([012]?\d:[0-5]\d)\b/);
  if(times) record={...record,startTime:times[1].padStart(5,'0'),endTime:times[2].padStart(5,'0')};
  const duration=captured(text,'实际运动时长|体能训练时间|体能训练时长|运动时间|训练时间|训练时长|运动时长|总时间|Workout Time|Duration',`${TIME}|${DIGITS}+\\s*分\\s*${DIGITS}{1,2}\\s*秒`);
  if(duration) record={...record,durationSeconds:parseDuration(duration)};
  const distance=workoutDistance(text,normalized);
  if(distance!==undefined) record={...record,distanceKm:distance};
  const pace=labeledValue(text,'平均配速|Average Pace',PACE);
  if(pace) record={...record,averagePaceSecondsPerKm:unitAllowed('averagePaceSecondsPerKm',pace.suffix)?parsePace(pace.raw):null};
  const specs:[keyof RunRecord,string][]=[
    ['averageHeartRateBpm','平均心率|Average Heart Rate|Avg[.]? Heart Rate'],
    ['averageCadenceSpm','平均步频|Average Cadence|Avg[.]? Cadence'],
    ['averagePowerWatts','平均功率|Average Power|Avg[.]? Power'],
    ['activeCaloriesKcal','动态千卡|动态消耗|活动千卡|动态卡路里|Active Calories'],
    ['totalCaloriesKcal','总千卡数|总千卡|总消耗|总卡路里|Total Calories'],
    ['elevationGainMeters','累计爬升|总爬升高度|爬升高度|Elevation Gain'],
    ['effortLevel','运动强度|努力程度|耗能|Effort'],
    ['temperatureCelsius','气温|温度|Temperature'],
    ['humidityPercent','湿度|Humidity'],
    ['airQualityIndex','空气质量指数|空气质量|AQI'],
  ];
  for(const [field,label] of specs) {
    const value=labeledValue(text,label,`${field==='temperatureCelsius'?'-?':''}${NUMBER}`);
    if(value!==null) record={...record,[field]:field==='temperatureCelsius'?temperatureValue(value.raw,value.suffix,options):unitAllowed(field,value.suffix)?Number(numericText(value.raw)):null};
  }
  const effort=captured(text,'运动强度|努力程度|耗能|Effort',`${NUMBER}\\s*(?:/\\s*10)?\\s*[（(]?\\s*(?:适中|轻松|吃力|困难|moderate|easy|hard)`);
  if(effort) record={...record,effortDescription:effort.match(/适中|轻松|吃力|困难|moderate|easy|hard/i)?.[0]??null};
  const location=captured(text,'地点|Location','[^\\n]{1,100}');
  if(location) record={...record,location:location.trim()};
  else {
    const cities=[...new Set(text.split('\n').map(line=>line.trim().replace(/^.{0,2}(?=中国)/,'')).filter(line=>/^(?:中国[,，\s]*)?[\u4e00-\u9fff]{2,15}(?:省[\u4e00-\u9fff]{2,10})?市$/.test(line)))];
    if(cities.length===1) record={...record,location:cities[0]};
  }
  const weather=text.split(/天气|weather/i)[1];
  if(weather) {
    const weatherRows=weather.split('\n').filter(line=>new RegExp(`^\\s*(?:-?${NUMBER}\\s*°?C\\s*)?(?:${NUMBER}\\s*%)?\\s*$`,'i').test(line)).join('\n');
    const temperature=weatherRows.match(new RegExp(`(-?${NUMBER})\\s*°?C\\b`,'i'));
    const humidity=weatherRows.match(new RegExp(`(${NUMBER})\\s*%`));
    if(record.temperatureCelsius===undefined&&temperature) record={...record,temperatureCelsius:Number(numericText(temperature[1]))};
    if(record.humidityPercent===undefined&&humidity) record={...record,humidityPercent:Number(numericText(humidity[1]))};
  }
  const timezone=captured(text,'时区|Timezone','[A-Za-z_]+/[A-Za-z_/]+');
  if(timezone) record={...record,timezone};
  if(/Apple\s*Watch/i.test(text)) record={...record,source:'Apple Watch'};
  if(/首次跑步训练/.test(text)) record={...record,awards:['首次跑步训练']};
  const heartSection=text.split(/(?:^|\n)心率\s*[>》]?\s*\n/)[1];
  if(record.averageHeartRateBpm===undefined&&heartSection) {
    const heartAverage=captured(heartSection,'平均',`${DIGITS}{2,3}\\s*次\\s*\\/\\s*分`);
    if(heartAverage) record={...record,averageHeartRateBpm:Number(numericText(heartAverage.match(new RegExp(DIGITS+'{2,3}'))![0]))};
  }
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
