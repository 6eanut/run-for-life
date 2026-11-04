import { PSM, type Worker, type RecognizeOptions } from 'tesseract.js';
import type { RunRecord } from '../domain/model';
import type { OcrBox, OcrPage } from './ocr-layout';

type Anchor = { text:string; bbox:OcrBox };
export type MetricRegion = {
  field:'averagePaceSecondsPerKm'|'effortLevel';
  rectangle:{left:number;top:number;width:number;height:number};
};
const compact=(text:string)=>text.replace(/\s/g,'');
const boxHeight=(box:OcrBox)=>Math.max(1,box.y1-box.y0);
const averagePace=/^(?:平均配[速束]|AveragePace|Avg[.]?Pace)$/i;
const effortLabel=/^(?:耗能|运动强度|努力程度|Effort)$/i;
const metricLabels=/平均(?:步频|心率|配[速束]|功率)|体能训练(?:时间|时长)|动态[千干]卡|总[千干]卡(?:数)?|总爬升高度|距离|耗能|运动强度|努力程度|Average(?:Pace|Cadence|HeartRate|Power)|ActiveCalories|TotalCalories|ElevationGain|WorkoutTime|Distance|Effort/gi;

function anchorsFor(page:OcrPage):Anchor[] {
  const lines=(page.blocks??[]).flatMap(block=>(block.paragraphs??[]).flatMap(paragraph=>paragraph.lines??[]));
  return lines.flatMap(line=>{
    const words=(line.words??[]).map(word=>({...word,text:compact(word.text)}));
    const text=words.map(word=>word.text).join('');
    return [...text.matchAll(metricLabels)].flatMap(match=>{
      let position=0;
      const boxes=words.flatMap(word=>{
        const start=position;position+=word.text.length;
        return position>match.index!&&start<match.index!+match[0].length?[word.bbox]:[];
      });
      if(!boxes.length)return [];
      const bbox={x0:Math.min(...boxes.map(box=>box.x0)),y0:Math.min(...boxes.map(box=>box.y0)),x1:Math.max(...boxes.map(box=>box.x1)),y1:Math.max(...boxes.map(box=>box.y1))};
      return Object.values(bbox).every(Number.isFinite)&&bbox.x1>bbox.x0&&bbox.y1>bbox.y0?[{text:match[0],bbox}]:[];
    });
  });
}

function rectangleFor(anchor:Anchor,anchors:Anchor[],width:number,height:number):MetricRegion['rectangle']|null {
  const h=boxHeight(anchor.bbox);
  const padding=h*0.35;
  const nextColumn=anchors.filter(other=>Math.abs(other.bbox.y0-anchor.bbox.y0)<h*0.8&&other.bbox.x0>anchor.bbox.x0+h*2).map(other=>other.bbox.x0);
  const nextRow=anchors.filter(other=>other.bbox.y0>anchor.bbox.y1+h*0.4).map(other=>other.bbox.y0);
  const left=Math.max(0,Math.floor(anchor.bbox.x0-padding));
  const right=Math.min(width,Math.floor(Math.min(width,...nextColumn)-padding));
  const top=Math.max(0,Math.ceil(anchor.bbox.y1+h*0.05));
  const bottom=Math.min(height,Math.floor(anchor.bbox.y1+h*3.2),Math.floor(Math.min(Infinity,...nextRow)-h*0.15));
  return right-left>h&&bottom-top>h*0.8?{left,top,width:right-left,height:bottom-top}:null;
}

/** Value regions follow recognized labels and row/column gaps, never screenshot coordinates. */
export function findMetricRegions(page:OcrPage,width:number,height:number):MetricRegion[] {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return [];
  const anchors=anchorsFor(page);
  return anchors.filter(anchor=>averagePace.test(anchor.text)||effortLabel.test(anchor.text)).flatMap((anchor):MetricRegion[]=>{
    const rectangle=rectangleFor(anchor,anchors,width,height);
    if(!rectangle)return [];
    const field=averagePace.test(anchor.text)?'averagePaceSecondsPerKm':'effortLevel';
    if(field==='effortLevel') {
      // The intensity card can span the screen; its decorative bar is not a value.
      const right=Math.min(rectangle.left+rectangle.width,Math.floor(anchor.bbox.x0+Math.max((anchor.bbox.x1-anchor.bbox.x0)*4,boxHeight(anchor.bbox)*10)));
      return [{field,rectangle:{...rectangle,width:right-rectangle.left}}];
    }
    return [{field,rectangle}];
  });
}

function readPace(text:string):number|null {
  const normalized=text.normalize('NFKC').replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g,'');
  const pattern=/(?:^|\s)(\d{1,3})\s*['′’:.’]\s*(\d{2})\s*['"′″’”]*\s*\/\s*(?:公里|km)(?=$|[\s.,])/gi;
  const values=[...new Set([...normalized.matchAll(pattern)].filter(match=>Number(match[2])<60).map(match=>Number(match[1])*60+Number(match[2])).filter(value=>value>0&&value<=7200))];
  return values.length===1?values[0]:null;
}

async function scanRegion<T>(worker:Pick<Worker,'recognize'>,canvas:HTMLCanvasElement,region:MetricRegion,whitelist:string,read:(text:string)=>T|null):Promise<T|null> {
  for(const mode of [PSM.SINGLE_LINE,PSM.RAW_LINE]) {
    const options:Partial<RecognizeOptions>&Record<string,unknown>={rectangle:region.rectangle,tessedit_pageseg_mode:mode,tessedit_char_whitelist:whitelist};
    try {
      const result=await worker.recognize(canvas,options,{text:true,blocks:false});
      const value=read(result.data.text);
      if(value!==null)return value;
    } catch { return null; }
  }
  return null;
}

async function recoverPace(worker:Pick<Worker,'recognize'>,canvas:HTMLCanvasElement,regions:MetricRegion[]):Promise<string> {
  const readings:number[]=[];
  for(const region of regions.slice(0,2)) {
    const value=await scanRegion(worker,canvas,region,'0123456789:\'".′″’”/公里km',readPace);
    if(value!==null)readings.push(value);
  }
  const unique=[...new Set(readings)];
  if(unique.length!==1)return '';
  const value=unique[0];
  return `平均配速 ${Math.floor(value/60)}'${String(value%60).padStart(2,'0')}"/公里`;
}

type Effort = {level:number;description:string};
function readEffort(text:string):Effort|null {
  const normalized=text.normalize('NFKC').replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g,'');
  if(/(?:[+-]\s*\d|\d\s*[.:/]\s*\d)/.test(normalized))return null;
  const pattern=/(?:^|\s)(10|[1-9])\s*[)）|:：]*\s*(困难|适中|轻松|吃力|moderate|easy|hard)(?=$|[\s<»«|,，.。])/gi;
  const values=[...new Map([...normalized.matchAll(pattern)].map(match=>{
    const value={level:Number(match[1]),description:match[2].toLowerCase().replace(/\s+/g,' ')};
    return [`${value.level}:${value.description}`,value];
  })).values()];
  return values.length===1?values[0]:null;
}

async function recoverEffort(worker:Pick<Worker,'recognize'>,canvas:HTMLCanvasElement,regions:MetricRegion[],parsed:Partial<RunRecord>):Promise<string> {
  const readings:Effort[]=[];
  for(const region of regions.slice(0,2)) {
    const value=await scanRegion(worker,canvas,region,'0123456789()）|:：.+/-适中轻松吃力困难moderateeasyhardMODERATEEASYHARD ',readEffort);
    if(value!==null)readings.push(value);
  }
  const unique=[...new Map(readings.map(value=>[`${value.level}:${value.description}`,value])).values()];
  if(unique.length!==1)return '';
  const value=unique[0];
  if(parsed.effortLevel!=null&&parsed.effortLevel!==value.level)return '';
  if(parsed.effortDescription&&compact(parsed.effortDescription.toLowerCase())!==compact(value.description))return '';
  return `运动强度 ${value.level} ${value.description}`;
}

/** Uses per-call OCR parameters; full-image passes must also specify their baseline settings. */
export async function recoverMissingMetrics(worker:Pick<Worker,'recognize'>,canvas:HTMLCanvasElement,page:OcrPage,parsed:Partial<RunRecord>):Promise<string> {
  const regions=findMetricRegions(page,canvas.width,canvas.height);
  const text:string[]=[];
  if(parsed.averagePaceSecondsPerKm==null)text.push(await recoverPace(worker,canvas,regions.filter(region=>region.field==='averagePaceSecondsPerKm')));
  if(parsed.effortLevel==null||!parsed.effortDescription?.trim())text.push(await recoverEffort(worker,canvas,regions.filter(region=>region.field==='effortLevel'),parsed));
  return text.filter(Boolean).join('\n');
}
